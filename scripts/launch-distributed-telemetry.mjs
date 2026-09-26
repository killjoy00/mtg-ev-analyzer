import assert from 'node:assert/strict';
import {queryEvents,parseGatewayEvent} from './launch-alert.mjs';
import {quantiles} from './launch-distributed-core.mjs';

// Adapt only the retained-log service filter; the production watcher's code and
// watermark remain byte-for-byte unchanged. Validate rows before its permissive
// production parser so malformed preview evidence is never silently discarded.
export async function queryPreviewEvents(fetcher,token,account,from,to) {
  const previewFetch=async(url,options)=>{
    assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`,'fixed_telemetry_endpoint');
    const body=JSON.parse(options.body),service=body.parameters?.filters?.find(f=>f.key==='$metadata.service');
    assert.equal(service?.value,'pack1-gateway','unexpected_upstream_service_filter');
    service.value='pack1-gateway-preview';body.queryId='pack1-capacity-preview';
    const response=await fetcher(url,{...options,body:JSON.stringify(body)}),data=await response.json();
    if(response.ok&&data.success!==false) {
      const rows=data.result?.events?.events;assert.ok(Array.isArray(rows),'invalid_preview_log_schema');
      if(rows.length<200)for(const row of rows) {
        const event=parseGatewayEvent(row);
        assert.ok(event?.id&&event.release!=='unknown'&&event.status>=100&&event.status<=599&&event.duration_ms>=0,'invalid_retained_preview_event');
      }
    }
    return Response.json(data,{status:response.status});
  };
  return queryEvents(previewFetch,token,account,from,to);
}

// Use the production watcher's bounded, splitting, event-ID-deduplicating reader,
// but never its production probes, usage mutation or issue-watermark writer.
export async function previewAccount({fetcher=fetch,token=process.env.CLOUDFLARE_EDGE_TOKEN}={}) {
  assert.ok(token,'missing_preview_telemetry_credential');
  const r=await fetcher('https://api.cloudflare.com/client/v4/zones?name=packone.pro&per_page=50',{headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});
  const d=await r.json();assert.ok(r.ok&&d.success&&d.result?.length===1&&/^[a-f0-9]{32}$/.test(d.result[0].account?.id),'preview_telemetry_account');
  return d.result[0].account.id;
}
export function inspectBin(events,{sha,requests,from,to},p) {
  const failures=[],required=Math.max(1,Math.floor(requests*p.minimum_telemetry_sample_fraction));
  if(events.some(e=>e.release!==sha))failures.push('wrong_release');
  if(events.some(e=>e.status<200||e.status>=300))failures.push('retained_application_error');
  if(events.length<required)failures.push('missing_or_sparse_retained_telemetry');
  return {from,to,client_requests:requests,retained_events:events.length,required_events:required,
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
    limitation:'Ten-percent success sampling: positive per-minute evidence and fully sampled errors, not lossless request reconciliation or a population latency SLO.'};
}
