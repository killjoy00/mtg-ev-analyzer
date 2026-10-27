// Read-only, one-shot Cloudflare diagnostic. Output is aggregate-only and
// must never contain request traces, object/network keys, routes, or raw logs.
import {pathToFileURL} from 'node:url';

const MAX_PAGES=12,PAGE_SIZE=2000;
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
  if(!r.ok)throw Error('Read-only telemetry HTTP request failed');
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

async function query(fetcher,token,accountId,from,to,event,service){
  const url='https://api.cloudflare.com/client/v4/accounts/'+accountId+'/workers/observability/telemetry/query';
  const rows=new Map();let offset=null;
  for(let i=0;i<MAX_PAGES;i++){
    const filters=[];
    if(service)filters.push({key:'$metadata.service',operation:'eq',type:'string',value:service});
    filters.push({key:'event',operation:'eq',type:'string',value:event});
    const req={queryId:'pack1-launch-watch',timeframe:{from,to},dry:true,limit:PAGE_SIZE,
      view:'events',parameters:{datasets:['cloudflare-workers'],filterCombination:'and',filters}};
    if(offset){req.offset=offset;req.offsetDirection='next';}
    const data=await requestJson(fetcher,url,token,req),page=data.result?.events?.events;
    if(!Array.isArray(page))throw Error('Malformed Cloudflare telemetry page');
    for(const row of page){
      const id=row?.$metadata?.id;
      if(typeof id!=='string'||!id||id.length>512)throw Error('Malformed telemetry event identifier');
      rows.set(id,row);
    }
    if(page.length<PAGE_SIZE)return [...rows.values()];
    const next=page.at(-1)?.$metadata?.id;
    if(!next||next===offset)throw Error('Telemetry pagination stalled');
    offset=next;
  }
  throw Error('Telemetry query exceeded bounded page count');
}

export async function runQuotaForensics({fetcher=fetch,env=process.env,now=Date.now()}={}){
  const token=env.CLOUDFLARE_EDGE_TOKEN;
  if(typeof token!=='string'||token.length<20)throw Error('Private provider access unavailable');
  const accountId=await account(fetcher,token);
  const windows=[
    {name:'historical_5xx_2026_10_26',from:Date.parse('2026-10-26T15:40:00Z'),to:Date.parse('2026-10-26T16:15:00Z')},
    {name:'current_recent',from:now-35*60000,to:now-5*60000},
  ];
  const summaries=[];
  for(const {name,from,to} of windows){
    if(now-to>3*86400000||to>now-2*60000)throw Error('Forensic window outside bounded retention/settlement');
    const gateway=await query(fetcher,token,accountId,from,to,'gateway_request','pack1-gateway');
    let handlers=await query(fetcher,token,accountId,from,to,'quota_handler','pack1-gateway');
    let starts=await query(fetcher,token,accountId,from,to,'quota_handler_start','pack1-gateway');
    // DO logs may be under a different provider service; if so, correlate
    // account-wide candidates by random trace, not by anonymous object tag.
    if(!handlers.length&&gateway.some(r=>timing(payload(r,'gateway_request')?.quota_ms)>1000)){
      handlers=await query(fetcher,token,accountId,from,to,'quota_handler',null);
      starts=await query(fetcher,token,accountId,from,to,'quota_handler_start',null);
    }
    summaries.push({window:name,...summarizeQuotaStages(gateway,handlers,starts)});
  }
  return {version:1,source:'cloudflare_read_only_telemetry',windows:summaries};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runQuotaForensics().then(report=>console.log('QUOTA_STAGE_FORENSICS '+JSON.stringify(report)))
    .catch(()=>{console.error('Quota stage investigation unavailable; provider details withheld.');process.exitCode=1;});
}
