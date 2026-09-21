import path from 'node:path';
import {execFileSync} from 'node:child_process';

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
    throw Error(`Probe receiver cleanup failed; exit ${status}.`);
  }
}
async function cf(route,{allow404=false}={}) {
  const response=await fetch('https://api.cloudflare.com/client/v4'+route,{
    headers:{authorization:`Bearer ${process.env.CLOUDFLARE_EDGE_TOKEN}`},
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  if(allow404&&response.status===404)return null;
  if(!response.ok)throw Error(`Cloudflare cleanup inventory HTTP ${response.status}.`);
  const body=await response.json();
  if(!body.success)throw Error('Cloudflare rejected cleanup inventory request.');
  return body.result;
}
async function main() {
  if(!process.env.CLOUDFLARE_EDGE_TOKEN)throw Error('Cloudflare operations credential is missing.');
  if(!process.env.EDGE_TOOLS_DIR)throw Error('Pinned deployment tools are missing.');

  const zones=await cf('/zones?name=packone.pro&per_page=50');
  if(!Array.isArray(zones)||zones.length!==1||zones[0].status!=='active')throw Error('Expected the active Pack One Cloudflare zone.');
  const accountId=zones[0].account?.id;
  if(!/^[a-f0-9]{32}$/.test(accountId||''))throw Error('Invalid Cloudflare account identifier.');

  const settingsRoute=`/accounts/${accountId}/workers/scripts/${WORKER}/settings`;
  const existing=await cf(settingsRoute,{allow404:true});
  if(existing===null) {
    console.log('AUTH_PROBE_WORKER_CLEANED true');
    return;
  }

  const wrangler=path.join(process.env.EDGE_TOOLS_DIR,'node_modules/.bin/wrangler');
  run(wrangler,['delete','--name',WORKER,'--force']);
  if(await cf(settingsRoute,{allow404:true})!==null)throw Error('Temporary Auth probe Worker still exists after deletion.');
  console.log('AUTH_PROBE_WORKER_CLEANED true');
}
main().catch(error=>{
  const message=String(error?.message||'');
  console.error(/^(Cloudflare operations|Pinned deployment|Cloudflare cleanup|Cloudflare rejected|Expected the active|Invalid Cloudflare|Probe receiver|Temporary Auth probe)/.test(message)?message:'Probe receiver cleanup failed.');
  process.exitCode=1;
});
