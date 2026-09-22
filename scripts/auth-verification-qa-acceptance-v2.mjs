import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const PROJECT='patient-shadow-91417882';
const BRANCH='br-blue-voice-ayx1qa7q';
const PROD_BRANCH='br-orange-feather-ayps8kep';
const DEV_BRANCH='br-twilight-hill-ayffyd2b';
const AUTH_BASE='https://ep-cool-frost-ay6t2kys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth';
const PROD_WEBHOOK='https://pack1-authhook.killjoy00.workers.dev/webhook';
const WORKER='pack1-authverify-qa-temp';

function assert(value,message){if(!value)throw Error(message);}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function tool(name){
  assert(process.env.EDGE_TOOLS_DIR,'Pinned QA tools are missing.');
  return path.join(process.env.EDGE_TOOLS_DIR,'node_modules/.bin',name);
}
function run(binary,args,input){
  try{
    return execFileSync(binary,args,{
      input,encoding:'utf8',stdio:['pipe','pipe','pipe'],
      env:{...process.env,CLOUDFLARE_API_TOKEN:process.env.CLOUDFLARE_EDGE_TOKEN},
    });
  }catch(error){
    throw Error('QA acceptance command failed; exit '+(Number.isInteger(error?.status)?error.status:'unknown')+'.');
  }
}
function parse(stdout,label){
  try{return JSON.parse(stdout);}
  catch{throw Error(label+' returned unexpected output.');}
}
function emailConfig(value){
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
function webhookConfig(value){
  const source=value?.webhook||value?.config||value||{};
  return {
    enabled:Boolean(source.enabled),
    webhook_url:source.webhook_url||source.url||null,
    enabled_events:Array.isArray(source.enabled_events)?source.enabled_events:[],
    timeout_seconds:source.timeout_seconds??source.timeout??null,
  };
}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
async function neonFetch(route,{method='GET'}={}){
  return fetch('https://console.neon.tech/api/v2'+route,{
    method,
    headers:{authorization:'Bearer '+process.env.NEON_API_KEY,accept:'application/json'},
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
}
async function branchMeta(){
  const response=await neonFetch('/projects/'+PROJECT+'/branches/'+BRANCH);
  assert(response.ok,'Disposable branch metadata read failed.');
  const body=await response.json();
  return body?.branch||body;
}
async function deleteBranch(){
  const route='/projects/'+PROJECT+'/branches/'+BRANCH;
  const response=await neonFetch(route,{method:'DELETE'});
  assert(response.ok||response.status===404,'Disposable branch deletion failed.');
  for(let attempt=0;attempt<10;attempt+=1){
    const check=await neonFetch(route);
    if(check.status===404){
      console.log('AUTH_VERIFY_QA_BRANCH_CLEANED true');
      return;
    }
    await sleep(500);
  }
  throw Error('Disposable branch still exists after deletion.');
}
async function cf(route,{method='GET',allow404=false}={}){
  const response=await fetch('https://api.cloudflare.com/client/v4'+route,{
    method,
    headers:{authorization:'Bearer '+process.env.CLOUDFLARE_EDGE_TOKEN},
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  if(allow404&&response.status===404)return null;
  assert(response.ok,'Cloudflare QA control failed.');
  const body=await response.json();
  assert(body.success,'Cloudflare rejected QA control.');
  return body.result;
}
async function cfContext(){
  const zones=await cf('/zones?name=packone.pro&per_page=50');
  assert(Array.isArray(zones)&&zones.length===1&&zones[0].status==='active','Expected active Pack One zone.');
  const accountId=zones[0].account?.id;
  assert(/^[a-f0-9]{32}$/.test(accountId||''),'Invalid Cloudflare account id.');
  const accountSubdomain=(await cf('/accounts/'+accountId+'/workers/subdomain'))?.subdomain;
  assert(/^[a-z0-9-]+$/.test(accountSubdomain||''),'Workers.dev subdomain unavailable.');
  return {accountId,accountSubdomain};
}
function emailGet(neon){
  return emailConfig(parse(run(neon,[
    'neon-auth','config','email-password','get','--project-id',PROJECT,'--branch',BRANCH,'--output','json',
  ]),'email config'));
}
function emailUpdate(neon,value){
  const config=emailConfig(value);
  run(neon,[
    'neon-auth','config','email-password','update','--project-id',PROJECT,'--branch',BRANCH,
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
  return webhookConfig(parse(run(neon,[
    'neon-auth','config','webhook','get','--project-id',PROJECT,'--branch',BRANCH,'--output','json',
  ]),'webhook config'));
}
function webhookUpdate(neon,value){
  const args=['neon-auth','config','webhook','update','--project-id',PROJECT,'--branch',BRANCH,'--enabled='+String(Boolean(value.enabled))];
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
  let json=null;try{json=text?JSON.parse(text):null;}catch{}
  return {status:response.status,json};
}
async function waitSignin(email,password){
  let last=0;
  for(const delay of [2000,5000,10000]){
    await sleep(delay);
    const signin=await authPost('/sign-in/email',{email,password,rememberMe:true});
    last=signin.status;
    if(signin.status>=200&&signin.status<300&&Boolean(signin.json?.token||signin.json?.session?.token))return signin;
  }
  throw Error('Verified QA sign-in did not succeed; last HTTP '+last+'.');
}
async function workerTelemetry(base){
  const response=await fetch(base+'/qa/telemetry',{redirect:'error',signal:AbortSignal.timeout(10000)});
  assert(response.ok,'QA telemetry unavailable.');
  return response.json();
}
async function waitVerificationDelivery(base){
  for(let attempt=0;attempt<40;attempt+=1){
    const telemetry=await workerTelemetry(base);
    const entries=Array.isArray(telemetry?.entries)?telemetry.entries:[];
    if(entries.some(entry=>entry.status==='sent_or_duplicate'&&entry.link_type==='email-verification'))return entries;
    await sleep(500);
  }
  throw Error('Successful verification delivery telemetry was not observed.');
}
function validatedQaAuthLink(value){
  try{
    const base=new URL(AUTH_BASE);
    const link=new URL(value);
    const basePath=base.pathname.endsWith('/')?base.pathname:base.pathname+'/';
    if(link.protocol!=='https:'||link.origin!==base.origin||!link.pathname.startsWith(basePath)||!link.pathname.endsWith('/verify-email'))return null;
    if(!link.searchParams.get('token'))return null;
    return link.href;
  }catch{return null;}
}
async function waitPendingVerificationLink(base,evidenceKey){
  for(let attempt=0;attempt<40;attempt+=1){
    const response=await fetch(base+'/qa/pending-verification',{
      headers:{authorization:'Bearer '+evidenceKey},
      redirect:'error',
      signal:AbortSignal.timeout(10000),
    });
    assert(response.ok,'QA verification evidence endpoint failed.');
    const body=await response.json();
    const link=validatedQaAuthLink(body?.linkUrl);
    if(link)return link;
    await sleep(500);
  }
  throw Error('Protected QA verification link was not available.');
}
async function clickDeliveredVerification(link){
  const response=await fetch(link,{redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(response.status>=300&&response.status<400){
    const location=response.headers.get('location');
    assert(location,'Verification redirect location is missing.');
    const redirectUrl=new URL(location,AUTH_BASE);
    const error=redirectUrl.searchParams.get('error');
    assert(!error,'Delivered verification link was rejected with '+String(error||'unknown')+'.');
    console.log('AUTH_VERIFY_QA_LINK_CLICK '+JSON.stringify({
      status:response.status,
      redirect_origin:redirectUrl.origin,
      redirect_path:redirectUrl.pathname,
      error:null,
    }));
    return;
  }
  if(response.ok){
    let body=null;try{body=await response.json();}catch{}
    assert(body?.status===true,'Delivered verification link returned an unexpected success response.');
    console.log('AUTH_VERIFY_QA_LINK_CLICK '+JSON.stringify({status:response.status,redirect_origin:null,redirect_path:null,error:null}));
    return;
  }
  throw Error('Delivered verification link returned HTTP '+response.status+'.');
}
async function waitHealth(base,commit){
  for(let attempt=0;attempt<80;attempt+=1){
    try{
      const response=await fetch(base+'/health?quick=1',{redirect:'error',signal:AbortSignal.timeout(5000)});
      if(response.ok){
        const body=await response.json();
        if(body?.environment==='qa'&&body?.release_commit===commit)return;
      }
    }catch{}
    await sleep(750);
  }
  throw Error('Temporary QA Worker health check failed.');
}

async function main(){
  for(const [name,value] of Object.entries({
    NEON_API_KEY:process.env.NEON_API_KEY,
    CLOUDFLARE_EDGE_TOKEN:process.env.CLOUDFLARE_EDGE_TOKEN,
    PACK1_AUTH_RESEND_API_KEY:process.env.PACK1_AUTH_RESEND_API_KEY,
  }))assert(typeof value==='string'&&value.length>=20,name+' is missing or too short.');
  assert(process.env.PACK1_AUTH_RESEND_API_KEY.startsWith('re_'),'Resend credential format is invalid.');
  assert(BRANCH!==PROD_BRANCH&&BRANCH!==DEV_BRANCH,'Acceptance must target a disposable branch.');
  const commit=String(process.env.GITHUB_SHA||'');
  assert(/^[a-f0-9]{40}$/.test(commit),'Exact acceptance revision is required.');
  const qaEvidenceKey=randomBytes(32).toString('base64url');
  console.log('::add-mask::'+qaEvidenceKey);

  const meta=await branchMeta();
  assert(meta.parent_id===PROD_BRANCH,'Acceptance branch must be a production child.');
  assert(meta.default===false&&meta.protected===false&&Boolean(meta.expires_at),'Acceptance branch safety metadata is invalid.');

  const neon=tool('neon');
  const wrangler=tool('wrangler');
  const originalEmail=emailGet(neon);
  const originalWebhook=webhookGet(neon);
  assert(originalEmail.email_verification_method==='otp'&&!originalEmail.require_email_verification&&!originalEmail.send_verification_email_on_sign_up,'Unexpected email-verification baseline.');
  assert(originalWebhook.enabled&&originalWebhook.webhook_url===PROD_WEBHOOK&&originalWebhook.enabled_events.includes('send.magic_link'),'Unexpected webhook baseline.');
  console.log('AUTH_VERIFY_QA_ORIGINAL_EMAIL '+JSON.stringify(originalEmail));
  console.log('AUTH_VERIFY_QA_ORIGINAL_WEBHOOK '+JSON.stringify(originalWebhook));

  const {accountId,accountSubdomain}=await cfContext();
  const workerRoute='/accounts/'+accountId+'/workers/scripts/'+WORKER;
  if(await cf(workerRoute+'/settings',{allow404:true}))await cf(workerRoute,{method:'DELETE'});
  const workerBase='https://'+WORKER+'.'+accountSubdomain+'.workers.dev';
  const configPath=path.join(process.env.RUNNER_TEMP,'auth-verification-qa-v2.json');
  fs.writeFileSync(configPath,JSON.stringify({
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
      AUTH_BASE,PACK1_AUTH_ENV:'qa',RESET_ORIGIN:'https://packone.pro',
      SENDER:'Pack One QA <qa-accounts@packone.pro>',
      SUBJECT:'Reset Your Password - Pack One QA',
      VERIFICATION_SUBJECT:'Verify Your Email - Pack One QA',
      PACK1_RELEASE_COMMIT:commit,
      PACK1_FORCE_DELIVERY_FAILURE:'0',
      PACK1_FORCE_RETRY_AFTER_SEND:'0',
    },
  }),{mode:0o600});

  let emailChanged=false;
  let webhookChanged=false;
  let primaryError=null;
  try{
    run(wrangler,['deploy','--config',configPath]);
    run(wrangler,['secret','bulk','--config',configPath],JSON.stringify({
      RESEND_API_KEY:process.env.PACK1_AUTH_RESEND_API_KEY,
      PACK1_QA_EVIDENCE_KEY:qaEvidenceKey,
    }));
    await waitHealth(workerBase,commit);

    const legacyEmail='pack1-verification-legacy-'+String(process.env.GITHUB_RUN_ID||Date.now())+'@example.com';
    const legacyPassword='P1-'+randomBytes(24).toString('base64url')+'!';
    console.log('::add-mask::'+legacyPassword);
    const legacySignup=await authPost('/sign-up/email',{name:'Pack One Legacy QA',email:legacyEmail,password:legacyPassword});
    assert(legacySignup.status>=200&&legacySignup.status<300,'Legacy QA signup failed with HTTP '+legacySignup.status+'.');
    const legacyBaseline=await authPost('/sign-in/email',{email:legacyEmail,password:legacyPassword,rememberMe:true});
    assert(legacyBaseline.status>=200&&legacyBaseline.status<300,'Legacy QA baseline sign-in failed with HTTP '+legacyBaseline.status+'.');
    console.log('AUTH_VERIFY_QA_LEGACY_BASELINE '+JSON.stringify({signin_status:legacyBaseline.status,session_present:Boolean(legacyBaseline.json?.token||legacyBaseline.json?.session?.token)}));

    webhookChanged=true;
    const probeWebhook=webhookUpdate(neon,{enabled:true,webhook_url:workerBase+'/webhook',enabled_events:['send.magic_link'],timeout_seconds:5});
    assert(probeWebhook.enabled&&probeWebhook.webhook_url===workerBase+'/webhook','Temporary verification webhook did not enable.');

    emailChanged=true;
    const probeEmail=emailUpdate(neon,{
      ...originalEmail,
      email_verification_method:'link',
      require_email_verification:true,
      send_verification_email_on_sign_up:true,
      send_verification_email_on_sign_in:false,
      disable_sign_up:false,
    });
    assert(probeEmail.email_verification_method==='link'&&probeEmail.require_email_verification&&probeEmail.send_verification_email_on_sign_up,'Link verification did not enable.');

    const legacyAfter=await authPost('/sign-in/email',{email:legacyEmail,password:legacyPassword,rememberMe:true});
    assert([200,401,403].includes(legacyAfter.status),'Legacy-account policy check returned unexpected HTTP '+legacyAfter.status+'.');
    console.log('AUTH_VERIFY_QA_LEGACY_AFTER_POLICY '+JSON.stringify({
      status:legacyAfter.status,
      session_present:Boolean(legacyAfter.json?.token||legacyAfter.json?.session?.token),
      grandfathered:legacyAfter.status>=200&&legacyAfter.status<300,
    }));

    const email='delivered@resend.dev';
    const password='P1-'+randomBytes(24).toString('base64url')+'!';
    console.log('::add-mask::'+password);
    const signup=await authPost('/sign-up/email',{name:'Pack One Verification QA',email,password});
    assert(signup.status>=200&&signup.status<300,'Verification QA signup failed with HTTP '+signup.status+'.');
    assert(Boolean(signup.json?.user?.id||signup.json?.id),'Verification QA signup did not return a user.');
    assert(!signup.json?.session&&!signup.json?.token,'Verification QA signup unexpectedly returned a session.');
    console.log('AUTH_VERIFY_QA_SIGNUP '+JSON.stringify({status:signup.status,user_present:true,session_present:false}));

    await waitVerificationDelivery(workerBase);
    const deliveredLink=await waitPendingVerificationLink(workerBase,qaEvidenceKey);
    await clickDeliveredVerification(deliveredLink);
    const signin=await waitSignin(email,password);
    console.log('AUTH_VERIFY_QA_SIGNIN_AFTER '+JSON.stringify({
      status:signin.status,
      session_present:Boolean(signin.json?.token||signin.json?.session?.token),
      email_verified:signin.json?.user?.emailVerified??signin.json?.user?.email_verified??null,
    }));

    const reset=await authPost('/request-password-reset',{email,redirectTo:'https://packone.pro/reset-password/'});
    assert(reset.status>=200&&reset.status<300,'QA recovery request failed with HTTP '+reset.status+'.');
    console.log('AUTH_VERIFY_QA_RESET_REQUEST '+JSON.stringify({status:reset.status}));
    await sleep(1000);

    const telemetry=await workerTelemetry(workerBase);
    const entries=Array.isArray(telemetry?.entries)?telemetry.entries:[];
    assert(entries.some(entry=>entry.status==='sent_or_duplicate'&&entry.link_type==='email-verification'),'Successful verification delivery telemetry was not observed.');
    assert(entries.some(entry=>entry.status==='sent_or_duplicate'&&entry.link_type==='forget-password'),'Successful recovery delivery telemetry was not observed.');
    console.log('AUTH_VERIFY_QA_TELEMETRY '+JSON.stringify(entries.map(entry=>({
      status:entry.status,event_type:entry.event_type||null,link_type:entry.link_type||null,
      duplicate:Boolean(entry.duplicate),
    }))));
  }catch(error){
    primaryError=error;
  }finally{
    const cleanup=[];
    if(emailChanged){
      try{
        const restored=emailUpdate(neon,originalEmail);
        if(!same(restored,originalEmail))throw Error('email mismatch');
        console.log('AUTH_VERIFY_QA_FINAL_EMAIL '+JSON.stringify(restored));
      }catch{cleanup.push('email config');}
    }
    if(webhookChanged){
      try{
        const restored=webhookUpdate(neon,originalWebhook);
        if(!same(restored,originalWebhook))throw Error('webhook mismatch');
        console.log('AUTH_VERIFY_QA_FINAL_WEBHOOK '+JSON.stringify(restored));
      }catch{cleanup.push('webhook config');}
    }
    try{
      if(await cf(workerRoute+'/settings',{allow404:true})){
        await cf(workerRoute,{method:'DELETE'});
        if(await cf(workerRoute+'/settings',{allow404:true}))throw Error('worker remains');
      }
      console.log('AUTH_VERIFY_QA_WORKER_CLEANED true');
    }catch{cleanup.push('temporary Worker');}
    try{await deleteBranch();}catch{cleanup.push('disposable branch');}
    if(cleanup.length)throw Error('QA verification cleanup failed for '+cleanup.join(', ')+'.');
  }
  if(primaryError)throw primaryError;
  console.log('AUTH_VERIFY_QA_COMPLETE true');
}

main().catch(error=>{
  const message=String(error?.message||'');
  console.error(/^(QA|AUTH|Cloudflare|Expected|Invalid|Workers\.dev|Pinned|Exact|Resend|Acceptance|Disposable|Legacy|Link|Verification|Verified|Successful|Temporary|Unexpected)/.test(message)?message:'Email verification QA acceptance failed; inspect sanitized step status.');
  process.exitCode=1;
});
