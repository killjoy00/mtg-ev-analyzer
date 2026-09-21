import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const AUTH_BASE='https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';
const WORKER='pack1-auth-webhook-probe-temp';

function run(binary,args) {
  try {
    return execFileSync(binary,args,{
      encoding:'utf8',
      stdio:['ignore','pipe','pipe'],
      env:{...process.env,CLOUDFLARE_API_TOKEN:process.env.CLOUDFLARE_EDGE_TOKEN},
    });
  } catch(error) {
    const status=Number.isInteger(error.status)?error.status:'unknown';
    throw Error(`Probe receiver command failed; exit ${status}.`);
  }
}
async function cf(route) {
  const response=await fetch('https://api.cloudflare.com/client/v4'+route,{
    headers:{authorization:`Bearer ${process.env.CLOUDFLARE_EDGE_TOKEN}`},
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw Error(`Cloudflare control HTTP ${response.status}.`);
  const body=await response.json();
  if(!body.success)throw Error('Cloudflare rejected probe receiver setup.');
  return body.result;
}
async function main() {
  if(!process.env.CLOUDFLARE_EDGE_TOKEN)throw Error('Cloudflare operations credential is missing.');
  if(!process.env.EDGE_TOOLS_DIR)throw Error('Pinned deployment tools are missing.');

  const zones=await cf('/zones?name=packone.pro&per_page=50');
  if(!Array.isArray(zones)||zones.length!==1||zones[0].status!=='active')throw Error('Expected the active Pack One Cloudflare zone.');
  const accountId=zones[0].account?.id;
  if(!/^[a-f0-9]{32}$/.test(accountId||''))throw Error('Invalid Cloudflare account identifier.');
  const accountSubdomain=(await cf(`/accounts/${accountId}/workers/subdomain`))?.subdomain;
  if(!/^[a-z0-9-]+$/.test(accountSubdomain||''))throw Error('Workers.dev subdomain is unavailable.');

  const existing=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER}/settings`,{
    headers:{authorization:`Bearer ${process.env.CLOUDFLARE_EDGE_TOKEN}`},
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  if(existing.status!==404)throw Error('Temporary Auth probe Worker already exists; refusing to overwrite it.');

  const wrangler=path.join(process.env.EDGE_TOOLS_DIR,'node_modules/.bin/wrangler');
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

  run(wrangler,['deploy','--config',configPath]);

  const workerUrl=`https://${WORKER}.${accountSubdomain}.workers.dev`;
  const health=await fetch(workerUrl+'/health',{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!health.ok)throw Error('Temporary Auth probe Worker health check failed.');

  console.log('AUTH_PROBE_RECEIVER_URL '+workerUrl);
  console.log('AUTH_PROBE_WEBHOOK_URL '+workerUrl+'/webhook');
}
main().catch(error=>{
  const message=String(error?.message||'');
  console.error(/^(Cloudflare control|Cloudflare rejected|Expected the active|Invalid Cloudflare|Workers\.dev|Temporary Auth probe|Probe receiver|Pinned deployment|Cloudflare operations)/.test(message)?message:'Auth probe receiver staging failed; inspect sanitized step status.');
  process.exitCode=1;
});
