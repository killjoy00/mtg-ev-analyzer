import assert from 'node:assert/strict';
import {parseGatewayEvent} from './launch-alert.mjs';
import {quantiles} from './launch-distributed-core.mjs';

const PREVIEW_PAGE_SIZE=2000,PREVIEW_MAX_PAGES=32;

// The finite preview emits every success/error, so use the telemetry API's
// event-page cursor directly instead of the production watcher's 200-row
// sampling-oriented recursive splitter. The production watcher remains
// byte-for-byte unchanged. Every retained row is still validated fail-closed.
export async function queryPreviewEvents(fetcher,token,account,from,to) {
  const url=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`,seen=new Map();
  let offset=null;
  for(let page=0;page<PREVIEW_MAX_PAGES;page++) {
    const body={queryId:'pack1-capacity-preview',timeframe:{from,to},dry:true,limit:PREVIEW_PAGE_SIZE,view:'events',
      parameters:{datasets:['cloudflare-workers'],filterCombination:'and',filters:[
        {key:'$metadata.service',operation:'eq',type:'string',value:'pack1-gateway-preview'},
        {key:'event',operation:'eq',type:'string',value:'gateway_request'},
      ]}};
    if(offset){body.offset=offset;body.offsetDirection='next';}
    const response=await fetcher(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw Error(`preview_telemetry_http_${response.status}`);
    if(data?.success===false||data?.errors?.length)throw Error('preview_telemetry_api_error');
    const rows=data?.result?.events?.events;
    assert.ok(Array.isArray(rows),'invalid_preview_log_schema');
    for(const row of rows) {
      const event=parseGatewayEvent(row);
      assert.ok(event?.id&&event.release!=='unknown'&&event.status>=100&&event.status<=599&&event.duration_ms>=0,'invalid_retained_preview_event');
      seen.set(event.id,event);
    }
    if(rows.length<PREVIEW_PAGE_SIZE)return [...seen.values()];
    const next=rows.at(-1)?.$metadata?.id;
    assert.ok(typeof next==='string'&&next.length>0&&next.length<=512&&next!==offset,'invalid_preview_log_cursor');
    offset=next;
  }
  throw Error('preview_telemetry_page_limit');
}

export function previewTelemetryFailure(error) {
  const message=String(error?.message||'');
  return /^(?:preview_telemetry_http_[1-5]\d\d|preview_telemetry_api_error|invalid_preview_log_schema|invalid_preview_log_cursor|invalid_retained_preview_event|preview_telemetry_page_limit)$/.test(message)
    ?message:'preview_telemetry_unclassified';
}

// Use only retained preview evidence; never production probes, usage mutation or
// the issue-watermark writer.
export async function previewAccount({fetcher=fetch,token=process.env.CLOUDFLARE_EDGE_TOKEN}={}) {
  assert.ok(token,'missing_preview_telemetry_credential');
  const r=await fetcher('https://api.cloudflare.com/client/v4/zones?name=packone.pro&per_page=50',{headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});
  const d=await r.json();assert.ok(r.ok&&d.success&&d.result?.length===1&&/^[a-f0-9]{32}$/.test(d.result[0].account?.id),'preview_telemetry_account');
  return d.result[0].account.id;
}
export function inspectBin(events,{sha,requests,from,to},p) {
  const failures=[],required=Math.max(1,Math.floor(requests*p.minimum_telemetry_sample_fraction));
  const status_counts=Object.fromEntries([...new Set(events.map(e=>e.status))].sort((a,b)=>a-b).map(status=>[status,events.filter(e=>e.status===status).length]));
  const route_status_counts={};
  for(const e of events) {
    const key=(e.route||'other')+':'+e.status;route_status_counts[key]=(route_status_counts[key]||0)+1;
  }
  if(events.some(e=>e.release!==sha))failures.push('wrong_release');
  // Every generated client request is independently recorded before fetch and a
  // non-2xx client response already fails evaluateStage. The fixed preview
  // hostname can also receive unauthenticated Internet traffic, which the
  // gateway correctly rejects with 4xx and logs at 100%. Retain/count those
  // boundary rejects, but do not misattribute them to the load cohort. A retained
  // 429 or 5xx is still a hard telemetry failure because it can reflect quota or
  // service degradation outside the sampled success stream.
  const boundary_rejections=events.filter(e=>e.status>=400&&e.status<500&&e.status!==429).length;
  if(events.some(e=>e.status===429||e.status>=500))failures.push('retained_system_error');
  if(events.length<required)failures.push('missing_or_sparse_retained_telemetry');
  return {from,to,client_requests:requests,retained_events:events.length,required_events:required,status_counts,route_status_counts,boundary_rejections,
    gateway_duration_ms:quantiles(events.map(e=>e.duration_ms)),quota_ms:quantiles(events.map(e=>e.quota_ms)),upstream_ms:quantiles(events.map(e=>e.upstream_ms)),
    failures,passed:failures.length===0};
}
export async function inspectPreviewTelemetry({reports,sha,from,to,policy,account,token=process.env.CLOUDFLARE_EDGE_TOKEN,fetcher=fetch,clock=Date.now}) {
  assert.ok(clock()>=to+policy.telemetry_settlement_seconds*1000,'telemetry_not_settled');
  const requests=reports.flatMap(r=>r.requests),bins=[];
  for(let a=from;a<to;a+=policy.telemetry_bin_seconds*1000) {
    const b=Math.min(to,a+policy.telemetry_bin_seconds*1000),count=requests.filter(r=>r.at>=a&&r.at<b).length;
    // Still query quiet/drain bins to expose retained errors. Quiet alone is not
    // evidence of instrumentation: at least one active bin is required below.
    const events=await queryPreviewEvents(fetcher,token,account,a,b);
    const bin=inspectBin(events,{sha,requests:count,from:a,to:b},policy);
    if(count===0) {bin.required_events=0;bin.failures=bin.failures.filter(f=>f!=='missing_or_sparse_retained_telemetry');bin.passed=!bin.failures.length;}
    bins.push(bin);
  }
  return {service:'pack1-gateway-preview',sha,bins,passed:bins.some(b=>b.client_requests>0)&&bins.every(b=>b.passed),
    limitation:'The finite private preview emits every success and error, but the retained log API is not a lossless request ledger or a population latency SLO. Exact route percentiles come from unsampled client records. Preview-only 4xx boundary rejects are retained separately because generated client non-2xx responses already fail the client record.'};
}
