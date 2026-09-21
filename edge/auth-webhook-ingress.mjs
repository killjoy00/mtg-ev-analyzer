const MAX_BODY_BYTES=64*1024;
const DEV_BRANCH='br-twilight-hill-ayffyd2b';
const PROD_BRANCH='br-orange-feather-ayps8kep';
const FORWARDED_HEADERS=[
  'content-type',
  'x-neon-signature',
  'x-neon-signature-kid',
  'x-neon-timestamp',
  'x-neon-event-type',
  'x-neon-event-id',
  'x-neon-delivery-attempt',
];

function json(value,status=200) {
  return Response.json(value,{status,headers:{'cache-control':'no-store'}});
}
function runtime(env) {
  const mode=String(env.MODE||'');
  const branch=String(env.NEON_BRANCH_ID||'');
  const release=String(env.RELEASE_COMMIT||'');
  if(!['qa','production'].includes(mode)||
     !/^[a-f0-9]{40}$/.test(release)||
     (mode==='qa'&&branch!==DEV_BRANCH)||
     (mode==='production'&&branch!==PROD_BRANCH))
    throw Error('Auth webhook ingress not configured.');
  return {mode,branch,release};
}

export async function authWebhookIngress(request,env,fetcher=fetch) {
  const url=new URL(request.url);
  let config;
  try {config=runtime(env);} catch {return json({error:'Unavailable.'},503);}

  if(request.method==='GET'&&url.pathname==='/health'&&url.search==='?quick=1')
    return json({ok:true,service:'pack1-authhook-ingress',mode:config.mode,release_commit:config.release});
  if(url.pathname!=='/webhook')return json({error:'Not found.'},404);
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);

  const declared=Number(request.headers.get('content-length')||0);
  if(Number.isFinite(declared)&&declared>MAX_BODY_BYTES)return json({error:'Request too large.'},413);
  const body=new Uint8Array(await request.arrayBuffer());
  if(body.byteLength>MAX_BODY_BYTES)return json({error:'Request too large.'},413);

  const headers=new Headers();
  for(const name of FORWARDED_HEADERS) {
    const value=request.headers.get(name);
    if(value!==null)headers.set(name,value);
  }
  const upstream=`https://${config.branch}-pack1authhook.compute.c-5.us-east-2.aws.neon.tech/webhook`;
  let result;
  try {
    result=await fetcher(upstream,{
      method:'POST',
      headers,
      body,
      redirect:'manual',
      signal:AbortSignal.timeout(12000),
    });
  } catch {
    return json({error:'Webhook upstream unavailable.'},503);
  }
  if(result.status>=300&&result.status<400)return json({error:'Unexpected upstream redirect.'},502);
  return new Response(null,{status:result.status,headers:{'cache-control':'no-store'}});
}

export default {fetch(request,env){return authWebhookIngress(request,env);}};
