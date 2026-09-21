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
    const output=String(error.stderr||'')+'\n'+String(error.stdout||'');
    if(/not found|does not exist/i.test(output))return '';
    const status=Number.isInteger(error.status)?error.status:'unknown';
    throw Error(`Probe receiver cleanup failed; exit ${status}.`);
  }
}
async function main() {
  if(!process.env.CLOUDFLARE_EDGE_TOKEN)throw Error('Cloudflare operations credential is missing.');
  if(!process.env.EDGE_TOOLS_DIR)throw Error('Pinned deployment tools are missing.');
  const wrangler=path.join(process.env.EDGE_TOOLS_DIR,'node_modules/.bin/wrangler');
  run(wrangler,['delete','--name',WORKER,'--force']);
  console.log('AUTH_PROBE_WORKER_CLEANED true');
}
main().catch(error=>{console.error(String(error?.message||'Probe receiver cleanup failed.'));process.exitCode=1;});
