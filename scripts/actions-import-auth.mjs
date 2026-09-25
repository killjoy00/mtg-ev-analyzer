// GitHub Actions workload identity; no database credentials leave Neon.
let cached=null,loading=null;
async function token() {
  if(cached&&cached.expires>Date.now()+60000)return cached.value;
  if(!loading)loading=(async()=>{
    const source=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    if(!source||!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw Error('GitHub Actions id-token: write is required');
    const url=new URL(source);url.searchParams.set('audience','pack-one-trophy-import');
    const r=await fetch(url,{headers:{authorization:`Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`},signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw Error('GitHub identity request failed: '+r.status);
    const {value}=await r.json();const claims=JSON.parse(Buffer.from(value.split('.')[1],'base64url'));
    cached={value,expires:claims.exp*1000};return value;
  })().finally(()=>{loading=null;});
  return loading;
}
export async function importRequest(endpoint,body) {
  if(!/^https:\/\/br-(twilight-hill-ayffyd2b|orange-feather-ayps8kep)-draftrunapi\.compute\.c-5\.us-east-2\.aws\.neon\.tech\/?$/.test(endpoint))throw Error('Unexpected import endpoint');
  for(let attempt=0;attempt<4;attempt++) {
    try {
      const r=await fetch(endpoint.replace(/\/$/,'')+'/v1/trophy-import',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${await token()}`},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
      if(r.ok)return r.json();
      if(![429,500,502,503,504].includes(r.status))throw Object.assign(Error('Import rejected: '+r.status),{permanent:true});
      if(attempt===3)throw Error('Import unavailable: '+r.status);
    } catch(e){if(e.permanent||attempt===3)throw e;}
    await new Promise(r=>setTimeout(r,1000*2**attempt));
  }
}
if(process.argv[1]?.endsWith('/actions-import-auth.mjs'))console.log(await importRequest(process.argv[2],{action:'status',setId:'hob'}));
