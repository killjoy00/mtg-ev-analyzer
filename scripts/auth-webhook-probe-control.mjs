import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const PROJECT='patient-shadow-91417882';
const BRANCH='br-shy-resonance-ayf5djjc';
const AUTH_BASE='https://ep-still-math-ayzm00u3.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth';
const WEBHOOK_API=`https://console.neon.tech/api/v2/projects/${PROJECT}/branches/${BRANCH}/auth/webhooks`;
const WORKER='pack1-auth-webhook-probe-temp';

function safeWebhookConfig(value) {
  return {
    enabled:Boolean(value?.enabled),
    webhook_url:value?.webhook_url||null,
    enabled_events:Array.isArray(value?.enabled_events)?value.enabled_events:[],
    timeout_seconds:value?.timeout_seconds??null,
  };
}
async function neonControl(route,{method='GET',body}={}) {
  const response=await fetch(route,{
    method,
    redirect:'error',
    headers:{
      authorization:`Bearer ${process.env.NEON_API_KEY}`,
      ...(body===undefined?{}:{'content-type':'application/json'}),
    },
    body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw Error(`Neon Auth control HTTP ${response.status}.`);
  return response.status===204?null:response.json();
}
async function cloudflare(route) {
  const response=await fetch('https://api.cloudflare.com/client/v4'+route,{
    headers:{authorization:`Bearer ${process.env.CLOUDFLARE_EDGE_TOKEN}`},
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw Error(`Cloudflare control HTTP ${response.status}.`);
  const body=await response.json();
  if(!body.success)throw Error('Cloudflare rejected probe setup.');
  return body.result;
}
function run(binary,args,input) {
  try {
    return execFileSync(binary,args,{
      input,
      encoding:'utf8',
      stdio:['pipe','pipe','pipe'],
      env:{...process.env,CLOUDFLARE_API_TOKEN:process.env.CLOUDFLARE_EDGE_TOKEN},
    });
  } catch(error) {
    const status=Number.isInteger(error.status)?error.status:'unknown';
    throw Error(`Probe deployment command failed; exit ${status}.`);
  }
}
async function authPost(pathname,body) {
  const response=await fetch(AUTH_BASE+pathname,{
    method:'POST',
    redirect:'manual',
    headers:{origin:'http://localhost:4173','content-type':'application/json'},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(20000),
  });
  const text=await response.text();
  let json=null;
  try {json=text?JSON.parse(text):null;} catch {}
  return {status:response.status,json};
}
async function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

async function main() {
  if(!process.env.NEON_API_KEY)throw Error('Neon control credential is missing.');
  if(!process.env.CLOUDFLARE_EDGE_TOKEN)throw Error('Cloudflare operations credential is missing.');
  if(!process.env.EDGE_TOOLS_DIR)throw Error('Pinned deployment tools are missing.');

  const original=await neonControl(WEBHOOK_API);
  console.log('AUTH_PROBE_ORIGINAL_CONFIG '+JSON.stringify(safeWebhookConfig(original)));
  if(original?.enabled)throw Error('QA Auth webhook is already enabled; refusing to overwrite an active configuration.');

  const zones=await cloudflare('/zones?name=packone.pro&per_page=50');
  if(!Array.isArray(zones)||zones.length!==1||zones[0].status!=='active')throw Error('Expected the active Pack One Cloudflare zone.');
  const accountId=zones[0].account?.id;
  if(!/^[a-f0-9]{32}$/.test(accountId||''))throw Error('Invalid Cloudflare account identifier.');
  const accountSubdomain=(await cloudflare(`/accounts/${accountId}/workers/subdomain`))?.subdomain;
  if(!/^[a-z0-9-]+$/.test(accountSubdomain||''))throw Error('Workers.dev subdomain is unavailable.');

  const existing=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER}/settings`,{
    headers:{authorization:`Bearer ${process.env.CLOUDFLARE_EDGE_TOKEN}`},
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  if(existing.status!==404)throw Error('Temporary Auth probe Worker already exists; refusing to overwrite it.');

  const wrangler=path.join(process.env.EDGE_TOOLS_DIR,'node_modules/.bin/wrangler');
  const neon=path.join(process.env.EDGE_TOOLS_DIR,'node_modules/.bin/neon');
  const configPath=path.join(process.env.RUNNER_TEMP,'auth-probe-wrangler.json');
  const config={
    name:WORKER,
    main:path.resolve('edge/auth-webhook-probe.mjs'),
    account_id:accountId,
    compatibility_date:'2026-09-01',
    compatibility_flags:['nodejs_compat'],
    workers_dev:true,
    preview_urls:false,
    observability:{enabled:false},
    durable_objects:{bindings:[{name:'PROBE_STORE',class_name:'ProbeStore'}]},
    migrations:[{tag:'v1',new_sqlite_classes:['ProbeStore']}],
    vars:{AUTH_BASE},
  };
  fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600});

  const probeSecret=randomBytes(32).toString('hex');
  const password='P1-'+randomBytes(24).toString('base64url')+'!';
  console.log('::add-mask::'+probeSecret);
  console.log('::add-mask::'+password);
  const runId=String(process.env.GITHUB_RUN_ID||Date.now());
  const attempt=String(process.env.GITHUB_RUN_ATTEMPT||'1');
  const email=`pack1-auth-probe-${runId}-${attempt}@example.com`;
  const workerUrl=`https://${WORKER}.${accountSubdomain}.workers.dev`;

  let webhookChanged=false;
  let workerDeployed=false;
  let authUserId=null;
  try {
    run(wrangler,['deploy','--config',configPath]);
    workerDeployed=true;
    run(wrangler,['secret','bulk','--config',configPath],JSON.stringify({PROBE_SECRET:probeSecret}));
    const health=await fetch(workerUrl+'/health',{redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!health.ok)throw Error('Temporary Auth probe Worker health check failed.');

    const signup=await authPost('/sign-up/email',{name:'Pack One Auth Probe',email,password});
    if(signup.status<200||signup.status>=300)throw Error(`QA Auth probe signup failed with HTTP ${signup.status}.`);
    authUserId=signup.json?.user?.id||signup.json?.id||null;
    console.log('AUTH_PROBE_SIGNUP_STATUS '+signup.status);
    console.log('AUTH_PROBE_EMAIL '+email);

    await neonControl(WEBHOOK_API,{method:'PUT',body:{
      enabled:true,
      webhook_url:workerUrl+'/webhook',
      enabled_events:['send.magic_link'],
      timeout_seconds:5,
    }});
    webhookChanged=true;
    const enabled=await neonControl(WEBHOOK_API);
    console.log('AUTH_PROBE_ENABLED_CONFIG '+JSON.stringify(safeWebhookConfig(enabled)));

    const resetStarted=new Date().toISOString();
    console.log('AUTH_PROBE_RESET_STARTED '+resetStarted);
    const reset=await authPost('/request-password-reset',{email,redirectTo:'http://localhost:4173/reset-password/'});
    console.log('AUTH_PROBE_RESET_STATUS '+reset.status);
    if(reset.status<200||reset.status>=300)throw Error(`QA password reset request failed with HTTP ${reset.status}.`);

    let evidence=null;
    for(let i=0;i<20;i++) {
      const response=await fetch(workerUrl+'/evidence',{headers:{'x-probe-secret':probeSecret},redirect:'error',signal:AbortSignal.timeout(10000)});
      if(response.ok){evidence=await response.json();break;}
      await sleep(750);
    }
    if(!evidence)throw Error('No signed Auth webhook evidence was captured.');
    console.log('AUTH_PROBE_EVIDENCE '+JSON.stringify(evidence));
    if(!evidence.signature_verified)throw Error('Managed Neon webhook signature did not verify against the documented reconstruction.');
  } finally {
    if(webhookChanged) {
      try {
        const restore=safeWebhookConfig(original);
        await neonControl(WEBHOOK_API,{method:'PUT',body:{
          enabled:restore.enabled,
          ...(restore.webhook_url?{webhook_url:restore.webhook_url}:{}),
          ...(restore.enabled_events.length?{enabled_events:restore.enabled_events}:{}),
          ...(Number.isInteger(restore.timeout_seconds)?{timeout_seconds:restore.timeout_seconds}:{}),
        }});
        const finalConfig=await neonControl(WEBHOOK_API);
        console.log('AUTH_PROBE_FINAL_CONFIG '+JSON.stringify(safeWebhookConfig(finalConfig)));
      } catch {console.error('QA webhook rollback failed; inspect the Auth configuration immediately.');}
    }
    if(authUserId) {
      try {
        run(neon,['neon-auth','user','delete',authUserId,'--project-id',PROJECT,'--branch',BRANCH]);
        console.log('AUTH_PROBE_USER_CLEANED true');
      } catch {console.error('Disposable QA Auth user cleanup failed.');}
    }
    if(workerDeployed) {
      try {
        run(wrangler,['delete','--config',configPath,'--force']);
        console.log('AUTH_PROBE_WORKER_CLEANED true');
      } catch {console.error('Temporary Cloudflare probe cleanup failed.');}
    }
  }
}
main().catch(error=>{
  const message=String(error?.message||'');
  console.error(/^(Neon Auth control|Cloudflare control|Cloudflare rejected|Expected the active|Invalid Cloudflare|Workers\.dev|Temporary Auth probe|QA Auth webhook|Probe deployment|QA Auth probe signup|QA password reset|No signed Auth webhook|Managed Neon webhook)/.test(message)?message:'Auth webhook capability probe failed; inspect the sanitized step status.');
  process.exitCode=1;
});
