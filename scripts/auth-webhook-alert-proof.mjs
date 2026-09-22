import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {removeProviderUser} from '../worker/account-deletion.mjs';

const CF_ZONE='packone.pro';
const PROD_SERVICE='pack1-authhook';
const PROD_HEALTH='https://pack1-authhook.killjoy00.workers.dev/health?quick=1';
const QA_PROJECT='patient-shadow-91417882';
const QA_BRANCH='br-shy-resonance-ayf5djjc';
const QA_AUTH_BASE='https://ep-still-math-ayzm00u3.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth';
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
      parameters:{datasets:['cloudflare-workers'],filterCombination:'and',filters},
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
  for(let attempt=0;attempt<24;attempt++){
    if(attempt)await sleep(5000);
    const rows=await serviceEvents(accountId,null,started-60000,Date.now());
    const recent=rows.filter(row=>Number.isFinite(Number(row?.timestamp))&&Number(row.timestamp)>=started-5000);
    if(!recent.length)continue;
    const hits=recent.filter(row=>row?.$metadata?.service===PROD_SERVICE);
    if(!hits.length)throw Error('Retained production traffic exists, but none uses the expected pack1-authhook service value.');
    console.log('PRODUCTION_SERVICE_PROOF '+JSON.stringify({
      health_status:health.status,
      service:PROD_SERVICE,
      matching_events:hits.length,
    }));
    return;
  }
  throw Error('No retained cloudflare-workers events appeared after the known production health request.');
}

async function qaWebhookConfig(method='GET',value=null){
  requireSecret(process.env.NEON_API_KEY,'NEON_API_KEY');
  const endpoint='https://console.neon.tech/api/v2/projects/'+QA_PROJECT+'/branches/'+QA_BRANCH+'/auth/webhooks';
  const response=await fetch(endpoint,{
    method,
    headers:{
      accept:'application/json',
      authorization:'Bearer '+process.env.NEON_API_KEY,
      ...(value?{'content-type':'application/json'}:{}),
    },
    ...(value?{body:JSON.stringify(value)}:{}),
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw Error('Disposable Auth webhook API failed with HTTP '+response.status+'.');
  return response.json();
}
function safeWebhookConfig(value){
  return {
    enabled:Boolean(value?.enabled),
    webhook_url:typeof value?.webhook_url==='string'?value.webhook_url:'',
    enabled_events:Array.isArray(value?.enabled_events)?value.enabled_events:[],
    timeout_seconds:Number(value?.timeout_seconds||0),
  };
}
function exactQaWebhook(config){
  return config.enabled===true
    && config.webhook_url===QA_WORKER+'/webhook'
    && config.enabled_events.length===1
    && config.enabled_events[0]==='send.magic_link'
    && config.timeout_seconds===5;
}
async function postAuth(pathname,body){
  const response=await fetch(QA_AUTH_BASE+pathname,{
    method:'POST',
    headers:{origin:QA_ORIGIN,'content-type':'application/json'},
    body:JSON.stringify(body),
    redirect:'manual',
    signal:AbortSignal.timeout(30000),
  });
  const data=await response.json().catch(()=>({}));
  return {status:response.status,data};
}
async function qaTelemetry(){
  const response=await fetch(QA_WORKER+'/qa/telemetry',{redirect:'error',signal:AbortSignal.timeout(15000)});
  const body=await response.json().catch(()=>null);
  if(!response.ok||!Array.isArray(body?.entries))throw Error('QA authhook telemetry endpoint is unavailable.');
  return body.entries;
}
function runNeon(args){
  const bin=String(process.env.NEON_BIN||'');
  if(!bin)throw Error('NEON_BIN is required.');
  try{
    return execFileSync(bin,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:process.env});
  }catch(error){
    throw Error('Neon cleanup command failed; exit '+(Number.isInteger(error?.status)?error.status:'unknown')+'.');
  }
}
function servicePrincipalUnlinked(serviceId){
  if(!/^[0-9a-f-]{36}$/i.test(String(serviceId||'')))return false;
  const sql="SELECT count(*) FROM account_links WHERE auth_user_id='"+serviceId+"'::uuid";
  const output=runNeon(['psql',QA_BRANCH,'--project-id',QA_PROJECT,'--database-name','pack1','--','-XAtc',sql]).trim();
  return output==='0';
}
async function deleteDisposableUser(userId){
  if(!userId)return;
  const result=await removeProviderUser({
    authBase:QA_AUTH_BASE,
    authUserId:userId,
    validateServicePrincipal:async serviceId=>servicePrincipalUnlinked(serviceId),
  });
  if(!['success','not_found'].includes(result.kind))
    throw Error('Disposable Auth user cleanup failed: '+String(result.code||result.kind)+'.');
  console.log('QA_ALERT_PROOF_USER_CLEANUP '+result.kind);
}
async function triggerGenuineQaFault(){
  const original=safeWebhookConfig(await qaWebhookConfig());
  console.log('QA_ALERT_PROOF_ORIGINAL_CONFIG '+JSON.stringify(original));
  const desired={
    enabled:true,
    webhook_url:QA_WORKER+'/webhook',
    enabled_events:['send.magic_link'],
    timeout_seconds:5,
  };
  if(original.enabled&&!exactQaWebhook(original))throw Error('Disposable Auth webhook is already enabled with a different configuration; refusing to overwrite it.');

  const before=await qaTelemetry();
  const prior=new Set(before.map(entry=>JSON.stringify(entry)));
  const run=String(process.env.GITHUB_RUN_ID||Date.now());
  const attempt=String(process.env.GITHUB_RUN_ATTEMPT||'1');
  const email='pack1-alert-proof-'+run+'-'+attempt+'@example.com';
  const password='P1-'+randomBytes(24).toString('base64url')+'!';
  console.log('::add-mask::'+password);

  let changed=false;
  let userId=null;
  let primaryError=null;
  try{
    const signup=await postAuth('/sign-up/email',{email,password,name:'Pack One Alert Proof'});
    if(signup.status<200||signup.status>=300)throw Error('Disposable Auth signup failed with HTTP '+signup.status+'.');
    userId=String(signup.data?.user?.id||signup.data?.id||'');
    if(!/^[0-9a-f-]{36}$/i.test(userId))throw Error('Disposable Auth signup did not return a valid user id.');

    if(!exactQaWebhook(original)){
      const enabled=safeWebhookConfig(await qaWebhookConfig('PUT',desired));
      if(!exactQaWebhook(enabled))throw Error('Disposable Auth webhook did not match the exact proof configuration.');
      changed=true;
      console.log('QA_ALERT_PROOF_ENABLED_CONFIG '+JSON.stringify(enabled));
    }

    const reset=await postAuth('/request-password-reset',{email,redirectTo:QA_ORIGIN+'/reset-password/'});
    if(reset.status<200||reset.status>=300)throw Error('Disposable Auth reset request failed with HTTP '+reset.status+'.');

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
  }catch(error){
    primaryError=error;
  }

  const cleanupErrors=[];
  if(changed){
    try{
      const restored=safeWebhookConfig(await qaWebhookConfig('PUT',original));
      console.log('QA_ALERT_PROOF_FINAL_CONFIG '+JSON.stringify(restored));
    }catch(error){cleanupErrors.push('webhook restore: '+String(error?.message||'failed'));}
  }
  if(userId){
    try{await deleteDisposableUser(userId);}
    catch(error){cleanupErrors.push('user cleanup: '+String(error?.message||'failed'));}
  }
  if(primaryError)throw primaryError;
  if(cleanupErrors.length)throw Error('QA alert proof cleanup failed: '+cleanupErrors.join('; ')+'.');
}

const mode=process.argv[2];
if(mode==='production-service')await proveProductionService();
else if(mode==='qa-fault')await triggerGenuineQaFault();
else throw Error('Unknown authhook alert proof mode.');
