import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const CONFIGS={
  qa:{
    worker:'pack1-authhook-qa',
    authBase:'https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth',
    sender:'Pack One QA <qa-accounts@packone.pro>',
    subject:'Reset Your Password - Pack One QA',
    resetOrigin:'http://localhost:4173',
  },
  production:{
    worker:'pack1-authhook',
    authBase:'https://ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth',
    sender:'Pack One <accounts@packone.pro>',
    subject:'Reset Your Password - Pack One',
    resetOrigin:'https://packone.pro',
  },
};

function requireSecret(value,name) {
  if(typeof value!=='string'||value.length<20)throw Error(name+' is missing or too short.');
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
    const stage=args[0]==='secret'?'secret installation':args[0]==='delete'?'Worker deletion':'Worker deployment';
    throw Error('Cloudflare '+stage+' failed; exit '+status+'.');
  }
}
async function cf(route) {
  let response;
  try {
    response=await fetch('https://api.cloudflare.com/client/v4'+route,{
      headers:{authorization:'Bearer '+process.env.CLOUDFLARE_EDGE_TOKEN},
      redirect:'error',
      signal:AbortSignal.timeout(15000),
    });
  } catch {
    throw Error('Cloudflare control request failed.');
  }
  if(!response.ok)throw Error('Cloudflare control HTTP '+response.status+'.');
  const body=await response.json();
  if(!body.success)throw Error('Cloudflare rejected the control request.');
  return body.result;
}
async function cloudflareContext() {
  const zones=await cf('/zones?name=packone.pro&per_page=50');
  if(!Array.isArray(zones)||zones.length!==1||zones[0].status!=='active')throw Error('Expected the active Pack One Cloudflare zone.');
  const accountId=zones[0].account?.id;
  if(!/^[a-f0-9]{32}$/.test(accountId||''))throw Error('Invalid Cloudflare account identifier.');
  const accountSubdomain=(await cf('/accounts/'+accountId+'/workers/subdomain'))?.subdomain;
  if(!/^[a-z0-9-]+$/.test(accountSubdomain||''))throw Error('Workers.dev subdomain is unavailable.');
  return {accountId,accountSubdomain};
}
function tool(name) {
  if(!process.env.EDGE_TOOLS_DIR)throw Error('Pinned deployment tools are missing.');
  return path.join(process.env.EDGE_TOOLS_DIR,'node_modules/.bin',name);
}
function validateEnvironment() {
  requireSecret(process.env.CLOUDFLARE_EDGE_TOKEN,'CLOUDFLARE_EDGE_TOKEN');
  requireSecret(process.env.PACK1_AUTH_RESEND_API_KEY,'PACK1_AUTH_RESEND_API_KEY');
  if(!String(process.env.PACK1_AUTH_RESEND_API_KEY).startsWith('re_'))throw Error('PACK1_AUTH_RESEND_API_KEY has an unexpected format.');
}
async function deploy(target,{forceFailure=false}={}) {
  const cfg=CONFIGS[target];
  if(!cfg)throw Error('Unknown Auth webhook deployment target.');
  validateEnvironment();
  const commit=String(process.env.RELEASE_COMMIT||process.env.GITHUB_SHA||'');
  if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Exact release commit is required.');

  const {accountId,accountSubdomain}=await cloudflareContext();
  const configPath=path.join(process.env.RUNNER_TEMP,'auth-webhook-'+target+'.json');
  const wranglerConfig={
    name:cfg.worker,
    main:path.resolve('edge/auth-webhook.mjs'),
    account_id:accountId,
    compatibility_date:'2026-09-01',
    compatibility_flags:['nodejs_compat'],
    workers_dev:true,
    preview_urls:false,
    observability:{enabled:false},
    durable_objects:{bindings:[{name:'RECOVERY_DEDUPE',class_name:'RecoveryEventDedupe'}]},
    migrations:[{tag:'v1',new_sqlite_classes:['RecoveryEventDedupe']}],
    vars:{
      AUTH_BASE:cfg.authBase,
      PACK1_AUTH_ENV:target==='production'?'production':'qa',
      RESET_ORIGIN:cfg.resetOrigin,
      SENDER:cfg.sender,
      SUBJECT:cfg.subject,
      PACK1_RELEASE_COMMIT:commit,
      PACK1_FORCE_DELIVERY_FAILURE:forceFailure?'1':'0',
    },
  };
  fs.writeFileSync(configPath,JSON.stringify(wranglerConfig),{mode:0o600});

  const wrangler=tool('wrangler');
  run(wrangler,['deploy','--config',configPath]);
  run(wrangler,['secret','bulk','--config',configPath],JSON.stringify({RESEND_API_KEY:process.env.PACK1_AUTH_RESEND_API_KEY}));

  const base='https://'+cfg.worker+'.'+accountSubdomain+'.workers.dev';
  const health=await fetch(base+'/health?quick=1',{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!health.ok)throw Error('Auth webhook health verification failed.');
  const body=await health.json();
  if(body.release_commit!==commit||body.environment!==(target==='production'?'production':'qa'))throw Error('Auth webhook release marker mismatch.');
  console.log('AUTH_WEBHOOK_URL '+base+'/webhook');
  console.log('AUTH_WEBHOOK_HEALTH '+base+'/health?quick=1');
  console.log('Auth webhook '+target+' deployment verified at exact revision '+commit+'.');
}
async function removeQa() {
  requireSecret(process.env.CLOUDFLARE_EDGE_TOKEN,'CLOUDFLARE_EDGE_TOKEN');
  const wrangler=tool('wrangler');
  run(wrangler,['delete','--name',CONFIGS.qa.worker,'--force']);
  console.log('QA Auth webhook Worker removed.');
}
async function verify(target) {
  const cfg=CONFIGS[target];
  if(!cfg)throw Error('Unknown Auth webhook verification target.');
  requireSecret(process.env.CLOUDFLARE_EDGE_TOKEN,'CLOUDFLARE_EDGE_TOKEN');
  const commit=String(process.env.RELEASE_COMMIT||process.env.GITHUB_SHA||'');
  if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Exact release commit is required.');
  const {accountSubdomain}=await cloudflareContext();
  const base='https://'+cfg.worker+'.'+accountSubdomain+'.workers.dev';
  const response=await fetch(base+'/health?quick=1',{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Auth webhook health verification failed.');
  const body=await response.json();
  if(body.release_commit!==commit)throw Error('Auth webhook release marker mismatch.');
  console.log('Auth webhook '+target+' release marker verified.');
}
async function main(action) {
  if(action==='check-secret') {
    validateEnvironment();
    console.log('Dedicated Auth webhook deployment credentials are present.');
    return;
  }
  if(action==='deploy-qa')return deploy('qa');
  if(action==='deploy-qa-fail')return deploy('qa',{forceFailure:true});
  if(action==='deploy-production')return deploy('production');
  if(action==='verify-qa')return verify('qa');
  if(action==='verify-production')return verify('production');
  if(action==='delete-qa')return removeQa();
  throw Error('Unknown Auth webhook control action.');
}

main(process.argv[2]).catch(error=>{
  const message=String(error?.message||'');
  console.error(/^(CLOUDFLARE_EDGE_TOKEN|PACK1_AUTH_RESEND_API_KEY|Pinned deployment|Cloudflare|Expected the active|Invalid Cloudflare|Workers\.dev|Unknown Auth webhook|Exact release|Auth webhook|QA Auth webhook)/.test(message)?message:'Auth webhook control failed; inspect the sanitized step status.');
  process.exitCode=1;
});
