// Read-only, one-shot Cloudflare diagnostic. Output is aggregate-only and
// must never contain request traces, object/network keys, routes, or raw logs.
import {pathToFileURL} from 'node:url';
import {privateQuotaStore} from './private-quota-forensics.mjs';
import {collectVerifiedTelemetry} from './verified-observability.mjs';

const MAX_PAGES=12,PAGE_SIZE=2000;
const RETENTION_MS=3*86400000,SETTLEMENT_MS=2*60000,MAX_WINDOW_MS=35*60000;
export function quotaForensicsFailureCode(error){
  const code=error?.forensicCode;
  return typeof code==='string'&&/^(?:trusted_context|private_storage_access|telemetry_collection|private_storage_save|(?:storage|telemetry)_http_[1-5][0-9]{2})$/.test(code)?code:'collection_unavailable';
}
const timing=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=600000?v:null;
const key=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v)?v:null;
const attempt=v=>Number.isInteger(v)&&v>0&&v<=2?v:null;
const payload=(row,name)=>{
  let p=row?.source;
  if(typeof p==='string')try{p=JSON.parse(p);}catch{return null;}
  if(!p||typeof p!=='object')try{p=JSON.parse(row?.$metadata?.message);}catch{return null;}
  return p?.event===name?p:null;
};
const metrics=(arr,field)=>{
  const values=arr.map(p=>timing(p?.[field])).filter(v=>v!==null).sort((a,b)=>a-b);
  const percentile=p=>values.length?Math.round(values[Math.max(0,Math.ceil(values.length*p)-1)]):null;
  return {observed:values.length,gt_500ms:values.filter(x=>x>500).length,
    gt_1000ms:values.filter(x=>x>1000).length,p50_ms:percentile(.5),p95_ms:percentile(.95)};
};

export function summarizeQuotaStages(gatewayRows,handlerRows,startRows){
  const handlers=new Map(),starts=new Set(),slow=[],layout={current:0,legacy:0,empty:0,unread:0,other:0},
    phases={complete:0,transaction:0,durability:0,other:0};
  for(const row of handlerRows){
    const p=payload(row,'quota_handler'),t=key(p?.trace);
    if(t&&(!handlers.has(t)||(attempt(p.attempt)||0)>(attempt(handlers.get(t).attempt)||0)))handlers.set(t,p);
  }
  for(const row of startRows){const p=payload(row,'quota_handler_start'),t=key(p?.trace);if(t)starts.add(t);}
  let gatewayRecords=0,errors=0,preOriginErrors=0;
  for(const row of gatewayRows){
    const p=payload(row,'gateway_request');
    if(!p||!Number.isInteger(p.status)||p.status<100||p.status>599)continue;
    gatewayRecords++;
    if(p.status>=500){errors++;if(p.upstream_calls===0)preOriginErrors++;}
    if(timing(p.quota_ms)>1000&&p.sample_rate===1)slow.push(p);
  }
  const matched=[],missing=[];
  for(const p of slow){
    const t=key(p.trace),h=t?handlers.get(t):null;
    if(h)matched.push({g:p,h});else missing.push({start:t?starts.has(t):false});
  }
  const h=matched.map(x=>x.h),g=matched.map(x=>x.g);
  for(const p of h){
    layout[Object.hasOwn(layout,p.state_layout)?p.state_layout:'other']++;
    phases[Object.hasOwn(phases,p.phase)?p.phase:'other']++;
  }
  return {
    gateway_records:gatewayRecords,handler_records:handlers.size,handler_start_records:starts.size,
    gateway_5xx:errors,gateway_5xx_before_upstream:preOriginErrors,
    slow_gateway_quota:slow.length,matched_slow:matched.length,
    missing_handler_completion:missing.length,missing_handler_with_start:missing.filter(x=>x.start).length,
    slow_handler_dominant:slow.filter(p=>timing(p.quota_handler_ms)!==null&&timing(p.quota_transport_wait_ms)!==null&&p.quota_handler_ms>=p.quota_transport_wait_ms).length,
    slow_residual_dominant:slow.filter(p=>timing(p.quota_handler_ms)!==null&&timing(p.quota_transport_wait_ms)!==null&&p.quota_transport_wait_ms>p.quota_handler_ms).length,
    slow_with_retry:slow.filter(p=>Number.isInteger(p.quota_attempts)&&p.quota_attempts>1).length,
    matched_concurrent:h.filter(p=>Number.isInteger(p.concurrency)&&p.concurrency>1).length,
    matched_cleanup_overlap:h.filter(p=>p.cleanup_inflight===true).length,
    matched_durability_confirmed:h.filter(p=>p.durability_confirmed===true).length,
    matched_handler_503:h.filter(p=>p.status===503).length,
    layout,phase:phases,
    stages:{gateway_quota:metrics(g,'quota_ms'),
      gateway_handler:metrics(g,'quota_handler_ms'),gateway_residual:metrics(g,'quota_transport_wait_ms'),
      transaction:metrics(h,'transaction_ms'),durability:metrics(h,'durability_ms'),
      get:metrics(h,'get_ms'),put:metrics(h,'put_ms'),
      alarm_get:metrics(h,'alarm_get_ms'),alarm_set:metrics(h,'alarm_set_ms'),
      handler_total:metrics(h,'handler_ms')},
  };
}

async function requestJson(fetcher,url,token,body){
  const r=await fetcher(url,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{authorization:'Bearer '+token,accept:'application/json','content-type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Object.assign(Error('Read-only telemetry HTTP request failed'),{forensicCode:'telemetry_http_'+r.status});
  const d=await r.json().catch(()=>null);
  if(!d||d.success===false||d.errors?.length)throw Error('Read-only telemetry response invalid');
  return d;
}

async function account(fetcher,token){
  const d=await requestJson(fetcher,'https://api.cloudflare.com/client/v4/zones?name=packone.pro&per_page=50',token);
  const zones=d.result?.filter(z=>z.name==='packone.pro'&&z.status==='active');
  const id=zones?.length===1?zones[0].account?.id:null;
  if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw Error('Cloudflare account not verified');
  return id;
}

export async function collectQuotaEventRows({fetcher=fetch,token,accountId,from,to,event,service,maxRequests=48}){
  const url='https://api.cloudflare.com/client/v4/accounts/'+accountId+'/workers/observability/telemetry/query';
  return collectVerifiedTelemetry({from,to,maxRequests,pageSize:PAGE_SIZE,maxPages:MAX_PAGES,
    fetchPage:async({from:begin,to:end,limit,offset})=>{
      const filters=[];
      if(service)filters.push({key:'$metadata.service',operation:'eq',type:'string',value:service});
      filters.push({key:'event',operation:'eq',type:'string',value:event});
      const req={queryId:'pack1-quota-forensics',timeframe:{from:begin,to:end},dry:true,limit,
        view:'events',parameters:{datasets:['cloudflare-workers'],filterCombination:'and',filters}};
      if(offset){req.offset=offset;req.offsetDirection='next';}
      const data=await requestJson(fetcher,url,token,req);
      return {events:data.result?.events?.events,level:data.result?.statistics?.abr_level??data.result?.run?.statistics?.abr_level};
    }});
}

export function forensicWindows(now,env={}){
  if(!Number.isSafeInteger(now)||now<=0)throw Error('Invalid forensic clock');
  const parse=value=>{
    if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value))return NaN;
    const ms=Date.parse(value),canonical=value.includes('.')?value:value.replace('Z','.000Z');
    return Number.isFinite(ms)&&new Date(ms).toISOString()===canonical?ms:NaN;
  };
  if(env.PACK1_QUOTA_FORENSICS_FROM!==undefined||env.PACK1_QUOTA_FORENSICS_TO!==undefined){
    const from=parse(env.PACK1_QUOTA_FORENSICS_FROM),to=parse(env.PACK1_QUOTA_FORENSICS_TO);
    if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from>=to||to-from>MAX_WINDOW_MS||now-from>RETENTION_MS||to>now-SETTLEMENT_MS)
      throw Error('Explicit forensic window outside bounded retention or settlement');
    return [{name:'requested',from,to,status:'collect'}];
  }
  return [
    {name:'historical_5xx_2026_10_26',from:Date.parse('2026-10-26T15:40:00Z'),to:Date.parse('2026-10-26T16:15:00Z')},
    {name:'current_recent',from:now-35*60000,to:now-5*60000},
  ].map(window=>({...window,status:now-window.from>RETENTION_MS?'skipped':'collect',
    ...(now-window.from>RETENTION_MS?{reason:'outside_configured_retention'}:{})}));
}

export async function runQuotaForensics({fetcher=fetch,env=process.env,now=Date.now()}={}){
  const token=env.CLOUDFLARE_EDGE_TOKEN;
  if(typeof token!=='string'||token.length<20)throw Error('Private provider access unavailable');
  const windows=forensicWindows(now,env);
  const accountId=await account(fetcher,token);
  const summaries=[];
  for(const {name,from,to,status,reason} of windows){
    if(status==='skipped'){summaries.push({window:name,status,reason});continue;}
    const query=(event,service)=>collectQuotaEventRows({fetcher,token,accountId,from,to,event,service});
    const gateway=await query('gateway_request','pack1-gateway');
    let handlers=await query('quota_handler','pack1-gateway');
    let starts=await query('quota_handler_start','pack1-gateway');
    // DO logs may be under a different provider service; if so, correlate
    // account-wide candidates by random trace, not by anonymous object tag.
    if(!handlers.rows.length&&gateway.rows.some(r=>timing(payload(r,'gateway_request')?.quota_ms)>1000)){
      handlers=await query('quota_handler',null);
      starts=await query('quota_handler_start',null);
    }
    summaries.push({window:name,status:'collected',from,to,
      ...summarizeQuotaStages(gateway.rows,handlers.rows,starts.rows),
      query_coverage:Object.fromEntries(Object.entries({gateway,handlers,starts}).map(([key,value])=>[key,{requests:value.requests,partitions:value.coverage}]))});
  }
  return {version:2,source:'cloudflare_read_only_telemetry',windows:summaries,
    limitation:'Verified query partitions do not establish complete log retention. Missing records are not proof of nonexecution, and gateway summaries are sampled.'};
}
export async function publishQuotaForensics({fetcher=fetch,env=process.env,now=Date.now()}={}){
  let stage='trusted_context';
  try {
    if(env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer'||
      !/^[1-9]\d{0,19}$/.test(env.GITHUB_RUN_ID||'')||!/^[1-9]\d{0,2}$/.test(env.GITHUB_RUN_ATTEMPT||'')||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||''))throw Error('Reviewed main context required');
    stage='private_storage_access';
    const store=privateQuotaStore({token:env.CLOUDFLARE_PRIVATE_REPORT_TOKEN,fetcher});
    await store.verify();
    stage='telemetry_collection';
    const report=await runQuotaForensics({fetcher,env,now});
    stage='private_storage_save';
    await store.save(report,{runId:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,sha:env.GITHUB_SHA,now});
  } catch(error) {
    if(quotaForensicsFailureCode(error)==='collection_unavailable')throw Object.assign(Error('Private quota investigation unavailable'),{forensicCode:stage});
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  publishQuotaForensics().then(()=>console.log('Private quota timing report saved and readback verified.'))
    .catch(error=>{console.error('Quota stage investigation unavailable ('+quotaForensicsFailureCode(error)+'); provider details withheld.');process.exitCode=1;});
}
