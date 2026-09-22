import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';

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
  const body=await cfJson('/accounts/'+accountId+'/workers/observability/telemetry/query',{
    method:'POST',
    body:JSON.stringify({
      queryId:'pack1-authhook-service-proof',
      timeframe:{from,to},
      dry:true,
      limit:200,
      parameters:{
        datasets:['cloudflare-workers'],
        filterCombination:'and',
        filters:[{key:'$metadata.service',operation:'eq',type:'string',value:service}],
        view:'events',
      },
    }),
  });
  const rows=body?.result?.events?.events;
  return Array.isArray(rows)?rows:[];
}
async function proveProductionService(){
  const accountId=await cloudflareAccountId();
  const started=Date.now();
  const health=await fetch(PROD_HEALTH,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!health.ok)throw Error('Production authhook health probe failed with HTTP '+health.status+'.');
  for(let attempt=0;attempt<36;attempt++){
    if(attempt)await sleep(5000);
    const now=Date.now();
    const rows=await serviceEvents(accountId,PROD_SERVICE,started-60000,now);
    const hits=rows.filter(row=>
      row?.$metadata?.service===PROD_SERVICE &&
      Number.isFinite(Number(row?.timestamp)) &&
      Number(row.timestamp)>=started-5000
    );
    if(hits.length){
      const sample=hits.at(-1);
      console.log('PRODUCTION_SERVICE_PROOF '+JSON.stringify({
        health_status:health.status,
        service:PROD_SERVICE,
        matching_events:hits.length,
        sample_type:typeof sample?.$metadata?.type==='string'?sample.$metadata.type:null,
        sample_level:typeof sample?.$metadata?.level==='string'?sample.$metadata.level:null,
      }));
      return;
    }
  }
  throw Error('No retained production authhook event appeared for known post-probe traffic.');
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
    webhook_url:source.webhook_url||source.url||null,
    enabled_events:Array.isArray(source.enabled_events)?source.enabled_events:[],
    timeout_seconds:source.timeout_seconds??source.timeout??null,
  };
}
function getWebhookConfig(){
  return safeWebhookConfig(runNeonJson([
    'neon-auth','config','webhook','get',
    '--project-id',QA_PROJECT,
    '--branch',QA_BRANCH,
  ]));
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
async function authPost(pathname,body){
  const response=await fetch(QA_AUTH_BASE+pathname,{
    method:'POST',
    headers:{origin:QA_ORIGIN,'content-type':'application/json'},
    body:JSON.stringify(body),
    redirect:'manual',
    signal:AbortSignal.timeout(30000),
  });
  const text=await response.text();
  let json=null;
  try{json=text?JSON.parse(text):null;}catch{}
  return {status:response.status,json};
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
  if(original.enabled)throw Error('Disposable QA webhook is unexpectedly enabled; refusing to overwrite it.');

  const before=await qaTelemetry();
  const prior=new Set(before.map(entry=>JSON.stringify(entry)));
  const run=String(process.env.GITHUB_RUN_ID||Date.now());
  const attempt=String(process.env.GITHUB_RUN_ATTEMPT||'1');
  const email='pack1-alert-proof-'+run+'-'+attempt+'@example.com';
  const password='P1-'+randomBytes(24).toString('base64url')+'!';
  console.log('::add-mask::'+password);
  let changed=false;
  try{
    const signup=await authPost('/sign-up/email',{email,password,name:'Pack One Alert Proof'});
    if(signup.status<200||signup.status>=300)throw Error('QA proof signup failed with HTTP '+signup.status+'.');

    const enabled=updateWebhookConfig({
      enabled:true,
      webhook_url:QA_WORKER+'/webhook',
      enabled_events:['send.magic_link'],
      timeout_seconds:5,
    });
    changed=true;
    console.log('QA_ALERT_PROOF_ENABLED_CONFIG '+JSON.stringify(enabled));

    const reset=await authPost('/request-password-reset',{email,redirectTo:QA_ORIGIN+'/reset-password/'});
    if(reset.status<200||reset.status>=300)throw Error('QA proof reset request failed with HTTP '+reset.status+'.');

    let match=null;
    for(let poll=0;poll<30;poll++){
      await sleep(1000);
      const entries=await qaTelemetry();
      match=entries.find(entry=>
        !prior.has(JSON.stringify(entry)) &&
        entry?.status==='delivery_failure' &&
        entry?.event_type==='send.magic_link' &&
        entry?.link_type==='forget-password'
      )||null;
      if(match)break;
    }
    if(!match)throw Error('QA proof never observed the natural delivery_failure telemetry.');
    const forced=before.length?null:null;
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
