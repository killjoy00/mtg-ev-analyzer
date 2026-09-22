import path from 'node:path';
import {execFileSync} from 'node:child_process';
const CF_ZONE='packone.pro';
const PROD_SERVICE='pack1-authhook';
const PROD_HEALTH='https://pack1-authhook.killjoy00.workers.dev/health?quick=1';
const QA_PROJECT='late-fire-55708539';
const QA_BRANCH='br-dry-sun-b5oe9snz';
const QA_AUTH_BASE='https://ep-holy-hall-b5uw4nql.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';
const QA_WORKER='https://pack1-authhook-qa.killjoy00.workers.dev';
const QA_ORIGIN='http://localhost:4173';

async function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function requireSecret(value,name){
  if(typeof value!=='string'||value.length<20)throw Error(name+' is missing or too short.');
}
async function cfJson(route,options={}){
  requireSecret(process.env.CLOUDFLARE_EDGE_TOKEN,'CLOUDFLARE_EDGE_TOKEN');
  const response=await fetch('https://api.cloudflare.com/client/v4'+route,{
    ...options,
    headers:{
      accept:'application/json',
      authorization:'Bearer '+process.env.CLOUDFLARE_EDGE_TOKEN,
      ...(options.body?{'content-type':'application/json'}:{}),
      ...(options.headers||{}),
    },
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  const body=await response.json().catch(()=>null);
  if(!response.ok||body?.success===false)throw Error('Cloudflare proof query failed with HTTP '+response.status+'.');
  return body;
}
async function cloudflareAccountId(){
  const zones=await cfJson('/zones?name='+encodeURIComponent(CF_ZONE)+'&per_page=50');
  const active=Array.isArray(zones?.result)?zones.result.filter(zone=>zone?.status==='active'):[];
  const id=active.length===1?active[0]?.account?.id:null;
  if(!/^[a-f0-9]{32}$/.test(id||''))throw Error('Expected one active Pack One Cloudflare account.');
  return id;
}
async function serviceEvents(accountId,service,from,to){
  const filters=service?[{key:'$metadata.service',operation:'eq',type:'string',value:service}]:[];
  const body=await cfJson('/accounts/'+accountId+'/workers/observability/telemetry/query',{
    method:'POST',
    body:JSON.stringify({
      queryId:'pack1-authhook-service-proof',
      timeframe:{from,to},
      dry:true,
      limit:500,
      view:'events',
      parameters:{
        datasets:['cloudflare-workers'],
        filterCombination:'and',
        filters,
      },
    }),
  });
  const rows=body?.result?.events?.events;
  return Array.isArray(rows)?rows:[];
}
function safeEventShape(row){
  const metadata=row?.$metadata&&typeof row.$metadata==='object'?row.$metadata:{};
  return {
    timestamp:typeof row?.timestamp==='number'?row.timestamp:null,
    service:typeof metadata.service==='string'?metadata.service:null,
    type:typeof metadata.type==='string'?metadata.type:null,
    level:typeof metadata.level==='string'?metadata.level:null,
    metadata_keys:Object.keys(metadata).filter(key=>/^[A-Za-z0-9_.-]{1,64}$/.test(key)).sort().slice(0,40),
  };
}
async function proveProductionService(){
  const accountId=await cloudflareAccountId();
  const started=Date.now();
  const health=await fetch(PROD_HEALTH,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!health.ok)throw Error('Production authhook health probe failed with HTTP '+health.status+'.');

  for(let attempt=0;attempt<24;attempt++){
    if(attempt)await sleep(5000);
    const now=Date.now();
    const rows=await serviceEvents(accountId,null,started-60000,now);
    const recent=rows.filter(row=>Number.isFinite(Number(row?.timestamp))&&Number(row.timestamp)>=started-5000);
    if(recent.length){
      const services=[...new Set(recent.map(row=>row?.$metadata?.service).filter(value=>typeof value==='string'&&value.length<=128))].sort();
      const shapes=[];
      for(const row of recent.slice(-20))shapes.push(safeEventShape(row));
      console.log('PRODUCTION_SERVICE_DIAGNOSTIC '+JSON.stringify({
        health_status:health.status,
        recent_events:recent.length,
        services,
        shapes,
      }));
      const hits=recent.filter(row=>row?.$metadata?.service===PROD_SERVICE);
      if(hits.length){
        console.log('PRODUCTION_SERVICE_PROOF '+JSON.stringify({
          health_status:health.status,
          service:PROD_SERVICE,
          matching_events:hits.length,
        }));
        return;
      }
      throw Error('Retained production traffic exists, but none uses the expected pack1-authhook service value.');
    }
  }
  throw Error('No retained cloudflare-workers events appeared after the known production health request.');
}

function neonBin(){
  if(!process.env.EDGE_TOOLS_DIR)throw Error('EDGE_TOOLS_DIR is required.');
  return path.join(process.env.EDGE_TOOLS_DIR,'node_modules/.bin/neon');
}
function runNeon(args){
  requireSecret(process.env.NEON_API_KEY,'NEON_API_KEY');
  try{
    return execFileSync(neonBin(),args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:process.env});
  }catch(error){
    throw Error('QA Auth control failed; exit '+(Number.isInteger(error?.status)?error.status:'unknown')+'.');
  }
}
function runNeonJson(args){
  const text=runNeon([...args,'--output','json']).trim();
  return text?JSON.parse(text):null;
}
function safeWebhookConfig(value){
  const source=value?.webhook||value?.config||value||{};
  return {
    enabled:Boolean(source.enabled),
    webhook_url:source.webhook_url||source.url||'',
    enabled_events:Array.isArray(source.enabled_events)?source.enabled_events:[],
    timeout_seconds:Number(source.timeout_seconds??source.timeout??0),
  };
}
function getWebhookConfig(){
  const text=runNeon([
    'neon-auth','config','webhook','get',
    '--project-id',QA_PROJECT,
    '--branch',QA_BRANCH,
    '--output','json',
  ]).trim();
  return safeWebhookConfig(text?JSON.parse(text):null);
}
function updateWebhookConfig(value){
  const args=[
    'neon-auth','config','webhook','update',
    '--project-id',QA_PROJECT,
    '--branch',QA_BRANCH,
    '--enabled='+String(Boolean(value?.enabled)),
  ];
  if(value?.webhook_url)args.push('--url',String(value.webhook_url));
  for(const event of Array.isArray(value?.enabled_events)?value.enabled_events:[])args.push('--enabled-events',String(event));
  if(Number.isFinite(Number(value?.timeout_seconds))&&Number(value.timeout_seconds)>0)args.push('--timeout',String(Number(value.timeout_seconds)));
  runNeon(args);
  return getWebhookConfig();
}
function exactQaWebhook(config){
  return config.enabled===true
    && config.webhook_url===QA_WORKER+'/webhook'
    && config.enabled_events.length===1
    && config.enabled_events[0]==='send.magic_link'
    && config.timeout_seconds===5;
}
async function helperRequest(){
  const response=await fetch(QA_HELPER+'?mode=request',{redirect:'error',signal:AbortSignal.timeout(30000)});
  const text=await response.text();
  let body=null;
  try{body=text?JSON.parse(text):null;}catch{}
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('QA alert helper returned invalid JSON.');
  const allowed=new Set(['ok','stage','user_id','signup_status','request_status','reset_status','signin_status','signup_ms','request_ms','reset_ms','signin_ms','error']);
  for(const key of Object.keys(body))if(!allowed.has(key))throw Error('QA alert helper returned unexpected output.');
  if(/token|password|signature|authorization|cookie/i.test(JSON.stringify(body)))throw Error('QA alert helper output was not sanitized.');
  return {status:response.status,body};
}
async function qaTelemetry(){
  const response=await fetch(QA_WORKER+'/qa/telemetry',{redirect:'error',signal:AbortSignal.timeout(15000)});
  const body=await response.json().catch(()=>null);
  if(!response.ok||!Array.isArray(body?.entries))throw Error('QA authhook telemetry endpoint is unavailable.');
  return body.entries;
}
async function triggerGenuineQaFault(){
  const original=getWebhookConfig();
  console.log('QA_ALERT_PROOF_ORIGINAL_CONFIG '+JSON.stringify(original));
  const desired={
    enabled:true,
    webhook_url:QA_WORKER+'/webhook',
    enabled_events:['send.magic_link'],
    timeout_seconds:5,
  };
  if(original.enabled&&!exactQaWebhook(original))throw Error('QA Auth webhook is already enabled with a different configuration; refusing to overwrite it.');

  const before=await qaTelemetry();
  const prior=new Set(before.map(entry=>JSON.stringify(entry)));
  let changed=false;
  try{
    if(!exactQaWebhook(original)){
      const enabled=updateWebhookConfig(desired);
      if(!exactQaWebhook(enabled))throw Error('QA Auth webhook did not match the exact proof configuration.');
      changed=true;
      console.log('QA_ALERT_PROOF_ENABLED_CONFIG '+JSON.stringify(enabled));
    }

    const helper=await helperRequest();
    if(helper.status!==200||helper.body?.stage!=='request_only')throw Error('QA alert helper did not complete request setup.');
    const requestStatus=Number(helper.body?.request_status||0);
    if(requestStatus<200||requestStatus>=300)throw Error('QA proof reset request was not accepted by Managed Neon.');

    let match=null;
    for(let poll=0;poll<30;poll++){
      await sleep(1000);
      const entries=await qaTelemetry();
      const fresh=entries.filter(entry=>!prior.has(JSON.stringify(entry)));
      match=fresh.find(entry=>
        entry?.status==='delivery_failure' &&
        entry?.event_type==='send.magic_link' &&
        entry?.link_type==='forget-password'
      )||null;
      if(match)break;
    }
    if(!match)throw Error('QA proof never observed the natural delivery_failure telemetry.');
    console.log('QA_ALERT_PROOF_EVENT '+JSON.stringify({
      status:match.status,
      event_type:match.event_type,
      link_type:match.link_type,
      delivery_attempt:String(match.delivery_attempt||''),
    }));
  }finally{
    if(changed){
      const restored=updateWebhookConfig(original);
      console.log('QA_ALERT_PROOF_FINAL_CONFIG '+JSON.stringify(restored));
    }
  }
}

const mode=process.argv[2];
if(mode==='production-service')await proveProductionService();
else if(mode==='qa-fault')await triggerGenuineQaFault();
else throw Error('Unknown authhook alert proof mode.');
