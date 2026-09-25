const WORKER='pack1-auth-webhook-probe-temp';

async function cf(route,{method='GET',allow404=false}={}) {
  const response=await fetch('https://api.cloudflare.com/client/v4'+route,{
    method,
    headers:{authorization:`Bearer ${process.env.CLOUDFLARE_EDGE_TOKEN}`},
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  if(allow404&&response.status===404)return null;
  if(!response.ok)throw Error(`Cloudflare control HTTP ${response.status}.`);
  const body=await response.json();
  if(!body.success)throw Error('Cloudflare rejected probe receiver cleanup.');
  return body.result;
}

async function main() {
  if(!process.env.CLOUDFLARE_EDGE_TOKEN)throw Error('Cloudflare operations credential is missing.');

  const zones=await cf('/zones?name=packone.pro&per_page=50');
  if(!Array.isArray(zones)||zones.length!==1||zones[0].status!=='active')throw Error('Expected the active Pack One Cloudflare zone.');
  const accountId=zones[0].account?.id;
  if(!/^[a-f0-9]{32}$/.test(accountId||''))throw Error('Invalid Cloudflare account identifier.');

  const existing=await cf(`/accounts/${accountId}/workers/scripts/${WORKER}/settings`,{allow404:true});
  if(!existing) {
    console.log('AUTH_PROBE_WORKER_CLEANED already-absent');
    return;
  }

  await cf(`/accounts/${accountId}/workers/scripts/${WORKER}`,{method:'DELETE'});
  const verify=await cf(`/accounts/${accountId}/workers/scripts/${WORKER}/settings`,{allow404:true});
  if(verify)throw Error('Temporary Auth probe Worker still exists after delete.');
  console.log('AUTH_PROBE_WORKER_CLEANED true');
}

main().catch(error=>{
  const message=String(error?.message||'');
  console.error(/^(Cloudflare control|Cloudflare rejected|Expected the active|Invalid Cloudflare|Temporary Auth probe|Cloudflare operations)/.test(message)?message:'Probe receiver cleanup failed; inspect the sanitized step status.');
  process.exitCode=1;
});
