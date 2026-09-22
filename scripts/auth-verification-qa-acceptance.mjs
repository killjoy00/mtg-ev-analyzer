import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const PROJECT='patient-shadow-91417882';
const BRANCH='br-old-surf-ayfjob8u';
const PROD_BRANCH='br-orange-feather-ayps8kep';
const DEV_BRANCH='br-twilight-hill-ayffyd2b';
const AUTH_BASE='https://ep-jolly-water-ayanc5ju.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth';
const WORKER='pack1-authverify-qa-temp';
const PROD_WEBHOOK='https://pack1-authhook.killjoy00.workers.dev/webhook';

function assert(condition,message){if(!condition)throw Error(message);}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function safeEmailConfig(value){
  const source=value?.email_and_password||value?.config||value||{};
  return {
    enabled:Boolean(source.enabled),
    email_verification_method:String(source.email_verification_method||''),
    require_email_verification:Boolean(source.require_email_verification),
    auto_sign_in_after_verification:Boolean(source.auto_sign_in_after_verification),
    send_verification_email_on_sign_up:Boolean(source.send_verification_email_on_sign_up??source.verify_email_on_sign_up),
    send_verification_email_on_sign_in:Boolean(source.send_verification_email_on_sign_in??source.verify_email_on_sign_in),
    disable_sign_up:Boolean(source.disable_sign_up??(source.allow_sign_up===false)),
  };
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
function run(binary,args,input){
  try{
    return execFileSync(binary,args,{
      input,
      encoding:'utf8',
      stdio:['pipe','pipe','pipe'],
      env:{...process.env,CLOUDFLARE_API_TOKEN:process.env.CLOUDFLARE_EDGE_TOKEN},
    });
  }catch(error){
    const status=Number.isInteger(error?.status)?error.status:'unknown';
    throw Error('QA acceptance command failed; exit '+status+'.');
  }
}
function parseJson(stdout,label){
  try{return JSON.parse(stdout);}
  catch{throw Error(label+' returned unexpected output.');}
}
function tool(name){
  if(!process.env.EDGE_TOOLS_DIR)throw Error('Pinned QA acceptance tools are missing.');
  return path.join(process.env.EDGE_TOOLS_DIR,'node_modules/.bin',name);
}
async function neonJson(route,{method='GET',body}={}){
  const response=await fetch('https://console.neon.tech/api/v2'+route,{
    method,
    headers:{
      authorization:'Bearer '+process.env.NEON_API_KEY,
      accept:'application/json',
      ...(body===undefined?{}:{'content-type':'application/json'}),
    },
    body:body===undefined?undefined:JSON.stringify(body),
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw Error('Neon QA acceptance control failed with HTTP '+response.status+'.');
  return response.json();
}
async function cf(route,{method='GET',allow404=false}={}){
  const response=await fetch('https://api.cloudflare.com/client/v4'+route,{
    method,
    headers:{authorization:'Bearer '+process.env.CLOUDFLARE_EDGE_TOKEN},
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  if(allow404&&response.status===404)return null;
  if(!response.ok)throw Error('Cloudflare QA acceptance control failed with HTTP '+response.status+'.');
  const body=await response.json();
  if(!body.success)throw Error('Cloudflare rejected QA acceptance control.');
  return body.result;
}
async function cloudflareContext(){
  const zones=await cf('/zones?name=packone.pro&per_page=50');
  if(!Array.isArray(zones)||zones.length!==1||zones[0].status!=='active')throw Error('Expected the active Pack One Cloudflare zone.');
  const accountId=zones[0].account?.id;
  assert(/^[a-f0-9]{32}$/.test(accountId||''),'Invalid Cloudflare account id.');
  const accountSubdomain=(await cf('/accounts/'+accountId+'/workers/subdomain'))?.subdomain;
  assert(/^[a-z0-9-]+$/.test(accountSubdomain||''),'Workers.dev subdomain is unavailable.');
  return {accountId,accountSubdomain};
}
async function waitHealth(base,commit){
  for(let i=0;i<20;i+=1){
    try{
      const response=await fetch(base+'/health?quick=1',{redirect:'error',signal:AbortSignal.timeout(5000)});
      if(response.ok){
        const body=await response.json();
        if(body?.environment==='qa'&&body?.release_commit===commit)return;
      }
    }catch{}
    await sleep(750);
  }
  throw Error('Temporary verification QA Worker health check failed.');
}
function emailGet(neon){
  return safeEmailConfig(parseJson(run(neon,[
    'neon-auth','config','email-password','get',
    '--project-id',PROJECT,'--branch',BRANCH,'--output','json',
  ]),'Email/password config'));
}
function emailUpdate(neon,value){
  const config=safeEmailConfig(value);
  run(neon,[
    'neon-auth','config','email-password','update',
    '--project-id',PROJECT,'--branch',BRANCH,
    '--enabled='+String(config.enabled),
    '--email-verification-method',config.email_verification_method,
    '--require-email-verification='+String(config.require_email_verification),
    '--auto-sign-in-after-verification='+String(config.auto_sign_in_after_verification),
    '--send-verification-email-on-sign-up='+String(config.send_verification_email_on_sign_up),
    '--send-verification-email-on-sign-in='+String(config.send_verification_email_on_sign_in),
    '--disable-sign-up='+String(config.disable_sign_up),
  ]);
  return emailGet(neon);
}
function webhookGet(neon){
  return safeWebhookConfig(parseJson(run(neon,[
    'neon-auth','config','webhook','get',
    '--project-id',PROJECT,'--branch',BRANCH,'--output','json',
  ]),'Webhook config'));
}
function webhookUpdate(neon,value){
  const args=[
    'neon-auth','config','webhook','update',
    '--project-id',PROJECT,'--branch',BRANCH,
    '--enabled='+String(Boolean(value.enabled)),
  ];
  if(value.webhook_url)args.push('--url',value.webhook_url);
  for(const event of value.enabled_events||[])args.push('--enabled-events',event);
  if(Number.isInteger(value.timeout_seconds))args.push('--timeout',String(value.timeout_seconds));
  run(neon,args);
  return webhookGet(neon);
}
async function authPost(pathname,body){
  const response=await fetch(AUTH_BASE+pathname,{
    method:'POST',
    headers:{origin:'https://packone.pro','content-type':'application/json'},
    body:JSON.stringify(body),
    redirect:'manual',
    signal:AbortSignal.timeout(20000),
  });
  const text=await response.text();
  let json=null;
  try{json=text?JSON.parse(text):null;}catch{}
  return {status:response.status,json};
}
async function waitSignin(email,password){
  let last=0;
  for(let i=0;i<20;i+=1){
    const signin=await authPost('/sign-in/email',{email,password,rememberMe:true});
    last=signin.status;
    if(signin.status>=200&&signin.status<300&&Boolean(signin.json?.token||signin.json?.session?.token))return signin;
    await sleep(500);
  }
  throw Error('Verified QA user could not sign in; last HTTP '+last+'.');
}
async function telemetry(workerBase){
  const response=await fetch(workerBase+'/qa/telemetry',{redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('QA verification telemetry unavailable.');
  return response.json();
}
function configEqual(a,b){return JSON.stringify(a)===JSON.stringify(b);}

async function main(){
  for(const [name,value] of Object.entries({
    NEON_API_KEY:process.env.NEON_API_KEY,
    CLOUDFLARE_EDGE_TOKEN:process.env.CLOUDFLARE_EDGE_TOKEN,
    PACK1_AUTH_RESEND_API_KEY:process.env.PACK1_AUTH_RESEND_API_KEY,
  }))assert(typeof value==='string'&&value.length>=20,name+' is missing or too short.');
  assert(process.env.PACK1_AUTH_RESEND_API_KEY.startsWith('re_'),'Resend credential format is invalid.');
  assert(BRANCH!==PROD_BRANCH&&BRANCH!==DEV_BRANCH,'QA acceptance must target a disposable branch.');
  const commit=String(process.env.GITHUB_SHA||'');
  assert(/^[a-f0-9]{40}$/.test(commit),'Exact acceptance revision is required.');

  const branch=await neonJson('/projects/'+PROJECT+'/branches/'+BRANCH);
  assert(branch?.branch?.parent_id===PROD_BRANCH||branch?.parent_id===PROD_BRANCH,'QA acceptance branch must be a child of production.');
  const meta=branch?.branch||branch;
  assert(meta.default===false&&meta.protected===false,'QA acceptance branch must be non-default and non-protected.');
  assert(Boolean(meta.expires_at),'QA acceptance branch must expire automatically.');

  const neon=tool('neon');
  const wrangler=tool('wrangler');
  const originalEmail=emailGet(neon);
  const originalWebhook=webhookGet(neon);
  console.log('AUTH_VERIFY_QA_ORIGINAL_EMAIL '+JSON.stringify(originalEmail));
  console.log('AUTH_VERIFY_QA_ORIGINAL_WEBHOOK '+JSON.stringify(originalWebhook));
  assert(originalEmail.email_verification_method==='otp'&&!originalEmail.require_email_verification&&!originalEmail.send_verification_email_on_sign_up,'Disposable branch email baseline is unexpected.');
  assert(originalWebhook.enabled&&originalWebhook.webhook_url===PROD_WEBHOOK&&originalWebhook.enabled_events.includes('send.magic_link'),'Disposable branch webhook baseline is unexpected.');

  const {accountId,accountSubdomain}=await cloudflareContext();
  const workerRoute='/accounts/'+accountId+'/workers/scripts/'+WORKER;
  if(await cf(workerRoute+'/settings',{allow404:true}))await cf(workerRoute,{method:'DELETE'});
  const configPath=path.join(process.env.RUNNER_TEMP,'auth-verification-qa-wrangler.json');
  const workerConfig={
    name:WORKER,
    main:path.resolve('edge/auth-webhook.mjs'),
    account_id:accountId,
    compatibility_date:'2026-09-01',
    compatibility_flags:['nodejs_compat'],
    workers_dev:true,
    preview_urls:false,
    observability:{enabled:true},
    durable_objects:{bindings:[{name:'RECOVERY_DEDUPE',class_name:'RecoveryEventDedupe'}]},
    migrations:[{tag:'v1',new_sqlite_classes:['RecoveryEventDedupe']}],
    vars:{
      AUTH_BASE,
      PACK1_AUTH_ENV:'qa',
      RESET_ORIGIN:'https://packone.pro',
      SENDER:'Pack One QA <qa-accounts@packone.pro>',
      SUBJECT:'Reset Your Password - Pack One QA',
      VERIFICATION_SUBJECT:'Verify Your Email - Pack One QA',
      PACK1_RELEASE_COMMIT:commit,
      PACK1_FORCE_DELIVERY_FAILURE:'0',
      PACK1_FORCE_RETRY_AFTER_SEND:'0',
      PACK1_QA_AUTO_VERIFY_AFTER_SEND:'1',
    },
  };
  fs.writeFileSync(configPath,JSON.stringify(workerConfig),{mode:0o600});
  const workerBase='https://'+WORKER+'.'+accountSubdomain+'.workers.dev';

  let emailChanged=false;
  let webhookChanged=false;
  let authUserId=null;
  let primaryError=null;
  try{
    run(wrangler,['deploy','--config',configPath]);
    run(wrangler,['secret','bulk','--config',configPath],JSON.stringify({RESEND_API_KEY:process.env.PACK1_AUTH_RESEND_API_KEY}));
    await waitHealth(workerBase,commit);

    webhookChanged=true;
    const probeWebhook=webhookUpdate(neon,{
      enabled:true,
      webhook_url:workerBase+'/webhook',
      enabled_events:['send.magic_link'],
      timeout_seconds:5,
    });
    assert(probeWebhook.enabled&&probeWebhook.webhook_url===workerBase+'/webhook','QA verification webhook did not reach the temporary Worker.');

    emailChanged=true;
    const probeEmail=emailUpdate(neon,{
      ...originalEmail,
      email_verification_method:'link',
      require_email_verification:true,
      send_verification_email_on_sign_up:true,
      send_verification_email_on_sign_in:false,
      disable_sign_up:false,
    });
    assert(probeEmail.email_verification_method==='link'&&probeEmail.require_email_verification&&probeEmail.send_verification_email_on_sign_up,'QA link verification mode did not enable.');

    const email='delivered@resend.dev';
    const password='P1-'+randomBytes(24).toString('base64url')+'!';
    console.log('::add-mask::'+password);
    const signup=await authPost('/sign-up/email',{name:'Pack One Verification QA',email,password});
    assert(signup.status>=200&&signup.status<300,'QA verification signup failed with HTTP '+signup.status+'.');
    authUserId=signup.json?.user?.id||signup.json?.id||null;
    assert(authUserId,'QA verification signup did not return a user id.');
    assert(!signup.json?.session&&!signup.json?.token,'QA verification signup unexpectedly returned an authenticated session.');
    console.log('AUTH_VERIFY_QA_SIGNUP '+JSON.stringify({status:signup.status,user_present:true,session_present:false}));

    const signin=await waitSignin(email,password);
    console.log('AUTH_VERIFY_QA_SIGNIN_AFTER '+JSON.stringify({
      status:signin.status,
      session_present:Boolean(signin.json?.token||signin.json?.session?.token),
      email_verified:signin.json?.user?.emailVerified??signin.json?.user?.email_verified??null,
    }));

    const reset=await authPost('/request-password-reset',{email,redirectTo:'https://packone.pro/reset-password/'});
    assert(reset.status>=200&&reset.status<300,'QA password reset request failed with HTTP '+reset.status+'.');
    console.log('AUTH_VERIFY_QA_RESET_REQUEST '+JSON.stringify({status:reset.status}));

    await sleep(1000);
    const qaTelemetry=await telemetry(workerBase);
    const entries=Array.isArray(qaTelemetry?.entries)?qaTelemetry.entries:[];
    assert(entries.some(entry=>entry.status==='sent_or_duplicate'&&entry.link_type==='email-verification'),'QA telemetry did not record successful verification delivery.');
    assert(entries.some(entry=>entry.status==='sent_or_duplicate'&&entry.link_type==='forget-password'),'QA telemetry did not record successful recovery delivery.');
    console.log('AUTH_VERIFY_QA_TELEMETRY '+JSON.stringify(entries.map(entry=>({
      status:entry.status,
      event_type:entry.event_type||null,
      link_type:entry.link_type||null,
      duplicate:Boolean(entry.duplicate),
    }))));
  }catch(error){
    primaryError=error;
  }finally{
    const rollback=[];
    if(emailChanged){
      try{
        const restored=emailUpdate(neon,originalEmail);
        if(!configEqual(restored,originalEmail))throw Error('email mismatch');
        console.log('AUTH_VERIFY_QA_FINAL_EMAIL '+JSON.stringify(restored));
      }catch{rollback.push('email config');}
    }
    if(webhookChanged){
      try{
        const restored=webhookUpdate(neon,originalWebhook);
        if(!configEqual(restored,originalWebhook))throw Error('webhook mismatch');
        console.log('AUTH_VERIFY_QA_FINAL_WEBHOOK '+JSON.stringify(restored));
      }catch{rollback.push('webhook config');}
    }
    if(authUserId){
      try{run(neon,['neon-auth','user','delete',authUserId,'--project-id',PROJECT,'--branch',BRANCH]);}
      catch{rollback.push('synthetic user');}
    }
    try{
      if(await cf(workerRoute+'/settings',{allow404:true})){
        await cf(workerRoute,{method:'DELETE'});
        if(await cf(workerRoute+'/settings',{allow404:true}))throw Error('worker remains');
      }
      console.log('AUTH_VERIFY_QA_WORKER_CLEANED true');
    }catch{rollback.push('temporary Worker');}
    if(rollback.length)throw Error('QA verification rollback failed for '+rollback.join(', ')+'.');
  }
  if(primaryError)throw primaryError;
  console.log('AUTH_VERIFY_QA_COMPLETE true');
}

main().catch(error=>{
  const message=String(error?.message||'');
  console.error(/^(QA|AUTH|Neon|Cloudflare|Expected|Invalid|Workers\.dev|Pinned|Exact|Resend|Disposable|Verified)/.test(message)?message:'Email verification QA acceptance failed; inspect sanitized step status.');
  process.exitCode=1;
});
