// Read-only provider evidence. No SQL, connection strings, compute wakeups or
// corpus downloads. An unchanged un-timestamped billing counter is not proof
// that the provider has finished accounting for the observation interval.
import fs from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export const PROJECT='patient-shadow-91417882';
export const METRIC='data_transfer_bytes';
export const SCOPE='entire-project/all-branches/public-and-private-network-transfer';
const HOUR=3600000;
const iso=value=>{
 if(typeof value!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error('Invalid evidence timestamp');
 return new Date(value).toISOString();
};
const bytes=value=>{
 if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid transfer byte counter');
 return value;
};
export function projectSnapshot(project,observedAt) {
 if(project?.id!==PROJECT)throw Error('Unexpected Neon project');
 const start=iso(project.consumption_period_start),end=iso(project.consumption_period_end),observed=iso(observedAt);
 if(Date.parse(end)<=Date.parse(start))throw Error('Invalid consumption period');
 return {schema:'neon-egress-counter-v1',provider:'Neon',project_id:PROJECT,
  endpoint:`GET /api/v2/projects/${PROJECT}`,metric:METRIC,unit:'bytes',scope:SCOPE,
  billing_period_start:start,billing_period_end:end,observed_at:observed,
  value:bytes(project.data_transfer_bytes),provider_measurement_at:null,
  freshness:'Provider does not expose a consumption measurement watermark on this response; observed_at is collection time, not measurement time.'};
}
export function compareSnapshots(previous,current) {
 const unknown=reason=>({status:'not_comparable',reason,delta_bytes:null,actual_usage_verified:false});
 if(!previous)return unknown('no_previous_observation');
 for(const key of ['schema','provider','project_id','endpoint','metric','unit','scope','billing_period_start','billing_period_end'])
  if(!previous[key]||previous[key]!==current[key])return unknown(key.startsWith('billing_period_')?'billing_period_changed':`different_or_missing_${key}`);
 let from,to,before,after;
 try {from=iso(previous.observed_at);to=iso(current.observed_at);before=bytes(previous.value);after=bytes(current.value);}catch{return unknown('invalid_observation');}
 const interval=Date.parse(to)-Date.parse(from);
 if(interval<=0)return unknown('non_increasing_observation_time');
 if(Date.parse(from)<Date.parse(current.billing_period_start)||Date.parse(to)>=Date.parse(current.billing_period_end))return unknown('observation_outside_reported_period');
 if(after<before)return unknown('counter_decreased_within_period; provider correction or reset, not negative usage');
 return {status:'reported_counter_delta',from,to,interval_seconds:interval/1000,
  delta_bytes:after-before,reported_bytes_per_hour:(after-before)/(interval/HOUR),
  actual_usage_verified:false,
  interpretation:'Difference between provider-reported counters only; settlement/freshness and causal attribution are not established.'};
}
export function historyWindow(now,{since=null,hours=24,settlementHours=2}={}) {
 if(!Number.isFinite(now)||!Number.isInteger(hours)||hours<1||hours>144||!Number.isInteger(settlementHours)||settlementHours<1||settlementHours>12)throw Error('Invalid history bounds');
 const to=Math.floor((now-settlementHours*HOUR)/HOUR)*HOUR;
 const from=Math.max(to-hours*HOUR,since?Math.ceil(Date.parse(iso(since))/HOUR)*HOUR:-Infinity);
 if(from>=to)throw Error('No complete post-fix hourly interval is available');
 return {from:new Date(from).toISOString(),to:new Date(to).toISOString(),granularity:'hourly',
  settlement_allowance_hours:settlementHours,
  settlement_verified:false};
}
async function get(fetcher,path,key) {
 const response=await fetcher('https://console.neon.tech/api/v2'+path,{headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok){const e=Error('Neon metadata request returned HTTP '+response.status);e.status=response.status;throw e;}
 return response.json();
}
// Preserve the provider's returned periods/frames verbatim instead of treating
// an absent metric, missing branch or empty successful response as zero usage.
// Project data_transfer_bytes and public_network_transfer_bytes are NOT the same
// scope and must never be subtracted from each other.
async function history(fetcher,key,path,params) {
 try {
  const data=await get(fetcher,path+'?'+params,key);
  return {status:'returned_requires_coverage_validation',endpoint:path,request:Object.fromEntries(params),data};
 }catch(error){
  if(![403,404].includes(error.status))throw error;
  return {status:'unavailable',endpoint:path,request:Object.fromEntries(params),http_status:error.status,
   interpretation:'No interval usage or attribution established; unavailable is not zero.'};
 }
}
export async function collectEvidence({fetcher=fetch,key,now=Date.now(),clock=()=>new Date().toISOString(),previous=null,since=null}={}) {
 if(!key)throw Error('NEON_API_KEY is required');
 const response=await get(fetcher,`/projects/${PROJECT}`,key),project=response.project;
 const current=projectSnapshot(project,clock());
 if(!/^[a-z0-9-]{1,60}$/.test(project.org_id||''))throw Error('Missing Neon organization');
 const window=historyWindow(now,{since});
 const params=new URLSearchParams({org_id:project.org_id,project_ids:PROJECT,from:window.from,to:window.to,granularity:'hourly',metrics:'public_network_transfer_bytes,private_network_transfer_bytes'});
 const projectHistory=await history(fetcher,key,'/consumption_history/v2/projects',params);
 // Bounded first page: a returned cursor is explicitly partial attribution,
 // never a license to subtract the visible branches from the project total.
 const branchParams=new URLSearchParams(params);branchParams.set('limit','100');
 const branchHistory=await history(fetcher,key,'/consumption_history/v2/branches',branchParams);
 const report={schema:'neon-egress-evidence-v1',collected_at:current.observed_at,current,
  comparison:compareSnapshots(previous?.current??previous,current),requested_history_window:window,
  project_history:projectHistory,branch_history:branchHistory,
  attribution:{production_branch_id:'br-orange-feather-ayps8kep',development_branch_id:'br-twilight-hill-ayffyd2b',
   other_branches:'Unattributed unless ownership/workflow evidence identifies them. Missing/deleted branches and pagination must be reconciled before claiming complete CI attribution.'},
  threshold_policy:'Thresholds remain in scripts/launch-alert.mjs. This report neither suppresses operational alerts nor closes usage incidents.',
  source_revision:process.env.GITHUB_SHA||null};
 return report;
}
async function main() {
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i++){
  if(!['--previous','--since','--output'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw Error('Usage: node scripts/neon-egress-evidence.mjs [--previous JSON] [--since ISO] [--output JSON]');
  if(options[args[i]])throw Error('Duplicate option');options[args[i]]=args[++i];
 }
 const previous=options['--previous']?JSON.parse(fs.readFileSync(options['--previous'],'utf8')):null;
 const report=await collectEvidence({key:process.env.NEON_API_KEY,previous,since:options['--since']||null});
 const out=options['--output']||'artifacts/neon-egress-evidence/report.json';
 fs.mkdirSync(dirname(resolve(out)),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
