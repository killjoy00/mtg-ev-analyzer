import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const PROJECT='patient-shadow-91417882';
export const BRANCH='br-summer-credit-ay2vkyhc';
export const AUTH_BASE='https://ep-curly-brook-ayo21u1k.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth';
const WORKER='pack1-auth-webhook-probe-temp';
const EMAIL_CONFIG_PATH='/projects/'+PROJECT+'/branches/'+BRANCH+'/auth/email_and_password';

function assert(condition,message){if(!condition)throw Error(message);}

export function safeEmailConfig(value){
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

export function verificationConfigForMode(original,mode,requireEmailVerification=true){
  if(!['otp','link'].includes(mode))throw Error('Unsupported verification probe mode.');
  return {
    ...safeEmailConfig(original),
    enabled:true,
    email_verification_method:mode,
    require_email_verification:Boolean(requireEmailVerification),
    send_verification_email_on_sign_up:true,
    send_verification_email_on_sign_in:false,
    disable_sign_up:false,
  };
}

function configEqual(a,b){
  return JSON.stringify(safeEmailConfig(a))===JSON.stringify(safeEmailConfig(b));
}

async function neonApi(method,body){
  let response;
  try{
    response=await fetch('https://console.neon.tech/api/v2'+EMAIL_CONFIG_PATH,{
      method,
      headers:{
        authorization:'Bearer '+process.env.NEON_API_KEY,
        'content-type':'application/json',
      },
      body:body===undefined?undefined:JSON.stringify(body),
      redirect:'error',
      signal:AbortSignal.timeout(15000),
    });
  }catch{
    throw Error('Neon Auth email configuration request failed.');
  }
  if(!response.ok)throw Error('Neon Auth email configuration '+method+' failed with HTTP '+response.status+'.');
  try{return await response.json();}
  catch{throw Error('Neon Auth email configuration returned invalid JSON.');}
}

async function getEmailConfig(){
  return safeEmailConfig(await neonApi('GET'));
}

async function updateEmailConfig(neon,config){
  const value=safeEmailConfig(config);
  run(neon,[
    'neon-auth','config','email-password','update',
    '--project-id',PROJECT,
    '--branch',BRANCH,
    '--enabled='+String(value.enabled),
    '--email-verification-method',value.email_verification_method,
    '--require-email-verification='+String(value.require_email_verification),
    '--auto-sign-in-after-verification='+String(value.auto_sign_in_after_verification),
    '--send-verification-email-on-sign-up='+String(value.send_verification_email_on_sign_up),
    '--send-verification-email-on-sign-in='+String(value.send_verification_email_on_sign_in),
    '--disable-sign-up='+String(value.disable_sign_up),
  ]);
  return getEmailConfig();
}

function run(binary,args){
  try{
    return execFileSync(binary,args,{
      encoding:'utf8',
      stdio:['ignore','pipe','pipe'],
      env:process.env,
    });
  }catch(error){
    const status=Number.isInteger(error?.status)?error.status:'unknown';
    throw Error('Neon Auth webhook command failed; exit '+status+'.');
  }
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

function webhookGet(neon){
  const stdout=run(neon,[
    'neon-auth','config','webhook','get',
    '--project-id',PROJECT,
    '--branch',BRANCH,
    '--output','json',
  ]);
  try{return safeWebhookConfig(JSON.parse(stdout));}
  catch{throw Error('Neon Auth webhook config returned unexpected output.');}
}

function webhookUpdate(neon,config){
  const args=[
    'neon-auth','config','webhook','update',
    '--project-id',PROJECT,
    '--branch',BRANCH,
    '--enabled='+(config.enabled?'true':'false'),
  ];
  if(config.webhook_url)args.push('--url',config.webhook_url);
  for(const event of config.enabled_events||[])args.push('--enabled-events',event);
  if(Number.isInteger(config.timeout_seconds))args.push('--timeout',String(config.timeout_seconds));
  run(neon,args);
}

async function cloudflare(route){
  const response=await fetch('https://api.cloudflare.com/client/v4'+route,{
    headers:{authorization:'Bearer '+process.env.CLOUDFLARE_EDGE_TOKEN},
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw Error('Cloudflare control HTTP '+response.status+'.');
  const body=await response.json();
  if(!body.success)throw Error('Cloudflare rejected verification probe setup.');
  return body.result;
}

async function probeWorkerUrl(){
  const zones=await cloudflare('/zones?name=packone.pro&per_page=50');
  if(!Array.isArray(zones)||zones.length!==1||zones[0].status!=='active')throw Error('Expected the active Pack One Cloudflare zone.');
  const accountId=zones[0].account?.id;
  if(!/^[a-f0-9]{32}$/.test(accountId||''))throw Error('Invalid Cloudflare account identifier.');
  const subdomain=(await cloudflare('/accounts/'+accountId+'/workers/subdomain'))?.subdomain;
  if(!/^[a-z0-9-]+$/.test(subdomain||''))throw Error('Workers.dev subdomain is unavailable.');
  return 'https://'+WORKER+'.'+subdomain+'.workers.dev';
}

async function authPost(pathname,body){
  const response=await fetch(AUTH_BASE+pathname,{
    method:'POST',
    redirect:'manual',
    headers:{origin:'https://packone.pro','content-type':'application/json'},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(20000),
  });
  const text=await response.text();
  let json=null;
  try{json=text?JSON.parse(text):null;}catch{}
  return {status:response.status,json};
}

async function clearEvidence(workerUrl){
  const response=await fetch(workerUrl+'/evidence',{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(response.status!==204)throw Error('Verification probe evidence could not be cleared.');
}

async function waitEvidence(workerUrl){
  for(let i=0;i<12;i+=1){
    const response=await fetch(workerUrl+'/evidence',{redirect:'error',signal:AbortSignal.timeout(10000)});
    if(response.ok)return response.json();
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  return null;
}

function verificationState(neon,email){
  if(!/^[a-z0-9@.-]{1,160}$/.test(email))throw Error('Invalid synthetic verification probe email.');
  const sql=`SELECT json_build_object(
    'user_found',count(DISTINCT u.id)=1,
    'email_verified',COALESCE(bool_or(u."emailVerified"),false),
    'verification_count',count(v.id),
    'identifier_shape',COALESCE(max(replace(v.identifier,lower(u.email),'<email>')),''),
    'value_length',COALESCE(max(length(v.value)),0),
    'expires_future',COALESCE(bool_or(v."expiresAt">now()),false)
  )::text
  FROM neon_auth."user" u
  LEFT JOIN neon_auth.verification v ON v.identifier LIKE '%' || lower(u.email) || '%'
  WHERE lower(u.email)=lower('${email}')`;
  const stdout=run(neon,['psql',BRANCH,'--project-id',PROJECT,'--database-name','pack1','--','-XAtc',sql]).trim();
  try{return JSON.parse(stdout);}
  catch{throw Error('Verification state query returned unexpected output.');}
}

function evidenceSummary(evidence){
  return {
    event_type_header:evidence?.event_type_header||null,
    event_type_payload:evidence?.event_type_payload||null,
    link_type:evidence?.link_type||null,
    link_host:evidence?.link_host||null,
    token_present:Boolean(evidence?.token_present),
    token_length:Number(evidence?.token_length)||0,
    otp_present:Boolean(evidence?.otp_present),
    otp_length:Number(evidence?.otp_length)||0,
    top_level_keys:Array.isArray(evidence?.top_level_keys)?evidence.top_level_keys:[],
    event_data_keys:Array.isArray(evidence?.event_data_keys)?evidence.event_data_keys:[],
    template_shape:evidence?.template_shape??null,
    payload_shape:evidence?.payload_shape??null,
    signature_verified:Boolean(evidence?.verification?.verified),
  };
}

async function probeMode(mode,originalEmail,workerUrl,neon,requireEmailVerification=true){
  const target=verificationConfigForMode(originalEmail,mode,requireEmailVerification);
  const applied=await updateEmailConfig(neon,target);
  assert(configEqual(applied,target),'QA email verification configuration did not reach the requested probe state.');
  console.log('AUTH_VERIFICATION_MODE_CONFIG '+JSON.stringify({mode,config:applied}));

  await clearEvidence(workerUrl);
  const password='P1-'+randomBytes(24).toString('base64url')+'!';
  console.log('::add-mask::'+password);
  const runId=String(process.env.GITHUB_RUN_ID||Date.now());
  const attempt=String(process.env.GITHUB_RUN_ATTEMPT||'1');
  const email=mode==='link'?'delivered@resend.dev':'pack1-verification-probe-'+runId+'-'+attempt+'-'+mode+'@example.com';

  const signup=await authPost('/sign-up/email',{name:'Pack One Verification Probe',email,password});
  assert(signup.status>=200&&signup.status<300,'QA verification probe signup failed with HTTP '+signup.status+'.');

  const signin=await authPost('/sign-in/email',{email,password});
  const evidence=await waitEvidence(workerUrl);
  const summary=evidence?evidenceSummary(evidence):null;
  if(summary)assert(summary.signature_verified,'Managed Neon verification webhook signature did not verify.');
  const verification=verificationState(neon,email);
  const taxonomy={
    mode,
    require_email_verification:target.require_email_verification,
    send_verification_email_on_sign_up:target.send_verification_email_on_sign_up,
    signup_status:signup.status,
    signup_user_present:Boolean(signup.json?.user?.id||signup.json?.id),
    signup_session_present:Boolean(signup.json?.session||signup.json?.token),
    signup_email_verified:typeof signup.json?.user?.emailVerified==='boolean'?signup.json.user.emailVerified:null,
    signin_before_verification_status:signin.status,
    webhook_event_captured:Boolean(summary),
    evidence:summary,
    verification_state:verification,
  };
  console.log('AUTH_VERIFICATION_TAXONOMY '+JSON.stringify(taxonomy));

  assert(verification.user_found,'QA verification probe user was not persisted.');
  assert(verification.email_verified===false,'QA verification probe user unexpectedly verified before acceptance.');
  if(mode==='otp')assert(Number(verification.verification_count)>=1,'QA OTP verification probe did not persist a verification credential.');
  if(mode==='link')assert(summary,'QA link verification probe did not emit a subscribed signed webhook event.');
  if(!target.require_email_verification){
    assert(signin.status>=200&&signin.status<300,'Optional verification unexpectedly blocked password sign-in with HTTP '+signin.status+'.');
    assert(Boolean(signin.json?.token||signin.json?.session?.token),'Optional verification sign-in did not return a session.');
  }
}

export async function main(){
  if(!process.env.NEON_API_KEY)throw Error('Neon control credential is missing.');
  if(!process.env.CLOUDFLARE_EDGE_TOKEN)throw Error('Cloudflare operations credential is missing.');
  if(!process.env.EDGE_TOOLS_DIR)throw Error('Pinned verification probe tools are missing.');

  const neon=path.join(process.env.EDGE_TOOLS_DIR,'node_modules/.bin/neon');
  const originalEmail=await getEmailConfig();
  const originalWebhook=webhookGet(neon);
  console.log('AUTH_VERIFICATION_ORIGINAL_EMAIL_CONFIG '+JSON.stringify(originalEmail));
  console.log('AUTH_VERIFICATION_ORIGINAL_WEBHOOK_CONFIG '+JSON.stringify(originalWebhook));
  assert(originalWebhook.enabled,'Disposable production child did not inherit the active recovery webhook.');
  assert(originalWebhook.enabled_events.includes('send.magic_link'),'Disposable production child recovery webhook is missing send.magic_link.');
  assert(originalWebhook.webhook_url==='https://pack1-authhook.killjoy00.workers.dev/webhook','Disposable production child recovery webhook target is unexpected.');

  const workerUrl=await probeWorkerUrl();
  let workerReady=false;
  for(let attempt=0;attempt<20;attempt+=1){
    try{
      const health=await fetch(workerUrl+'/health',{redirect:'error',signal:AbortSignal.timeout(5000)});
      if(health.ok){workerReady=true;break;}
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  if(!workerReady)throw Error('Temporary verification probe Worker is not staged.');

  let emailChanged=false;
  let webhookChanged=false;
  let primaryError=null;
  try{
    webhookChanged=true;
    webhookUpdate(neon,{
      enabled:true,
      webhook_url:workerUrl+'/webhook',
      enabled_events:['send.magic_link','send.otp'],
      timeout_seconds:5,
    });
    const enabledWebhook=webhookGet(neon);
    assert(enabledWebhook.enabled,'QA verification probe webhook did not enable.');
    assert(enabledWebhook.enabled_events.includes('send.magic_link'),'QA verification probe webhook is missing send.magic_link.');
    assert(enabledWebhook.enabled_events.includes('send.otp'),'QA verification probe webhook is missing send.otp.');
    console.log('AUTH_VERIFICATION_ENABLED_WEBHOOK '+JSON.stringify(enabledWebhook));

    emailChanged=true;
    await probeMode('link',originalEmail,workerUrl,neon,false);
  }catch(error){
    primaryError=error;
  }finally{
    const rollbackErrors=[];
    if(emailChanged){
      try{
        const restored=await updateEmailConfig(neon,originalEmail);
        if(!configEqual(restored,originalEmail))throw Error('email config mismatch');
        console.log('AUTH_VERIFICATION_FINAL_EMAIL_CONFIG '+JSON.stringify(restored));
      }catch{rollbackErrors.push('email/password config');}
    }
    if(webhookChanged){
      try{
        webhookUpdate(neon,originalWebhook);
        const restored=webhookGet(neon);
        if(JSON.stringify(restored)!==JSON.stringify(originalWebhook))throw Error('webhook config mismatch');
        console.log('AUTH_VERIFICATION_FINAL_WEBHOOK_CONFIG '+JSON.stringify(restored));
      }catch{rollbackErrors.push('webhook config');}
    }
    if(rollbackErrors.length)throw Error('Verification probe rollback failed for '+rollbackErrors.join(' and ')+'.');
  }
  if(primaryError)throw primaryError;
  console.log('AUTH_VERIFICATION_PROBE_COMPLETE true');
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  main().catch(error=>{
    const message=String(error?.message||'');
    console.error(/^(Neon control|Cloudflare operations|Pinned verification|Neon Auth email|Neon Auth webhook|Cloudflare control|Cloudflare rejected|Expected the active|Invalid Cloudflare|Workers\.dev|QA Auth webhook|Temporary verification|Verification probe|QA email verification|QA verification probe|No signed verification|Managed Neon verification)/.test(message)?message:'Email verification taxonomy probe failed; inspect the sanitized step status.');
    process.exitCode=1;
  });
}
