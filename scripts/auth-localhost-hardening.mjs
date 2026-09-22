import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {removeProviderUser} from '../worker/account-deletion.mjs';

export const PROJECT_ID='patient-shadow-91417882';
export const QA_BRANCH='br-twilight-hill-ayffyd2b';
export const PROD_BRANCH='br-orange-feather-ayps8kep';
export const QA_AUTH_BASE='https://ep-spring-dream-ayq2a5qt.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth';
export const PROD_AUTH_BASE='https://ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth';
export const PROD_ORIGINS=['https://packone.pro','https://api.packone.pro','https://magic.planitnow.us'];
const LOCAL_ORIGIN='http://localhost:4173';
const REQUEST_FILE='.github/auth-localhost-hardening-request.json';

function assert(condition,message){if(!condition)throw Error(message);}
function safeString(value,max=160){return typeof value==='string'&&value.length>0&&value.length<=max?value:null;}
function jsonText(value){return JSON.stringify(value);}

export function parseAllowLocalhostOutput(output){
  const parsed=JSON.parse(String(output||'').trim());
  const value=Array.isArray(parsed)?parsed[0]?.allow_localhost:parsed?.allow_localhost;
  if(typeof value!=='boolean')throw Error('Neon CLI did not return a boolean allow_localhost value.');
  return value;
}

export function normalizeConfigSnapshot(snapshot){
  const domains=[...(snapshot.domains||[])].map(row=>String(row?.domain||'')).filter(Boolean).sort();
  const oauth=[...(snapshot.oauth||[])].map(row=>({
    id:String(row?.id||''),
    type:String(row?.type||''),
    client_id:row?.client_id??null,
  })).sort((a,b)=>a.id.localeCompare(b.id));
  return {
    domains,
    emailPassword:snapshot.emailPassword||{},
    oauth,
  };
}

function runNeon(args){
  const bin=process.env.NEON_BIN;
  if(!bin)throw Error('NEON_BIN is required.');
  try{
    return execFileSync(bin,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:process.env});
  }catch(error){
    const stderr=String(error?.stderr||'');
    const status=Number.isInteger(error?.status)?error.status:'unknown';
    const category=/unauthorized|authentication|api.?key/i.test(stderr)?'authentication'
      :/permission|forbidden/i.test(stderr)?'permission'
      :/not found/i.test(stderr)?'not found'
      :'command failure';
    throw Error('Neon CLI '+category+'; exit '+status+'.');
  }
}

function authArgs(branch){
  return ['--project-id',PROJECT_ID,'--branch',branch];
}

export function getAllowLocalhost(branch){
  return parseAllowLocalhostOutput(runNeon([
    'neon-auth','domain','allow-localhost','get',
    ...authArgs(branch),
    '--output','json',
  ]));
}

export function setAllowLocalhost(branch,allowed){
  runNeon([
    'neon-auth','domain','allow-localhost',allowed?'enable':'disable',
    ...authArgs(branch),
  ]);
  const actual=getAllowLocalhost(branch);
  if(actual!==allowed)throw Error('Neon Auth allow_localhost did not reach the requested state.');
  return actual;
}

function readJsonCommand(args){
  const value=JSON.parse(runNeon([...args,'--output','json']).trim()||'null');
  return value;
}

export function readConfigSnapshot(branch){
  return normalizeConfigSnapshot({
    domains:readJsonCommand(['neon-auth','domain','list',...authArgs(branch)]),
    emailPassword:readJsonCommand(['neon-auth','config','email-password','get',...authArgs(branch)]),
    oauth:readJsonCommand(['neon-auth','oauth-provider','list',...authArgs(branch)]),
  });
}

function servicePrincipalUnlinked(branch,serviceId){
  if(!/^[0-9a-f-]{36}$/i.test(String(serviceId||'')))return false;
  const sql="SELECT count(*) FROM account_links WHERE auth_user_id='"+serviceId+"'::uuid";
  const output=runNeon(['psql',branch,'--project-id',PROJECT_ID,'--database-name','pack1','--','-XAtc',sql]).trim();
  return output==='0';
}

export async function deleteAuthUser(branch,userId){
  if(!safeString(userId,128))return;
  const authBase=branch===PROD_BRANCH?PROD_AUTH_BASE:QA_AUTH_BASE;
  const result=await removeProviderUser({
    authBase,
    authUserId:userId,
    validateServicePrincipal:async serviceId=>servicePrincipalUnlinked(branch,serviceId),
  });
  if(!['success','not_found'].includes(result.kind))
    throw Error('Provider Auth user cleanup failed: '+String(result.code||result.kind)+'.');
}

function responseCode(body){
  return safeString(body?.code,80)||safeString(body?.error?.code,80)||safeString(body?.message,120)||null;
}

export async function postAuth(fetcher,base,path,origin,body){
  const response=await fetcher(base+path,{
    method:'POST',
    headers:{origin,'content-type':'application/json'},
    body:JSON.stringify(body),
    redirect:'manual',
    signal:AbortSignal.timeout(30000),
  });
  const data=await response.json().catch(()=>({}));
  return {status:response.status,data,code:responseCode(data)};
}

export async function socialStart(fetcher,base,origin){
  const landing=origin+'/?auth=google';
  const result=await postAuth(fetcher,base,'/sign-in/social',origin,{
    provider:'google',
    callbackURL:landing,
    newUserCallbackURL:landing,
    errorCallbackURL:landing,
    disableRedirect:true,
  });
  return {
    status:result.status,
    code:result.code,
    target:safeString(result.data?.url,2048),
  };
}

function requireSocialAllowed(result,label){
  assert(result.status>=200&&result.status<300,label+' was not accepted; HTTP '+result.status+'.');
  assert(/^https:\/\//.test(String(result.target||'')),label+' did not return a secure OAuth target.');
}

function requireSocialRejected(result,label){
  assert(!(result.status>=200&&result.status<300),label+' was still accepted after localhost was disabled.');
}

async function signupAndSignIn(fetcher){
  const run=String(process.env.GITHUB_RUN_ID||Date.now());
  const attempt=String(process.env.GITHUB_RUN_ATTEMPT||'1');
  const email='pack1-auth-hardening-'+run+'-'+attempt+'@example.com';
  const password='P1-'+randomBytes(24).toString('base64url')+'!';
  const signup=await postAuth(fetcher,PROD_AUTH_BASE,'/sign-up/email',PROD_ORIGINS[0],{
    email,password,name:'Pack One Auth Hardening Smoke',
  });
  assert(signup.status>=200&&signup.status<300,'Production email/password signup smoke failed; HTTP '+signup.status+'.');
  const userId=safeString(signup.data?.user?.id,128);
  assert(userId,'Production signup smoke did not return a user id.');
  const signin=await postAuth(fetcher,PROD_AUTH_BASE,'/sign-in/email',PROD_ORIGINS[0],{
    email,password,
  });
  assert(signin.status>=200&&signin.status<300,'Production email/password sign-in smoke failed; HTTP '+signin.status+'.');
  assert(signin.data?.user?.id===userId,'Production email/password sign-in returned a different user.');
  return {userId,signupStatus:signup.status,signinStatus:signin.status};
}

async function recoverySmoke(fetcher){
  const email='delivered@resend.dev';
  const password='P1-'+randomBytes(24).toString('base64url')+'!';
  const signup=await postAuth(fetcher,PROD_AUTH_BASE,'/sign-up/email',PROD_ORIGINS[0],{
    email,password,name:'Pack One Recovery Delivery Smoke',
  });
  let createdUserId=null;
  if(signup.status>=200&&signup.status<300){
    createdUserId=safeString(signup.data?.user?.id,128);
    assert(createdUserId,'Recovery delivery smoke signup did not return a user id.');
  }else{
    const existing=/exist|already/i.test(String(signup.code||''));
    assert(existing,'Recovery delivery smoke could not prepare the Resend test recipient; HTTP '+signup.status+'.');
  }
  const reset=await postAuth(fetcher,PROD_AUTH_BASE,'/request-password-reset',PROD_ORIGINS[0],{
    email,
    redirectTo:'https://packone.pro/reset-password/',
  });
  assert(reset.status>=200&&reset.status<300,'Production password recovery request failed; HTTP '+reset.status+'.');
  return {createdUserId,resetStatus:reset.status};
}

export function validateRequestFile(value){
  assert(value&&typeof value==='object'&&!Array.isArray(value),'Invalid localhost hardening request.');
  assert(JSON.stringify(Object.keys(value).sort())===JSON.stringify(['operation','reason']),'Invalid localhost hardening request keys.');
  assert(value.operation==='disable-production-localhost','Invalid localhost hardening operation.');
  assert(typeof value.reason==='string'&&value.reason.trim().length>=12,'Invalid localhost hardening reason.');
  return value;
}

export async function runQa({fetcher=fetch}={}){
  const beforeSnapshot=readConfigSnapshot(QA_BRANCH);
  const before=getAllowLocalhost(QA_BRANCH);
  assert(before===true,'QA allow_localhost must be true before the capability probe.');
  const allowedBefore=await socialStart(fetcher,QA_AUTH_BASE,LOCAL_ORIGIN);
  requireSocialAllowed(allowedBefore,'QA localhost Google OAuth start before disable');

  let rejected;
  try{
    setAllowLocalhost(QA_BRANCH,false);
    rejected=await socialStart(fetcher,QA_AUTH_BASE,LOCAL_ORIGIN);
    requireSocialRejected(rejected,'QA localhost Google OAuth start');
  }finally{
    setAllowLocalhost(QA_BRANCH,true);
  }

  const restored=getAllowLocalhost(QA_BRANCH);
  assert(restored===true,'QA allow_localhost was not restored after the probe.');
  const allowedAfter=await socialStart(fetcher,QA_AUTH_BASE,LOCAL_ORIGIN);
  requireSocialAllowed(allowedAfter,'QA localhost Google OAuth start after restore');
  const afterSnapshot=readConfigSnapshot(QA_BRANCH);
  assert(jsonText(afterSnapshot)===jsonText(beforeSnapshot),'QA Auth settings changed outside allow_localhost during the probe.');

  console.log('QA_LOCALHOST_PROBE '+jsonText({
    before,
    disabled:false,
    localhost_before_status:allowedBefore.status,
    localhost_disabled_status:rejected.status,
    restored,
    localhost_restored_status:allowedAfter.status,
  }));
}

export async function runProduction({fetcher=fetch}={}){
  validateRequestFile(JSON.parse(fs.readFileSync(REQUEST_FILE,'utf8')));
  // One-time cleanup of disposable smoke users left by the two pre-CLI-5.0 verification runs.
  for(const userId of [
    '3a238e01-6e6c-4d96-b719-e321e39ff00c',
    '252acfa7-57fa-4774-9048-6de5dcc4f160',
    '4fb31297-251d-48b5-b2ee-cd698d5ac8a1',
  ]) await deleteAuthUser(PROD_BRANCH,userId);
  const beforeSnapshot=readConfigSnapshot(PROD_BRANCH);
  const before=getAllowLocalhost(PROD_BRANCH);
  let changed=false;
  let signInUserId=null;
  let recoveryUserId=null;
  let coreError=null;
  let results=null;

  try{
    let localhostBefore=null;
    if(before===true){
      localhostBefore=await socialStart(fetcher,PROD_AUTH_BASE,LOCAL_ORIGIN);
      requireSocialAllowed(localhostBefore,'Production localhost Google OAuth start before disable');
      setAllowLocalhost(PROD_BRANCH,false);
      changed=true;
    }
    assert(getAllowLocalhost(PROD_BRANCH)===false,'Production allow_localhost is not false.');

    const localhostAfter=await socialStart(fetcher,PROD_AUTH_BASE,LOCAL_ORIGIN);
    requireSocialRejected(localhostAfter,'Production localhost Google OAuth start');

    const originResults=[];
    for(const origin of PROD_ORIGINS){
      const result=await socialStart(fetcher,PROD_AUTH_BASE,origin);
      requireSocialAllowed(result,'Production Google OAuth start from '+origin);
      originResults.push({origin,status:result.status});
    }

    const email=await signupAndSignIn(fetcher);
    signInUserId=email.userId;

    const recovery=await recoverySmoke(fetcher);
    recoveryUserId=recovery.createdUserId;

    const afterSnapshot=readConfigSnapshot(PROD_BRANCH);
    assert(jsonText(afterSnapshot)===jsonText(beforeSnapshot),'Production Auth settings changed outside allow_localhost.');

    results={
      before,
      after:false,
      localhost_before_status:localhostBefore?.status??null,
      localhost_after_status:localhostAfter.status,
      intended_origins:originResults,
      signup_status:email.signupStatus,
      signin_status:email.signinStatus,
      reset_request_status:recovery.resetStatus,
    };
  }catch(error){
    coreError=error;
  }

  const cleanupErrors=[];
  for(const [label,userId] of [['sign-in smoke',signInUserId],['recovery smoke',recoveryUserId]]){
    if(!userId)continue;
    try{await deleteAuthUser(PROD_BRANCH,userId);}
    catch(error){cleanupErrors.push(label+': '+String(error?.message||'cleanup failed'));}
  }

  if(coreError){
    if(changed){
      try{setAllowLocalhost(PROD_BRANCH,true);}
      catch{throw Error('Production hardening failed and automatic localhost rollback also failed.');}
    }
    throw coreError;
  }
  if(cleanupErrors.length)throw Error('Production Auth smoke cleanup failed: '+cleanupErrors.join('; ')+'.');

  assert(getAllowLocalhost(PROD_BRANCH)===false,'Production allow_localhost changed after verification.');
  console.log('PRODUCTION_LOCALHOST_HARDENING '+jsonText(results));
}

async function main(){
  const mode=process.argv[2];
  if(mode==='qa')return runQa();
  if(mode==='production')return runProduction();
  throw Error('Expected qa or production mode.');
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  main().catch(error=>{
    console.error(String(error?.message||'Auth localhost hardening failed.'));
    process.exitCode=1;
  });
}
