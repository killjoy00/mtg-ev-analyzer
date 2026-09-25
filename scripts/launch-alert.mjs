import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const PROJECT='patient-shadow-91417882',TITLE='[launch alert] Production capacity needs attention';
export const thresholds={window_minutes:15,minimum_errors:5,estimated_error_fraction:.01,minimum_429:10,minimum_slow_samples:3,slow_ms:5000,quota_ms:1000,requests_per_day:100000,compute_cu_hours_per_day:24,compute_cu_hours_per_billing_period:200,egress_bytes_per_day:5*1024**3,egress_bytes_per_billing_period:50*1024**3};
async function json(fetcher,url,token,body) {
  const r=await fetcher(url,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
  const d=await r.json().catch(()=>null);
  if(!r.ok||d?.success===false||d?.errors?.length)throw Object.assign(Error(new URL(url).hostname+new URL(url).pathname+' telemetry HTTP '+r.status),{status:r.status});
  return d;
}
export function parseGatewayEvent(row) {
  let p=row?.source;
  if(typeof p==='string')try{p=JSON.parse(p);}catch{return null;}
  if(!p||typeof p!=='object')try{p=JSON.parse(row?.$metadata?.message);}catch{return null;}
  if(p.event!=='gateway_request'||![.1,1].includes(p.sample_rate)||!Number.isFinite(p.status)||!Number.isFinite(p.duration_ms))return null;
  return {id:row?.$metadata?.id,route:/^[a-z_]{1,40}$/.test(p.route)?p.route:'other',status:p.status,sample_rate:p.sample_rate,duration_ms:p.duration_ms,quota_ms:Number(p.quota_ms)||0,upstream_ms:Number(p.upstream_ms)||0,quota_scope:['request','session','request,session'].includes(p.quota_scope)?p.quota_scope:null,release:/^[a-f0-9]{40}$/.test(p.release)?p.release:'unknown'};
}
export function evaluate(events,usage) {
  const estimated=events.reduce((n,e)=>n+1/e.sample_rate,0),errors=events.filter(e=>e.status>=500).length,limited=events.filter(e=>e.status===429).length;
  const slow=events.filter(e=>e.duration_ms>thresholds.slow_ms).length,quotaSlow=events.filter(e=>e.quota_ms>thresholds.quota_ms).length;
  const alerts=[];
  if(errors>=thresholds.minimum_errors&&errors/Math.max(1,estimated)>thresholds.estimated_error_fraction)alerts.push('gateway_5xx');
  if(limited>=thresholds.minimum_429)alerts.push('network_or_application_429');
  if(slow>=thresholds.minimum_slow_samples)alerts.push('slow_requests');
  if(quotaSlow>=thresholds.minimum_slow_samples)alerts.push('slow_quota');
  if(usage.worker_requests>=thresholds.requests_per_day)alerts.push('worker_daily_usage');
  if(usage.compute_cu_hours>=thresholds.compute_cu_hours_per_day)alerts.push('neon_compute_daily_usage');
  if(usage.billing_period_compute_cu_hours>=thresholds.compute_cu_hours_per_billing_period)alerts.push('neon_compute_billing_period_usage');
  if(usage.egress_bytes>=thresholds.egress_bytes_per_day)alerts.push('neon_egress_daily_usage');
  if(usage.billing_period_egress_bytes>=thresholds.egress_bytes_per_billing_period)alerts.push('neon_egress_billing_period_usage');
  return {alerts,sampled_events:events.length,estimated_requests:estimated,errors,limited,slow_samples:slow,slow_quota_samples:quotaSlow,releases:[...new Set(events.map(e=>e.release))],usage};
}
export function parseNeonUsage(data) {
  const project=data.projects?.find(p=>p.project_id===PROJECT);
  if(!project||!Array.isArray(project.periods))throw Error('Unexpected Neon usage schema');
  let compute=0,egress=0;
  for(const period of project.periods)for(const frame of period.consumption||[])for(const m of frame.metrics||[]) {
    if(!Number.isFinite(m.value)||m.value<0)throw Error('Invalid Neon usage value');
    if(m.metric_name==='compute_unit_seconds')compute+=m.value;
    if(m.metric_name==='public_network_transfer_bytes')egress+=m.value;
  }
  return {compute_cu_hours:compute/3600,egress_bytes:egress};
}
async function queryEvents(fetcher,token,account,from,to) {
  let calls=0;const seen=new Map();
  async function window(a,b) {
    if(++calls>63)throw Error('Gateway telemetry exceeds bounded query capacity');
    const d=await json(fetcher,`https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`,token,{queryId:'pack1-launch-watch',timeframe:{from:a,to:b},dry:true,limit:200,view:'events',parameters:{datasets:['cloudflare-workers'],filterCombination:'and',filters:[{key:'$metadata.service',operation:'eq',type:'string',value:'pack1-gateway'},{key:'event',operation:'eq',type:'string',value:'gateway_request'}]}});
    const rows=d.result?.events?.events;if(!Array.isArray(rows))throw Error('Unexpected gateway log schema');
    if(rows.length>=200){if(b-a<1000)throw Error('Gateway telemetry truncated');const mid=Math.floor((a+b)/2);await window(a,mid);await window(mid,b);return;}
    for(const row of rows){const event=parseGatewayEvent(row);if(event?.id)seen.set(event.id,event);}
  }
  await window(from,to);return [...seen.values()];
}
async function usage(fetcher,env,account,now) {
  // Complete UTC day avoids treating partially reported current-hour metrics as complete.
  const to=new Date(now);to.setUTCHours(0,0,0,0);const from=new Date(to-86400000);
  const cf=await json(fetcher,'https://api.cloudflare.com/client/v4/graphql',env.CLOUDFLARE_EDGE_TOKEN,{query:'query($account: string, $from: string, $to: string) { viewer { accounts(filter: {accountTag: $account}) { workersInvocationsAdaptive(limit: 1, filter: {scriptName: "pack1-gateway", datetime_geq: $from, datetime_lt: $to}) { sum { requests errors } } } } }',variables:{account,from:from.toISOString(),to:to.toISOString()}});
  const rows=cf.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
  if(!Array.isArray(rows))throw Error('Unexpected Worker usage schema');
  const project=await json(fetcher,'https://console.neon.tech/api/v2/projects/'+PROJECT,env.NEON_API_KEY);
  const org=project.project?.org_id;if(!/^[a-z0-9-]{1,60}$/.test(org||''))throw Error('Neon project organization unavailable');
  const params=new URLSearchParams({org_id:org,project_ids:PROJECT,from:from.toISOString(),to:to.toISOString(),granularity:'daily',metrics:'compute_unit_seconds,public_network_transfer_bytes'});
  let neon;
  try {neon=parseNeonUsage(await json(fetcher,'https://console.neon.tech/api/v2/consumption_history/v2/projects?'+params,env.NEON_API_KEY));}
  catch(error) {
    if(![403,404].includes(error.status))throw error;
    params.delete('org_id');params.set('metrics','compute_time_seconds');
    try {
      const legacy=await json(fetcher,'https://console.neon.tech/api/v2/consumption_history/projects?'+params,env.NEON_API_KEY);
      const selected=legacy.projects?.find(p=>p.project_id===PROJECT);
      if(!selected?.periods||!Number.isFinite(project.project.data_transfer_bytes))throw Error('Legacy Neon usage unavailable');
      const frames=selected.periods.flatMap(p=>p.consumption||[]);
      if(frames.some(f=>!Number.isFinite(f.compute_time_seconds)))throw Error('Legacy Neon compute usage unavailable');
      neon={compute_cu_hours:frames.reduce((n,f)=>n+f.compute_time_seconds,0)/3600,billing_period_egress_bytes:project.project.data_transfer_bytes,billing_period_start:project.project.consumption_period_start,source:'legacy consumption history; egress is current billing period, not daily'};
    } catch(legacyError) {
      if(![403,404].includes(legacyError.status))throw legacyError;
      const p=project.project;
      if(!Number.isFinite(p.compute_time_seconds)||!Number.isFinite(p.data_transfer_bytes)||!p.consumption_period_start)throw Error('Neon project usage counters unavailable');
      neon={billing_period_compute_cu_hours:p.compute_time_seconds/3600,billing_period_egress_bytes:p.data_transfer_bytes,billing_period_start:p.consumption_period_start,source:'project billing-period counters; daily Neon history unavailable'};
    }
  }
  return {day:from.toISOString().slice(0,10),scope:'entire Neon project including CI branches; production gateway only',worker_requests:rows.reduce((n,r)=>n+(r.sum?.requests||0),0),...neon};
}
export async function routeAlert(fetcher,env,report) {
  if(!report.alerts.length)return 'none';
  if(!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY||''))throw Error('Invalid alert repository');
  const base='https://api.github.com/repos/'+env.GITHUB_REPOSITORY;
  const issues=await json(fetcher,base+'/issues?state=open&per_page=100',env.GITHUB_TOKEN);
  const existing=issues.find(i=>i.title===TITLE&&!i.pull_request);
  // One open incident; no repeated comments or unsolicited person assignments.
  if(existing)return 'existing';
  const body='Production launch thresholds exceeded. Follow [the runbook](../blob/main/docs/LAUNCH-OPERATIONS.md).\n\n```json\n'+JSON.stringify(report,null,2)+'\n```\n\nClose after investigation and recovery. Missing telemetry is an alert, never a healthy result.';
  await json(fetcher,base+'/issues',env.GITHUB_TOKEN,{title:TITLE,body});return 'created';
}
export async function run({fetcher=fetch,env=process.env,now=Date.now(),mode='check'}={}) {
  const report={at:new Date(now).toISOString(),thresholds,alerts:[]};
  try {
    const zones=await json(fetcher,'https://api.cloudflare.com/client/v4/zones?name=packone.pro&per_page=50',env.CLOUDFLARE_EDGE_TOKEN);
    const zone=zones.result?.filter(z=>z.name==='packone.pro'&&z.status==='active');
    if(zone?.length!==1||!/^[a-f0-9]{32}$/.test(zone[0].account?.id))throw Error('Unexpected Cloudflare account');
    const account=zone[0].account.id;
    const events=await queryEvents(fetcher,env.CLOUDFLARE_EDGE_TOKEN,account,now-15*60000,now);
    Object.assign(report,evaluate(events,await usage(fetcher,env,account,now)));
  } catch(error) {report.alerts.push('telemetry_unavailable');report.error=String(error.message).slice(0,180);}
  fs.mkdirSync('artifacts/launch-alert',{recursive:true});fs.writeFileSync('artifacts/launch-alert/report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  if(mode==='alert')console.log('Launch alert route: '+await routeAlert(fetcher,env,report));
  if(report.alerts.includes('telemetry_unavailable'))throw Error('Launch telemetry access failed');
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run({mode:process.argv[2]||'check'}).catch(()=>{console.error('Launch watcher failed; inspect sanitized report.');process.exitCode=1;});
