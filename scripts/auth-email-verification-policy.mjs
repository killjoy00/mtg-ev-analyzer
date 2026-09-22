import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const PROJECT='patient-shadow-91417882';
export const PROD_BRANCH='br-orange-feather-ayps8kep';
export const PROD_WORKER='https://pack1-authhook.killjoy00.workers.dev';
export const REQUEST_FILE='.github/auth-email-verification-policy-request.json';

function assert(value,message){if(!value)throw Error(message);}
function runNeon(args){
  const bin=process.env.NEON_BIN;
  if(!bin)throw Error('NEON_BIN is required.');
  try{
    return execFileSync(bin,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:process.env});
  }catch(error){
    const status=Number.isInteger(error?.status)?error.status:'unknown';
    throw Error('Neon CLI command failed; exit '+status+'.');
  }
}
function authArgs(){return ['--project-id',PROJECT,'--branch',PROD_BRANCH];}
function readJson(args){
  return JSON.parse(runNeon([...args,'--output','json']).trim()||'null');
}
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
function emailConfig(){return safeEmailConfig(readJson(['neon-auth','config','email-password','get',...authArgs()]));}
function emailProvider(){
  const raw=readJson(['neon-auth','config','email-provider','get',...authArgs()])||{};
  const source=raw?.email_provider||raw?.config||raw;
  return {
    type:String(source.type||''),
    host:String(source.host||''),
    port:Number(source.port||0),
    sender_email:String(source.sender_email||''),
    sender_name:String(source.sender_name||''),
  };
}
function allowLocalhost(){
  const value=readJson(['neon-auth','domain','allow-localhost','get',...authArgs()]);
  const actual=Array.isArray(value)?value[0]?.allow_localhost:value?.allow_localhost;
  if(typeof actual!=='boolean')throw Error('Neon CLI did not return allow_localhost.');
  return actual;
}
function updateEmailConfig(config){
  const value=safeEmailConfig(config);
  runNeon([
    'neon-auth','config','email-password','update',
    ...authArgs(),
    '--enabled='+String(value.enabled),
    '--email-verification-method',value.email_verification_method,
    '--require-email-verification='+String(value.require_email_verification),
    '--auto-sign-in-after-verification='+String(value.auto_sign_in_after_verification),
    '--send-verification-email-on-sign-up='+String(value.send_verification_email_on_sign_up),
    '--send-verification-email-on-sign-in='+String(value.send_verification_email_on_sign_in),
    '--disable-sign-up='+String(value.disable_sign_up),
  ]);
  return emailConfig();
}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function credentialSummary(){
  const sql=`SELECT json_build_object(
    'credential_count',count(DISTINCT u.id),
    'verified_count',count(DISTINCT u.id) FILTER (WHERE u."emailVerified"),
    'unverified_count',count(DISTINCT u.id) FILTER (WHERE NOT u."emailVerified"),
    'other_provider_links',(
      SELECT count(*)
      FROM neon_auth.account a2
      WHERE a2."userId" IN (
        SELECT DISTINCT a3."userId" FROM neon_auth.account a3 WHERE a3."providerId"='credential'
      )
      AND a2."providerId"<>'credential'
    )
  )::text
  FROM neon_auth."user" u
  JOIN neon_auth.account a ON a."userId"=u.id
  WHERE a."providerId"='credential'`;
  const out=runNeon(['psql',PROD_BRANCH,'--project-id',PROJECT,'--database-name','pack1','--','-XAtc',sql]).trim();
  try{return JSON.parse(out);}catch{throw Error('Credential verification summary returned unexpected output.');}
}
export function validateRequest(value){
  assert(value&&typeof value==='object'&&!Array.isArray(value),'Invalid optional verification request.');
  assert(JSON.stringify(Object.keys(value).sort())===JSON.stringify(['operation','reason','required_worker_commit']),'Invalid optional verification request keys.');
  assert(value.operation==='enable-optional-email-verification','Invalid optional verification operation.');
  assert(typeof value.reason==='string'&&value.reason.trim().length>=12,'Invalid optional verification reason.');
  assert(/^[a-f0-9]{40}$/.test(String(value.required_worker_commit||'')),'Invalid required Worker commit.');
  return value;
}
async function verifyWorker(commit,fetcher=fetch){
  const response=await fetcher(PROD_WORKER+'/health?quick=1',{redirect:'error',signal:AbortSignal.timeout(10000)});
  assert(response.ok,'Production Auth Worker health check failed.');
  const body=await response.json();
  assert(body?.service==='pack1authhook'&&body?.environment==='production','Production Auth Worker identity mismatch.');
  assert(body?.release_commit===commit,'Production Auth Worker release marker mismatch.');
}
export function optionalTarget(original){
  return {
    ...safeEmailConfig(original),
    enabled:true,
    email_verification_method:'link',
    require_email_verification:false,
    auto_sign_in_after_verification:true,
    send_verification_email_on_sign_up:true,
    send_verification_email_on_sign_in:false,
    disable_sign_up:false,
  };
}
export async function runProduction({fetcher=fetch}={}){
  const request=validateRequest(JSON.parse(fs.readFileSync(REQUEST_FILE,'utf8')));
  await verifyWorker(request.required_worker_commit,fetcher);

  assert(allowLocalhost()===false,'Production Auth localhost allowance must remain disabled.');
  const provider=emailProvider();
  assert(provider.type==='standard','Production Auth must use the custom email provider.');
  assert(provider.host==='smtp.resend.com'&&provider.port===465,'Production Auth SMTP provider mismatch.');
  assert(provider.sender_email==='accounts@packone.pro'&&provider.sender_name==='Pack One','Production Auth sender mismatch.');

  const users=credentialSummary();
  assert(Number(users.credential_count)===4,'Expected exactly four credential users for the approved migration.');
  assert(Number(users.verified_count)===4&&Number(users.unverified_count)===0,'All migrated credential users must be verified before Phase 1.');
  assert(Number(users.other_provider_links)===0,'Credential migration population unexpectedly has linked providers.');

  const original=emailConfig();
  const baseline={
    enabled:true,
    email_verification_method:'otp',
    require_email_verification:false,
    auto_sign_in_after_verification:true,
    send_verification_email_on_sign_up:false,
    send_verification_email_on_sign_in:false,
    disable_sign_up:false,
  };
  const target=optionalTarget(original);

  if(same(original,target)){
    console.log('PRODUCTION_OPTIONAL_EMAIL_VERIFICATION '+JSON.stringify({changed:false,before:original,after:original,users}));
    return;
  }
  assert(same(original,baseline),'Production email/password policy no longer matches the reviewed Phase 1 baseline.');

  let changed=false;
  try{
    const after=updateEmailConfig(target);
    changed=true;
    assert(same(after,target),'Production optional verification policy did not reach the exact target.');
    await verifyWorker(request.required_worker_commit,fetcher);
    assert(allowLocalhost()===false,'Production localhost allowance changed during Phase 1 rollout.');
    console.log('PRODUCTION_OPTIONAL_EMAIL_VERIFICATION '+JSON.stringify({changed:true,before:original,after,users}));
  }catch(error){
    if(changed){
      try{
        const restored=updateEmailConfig(original);
        if(!same(restored,original))throw Error('rollback mismatch');
      }catch{
        throw Error('Phase 1 verification rollout failed and automatic email-policy rollback also failed.');
      }
    }
    throw error;
  }
}

async function main(){
  const mode=process.argv[2];
  if(mode!=='production')throw Error('Expected production mode.');
  await runProduction();
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  main().catch(error=>{
    console.error(String(error?.message||'Optional email verification rollout failed.'));
    process.exitCode=1;
  });
}
