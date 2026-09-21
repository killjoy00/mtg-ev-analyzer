import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const QA_WORKER='pack1-authhook-qa';
const PROD_WORKER='pack1-authhook-prod';
const DEV_BRANCH='br-twilight-hill-ayffyd2b';
const PROD_BRANCH='br-orange-feather-ayps8kep';

function run(bin,args) {
  try {
    return execFileSync(bin,args,{
      encoding:'utf8',
      stdio:['ignore','pipe','pipe'],
      env:{...process.env,CLOUDFLARE_API_TOKEN:process.env.CLOUDFLARE_EDGE_TOKEN},
    });
  } catch(error) {
    const status=Number.isInteger(error.status)?error.status:'unknown';
    throw Error('Auth webhook ingress command failed; exit '+status+'.');
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
  } catch {throw Error('Cloudflare Auth webhook control request failed.');}
  if(!response.ok)throw Error('Cloudflare Auth webhook control HTTP '+response.status+'.');
  const body=await response.json();
  if(body.success!==true)throw Error('Cloudflare rejected Auth webhook control.');
  return body.result;
}
async function context() {
  const zones=await cf('/zones?name=packone.pro&per_page=50');
  if(!Array.isArray(zones)||zones.length!==1||zones[0].status!=='active')throw Error('Expected active packone.pro zone.');
  const accountId=zones[0].account?.id;
  if(!/^[a-f0-9]{32}$/.test(accountId||''))throw Error('Invalid Cloudflare account.');
  const subdomain=(await cf('/accounts/'+accountId+'/workers/subdomain'))?.subdomain;
  if(!/^[a-z0-9-]+$/.test(subdomain||''))throw Error('Workers.dev subdomain unavailable.');
  return {accountId,subdomain};
}
async function deploy(mode) {
  const commit=String(process.env.GITHUB_SHA||'');
  if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Require exact ingress release commit.');
  const {accountId,subdomain}=await context();
  const worker=mode==='qa'?QA_WORKER:PROD_WORKER;
  const branch=mode==='qa'?DEV_BRANCH:PROD_BRANCH;
  const config=JSON.parse(fs.readFileSync('edge/auth-webhook-wrangler.json','utf8'));
  config.name=worker;
  config.main=path.resolve('edge/auth-webhook-ingress.mjs');
  config.account_id=accountId;
  config.vars={MODE:mode,NEON_BRANCH_ID:branch,RELEASE_COMMIT:commit};
  const configPath=path.join(process.env.RUNNER_TEMP,'auth-webhook-ingress-'+mode+'.json');
  fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
  const wrangler=path.join(process.env.EDGE_TOOLS_DIR,'node_modules/.bin/wrangler');
  run(wrangler,['deploy','--config',configPath]);
  const base='https://'+worker+'.'+subdomain+'.workers.dev';
  const response=await fetch(base+'/health?quick=1',{redirect:'error',signal:AbortSignal.timeout(15000)});
  const health=await response.json().catch(()=>({}));
  if(!response.ok||health.ok!==true||health.mode!==mode||health.release_commit!==commit)
    throw Error('Auth webhook ingress health verification failed.');
  console.log('AUTH_WEBHOOK_INGRESS_MODE '+mode);
  console.log('AUTH_WEBHOOK_INGRESS_URL '+base+'/webhook');
}
async function removeQa() {
  const {accountId}=await context();
  const config=JSON.parse(fs.readFileSync('edge/auth-webhook-wrangler.json','utf8'));
  config.name=QA_WORKER;
  config.account_id=accountId;
  const configPath=path.join(process.env.RUNNER_TEMP,'auth-webhook-ingress-qa-delete.json');
  fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
  const wrangler=path.join(process.env.EDGE_TOOLS_DIR,'node_modules/.bin/wrangler');
  try {run(wrangler,['delete','--config',configPath,'--force']);}
  catch(error) {
    if(!/not found/i.test(String(error?.message||'')))throw error;
  }
  console.log('AUTH_WEBHOOK_QA_INGRESS_REMOVED true');
}

async function main(action) {
  if(!process.env.CLOUDFLARE_EDGE_TOKEN)throw Error('CLOUDFLARE_EDGE_TOKEN is required.');
  if(!process.env.EDGE_TOOLS_DIR)throw Error('EDGE_TOOLS_DIR is required.');
  if(action==='deploy-qa')return deploy('qa');
  if(action==='deploy-production')return deploy('production');
  if(action==='remove-qa')return removeQa();
  throw Error('Unknown Auth webhook ingress operation.');
}
main(process.argv[2]).catch(error=>{
  const message=String(error?.message||'');
  console.error(/^(CLOUDFLARE|EDGE_TOOLS|Cloudflare Auth|Cloudflare rejected|Expected active|Invalid Cloudflare|Workers\.dev|Require exact|Auth webhook ingress|Unknown Auth)/.test(message)?message:'Auth webhook ingress operation failed.');
  process.exitCode=1;
});
