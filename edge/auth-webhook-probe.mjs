const MAX_BODY_BYTES=64*1024;
const textEncoder=new TextEncoder();

function base64url(bytes) {
  const view=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  let binary='';
  for(let i=0;i<view.length;i+=0x8000)binary+=String.fromCharCode(...view.subarray(i,i+0x8000));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function fromBase64url(value) {
  const normalized=String(value||'').replace(/-/g,'+').replace(/_/g,'/');
  const padded=normalized+'='.repeat((4-normalized.length%4)%4);
  const binary=atob(padded);
  return Uint8Array.from(binary,ch=>ch.charCodeAt(0));
}
async function sha256Hex(value) {
  const bytes=typeof value==='string'?textEncoder.encode(value):(value instanceof Uint8Array?value:new Uint8Array(value));
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return [...digest].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function payloadShape(value,depth=0) {
  if(depth>4)return '[max-depth]';
  if(value===null)return 'null';
  if(Array.isArray(value))return value.slice(0,8).map(item=>payloadShape(item,depth+1));
  if(typeof value!=='object')return typeof value;
  return Object.fromEntries(Object.entries(value).slice(0,40).map(([key,item])=>[key,payloadShape(item,depth+1)]));
}

export async function verifyNeonWebhook(rawBytes,headers,authBase,fetcher=fetch,now=Date.now()) {
  const signature=headers.get('x-neon-signature')||'';
  const kid=headers.get('x-neon-signature-kid')||'';
  const timestamp=headers.get('x-neon-timestamp')||'';
  const [protectedB64,emptyPayload,signatureB64]=signature.split('.');
  if(!protectedB64||emptyPayload!==''||!signatureB64||!kid||!/^\d{10,16}$/.test(timestamp))return false;
  const timestampMs=Number(timestamp);
  if(!Number.isFinite(timestampMs)||Math.abs(now-timestampMs)>5*60*1000)return false;

  const jwksResponse=await fetcher(authBase+'/.well-known/jwks.json',{redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!jwksResponse.ok)return false;
  const jwks=await jwksResponse.json();
  const jwk=jwks?.keys?.find(key=>key.kid===kid);
  if(!jwk)return false;

  const publicKey=await crypto.subtle.importKey('jwk',jwk,{name:'Ed25519'},false,['verify']);
  const payloadB64=base64url(rawBytes);
  const signedPayloadB64=base64url(textEncoder.encode(timestamp+'.'+payloadB64));
  const signingInput=textEncoder.encode(protectedB64+'.'+signedPayloadB64);
  return crypto.subtle.verify({name:'Ed25519'},publicKey,fromBase64url(signatureB64),signingInput);
}

export class ProbeStore {
  constructor(state) {this.storage=state.storage;}
  async fetch(request) {
    if(request.method==='PUT') {
      await this.storage.put('evidence',await request.json());
      return new Response(null,{status:204});
    }
    if(request.method==='GET') {
      const evidence=await this.storage.get('evidence');
      return evidence?Response.json(evidence):Response.json({ready:false},{status:404});
    }
    return new Response(null,{status:405});
  }
}

async function evidenceStore(env) {
  return env.PROBE_STORE.get(env.PROBE_STORE.idFromName('singleton'));
}
async function writeEvidence(env,evidence) {
  const store=await evidenceStore(env);
  await store.fetch('https://probe-store/evidence',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(evidence)});
}

export async function authProbe(request,env) {
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/health')return Response.json({ok:true,probe:'pack1-auth-webhook'});
  if(request.method==='GET'&&url.pathname==='/evidence') {
    if(request.headers.get('x-probe-secret')!==env.PROBE_SECRET)return new Response(null,{status:403});
    const store=await evidenceStore(env);
    return store.fetch('https://probe-store/evidence');
  }
  if(request.method!=='POST'||url.pathname!=='/webhook')return new Response(null,{status:404});

  const rawBytes=new Uint8Array(await request.arrayBuffer());
  if(rawBytes.byteLength>MAX_BODY_BYTES)return new Response(null,{status:413});
  const neonHeaderNames=[...request.headers.keys()].filter(name=>name.startsWith('x-neon-')).sort();
  const signature=request.headers.get('x-neon-signature')||'';
  const invalidEvidence={
    ready:true,
    signature_verified:false,
    raw_body_bytes:rawBytes.byteLength,
    raw_body_sha256:await sha256Hex(rawBytes),
    neon_header_names:neonHeaderNames,
    signature_parts:signature?signature.split('.').map(part=>part.length):[],
  };

  let verified=false;
  try {verified=await verifyNeonWebhook(rawBytes,request.headers,env.AUTH_BASE);}
  catch {verified=false;}
  if(!verified) {
    await writeEvidence(env,invalidEvidence);
    return new Response(null,{status:400});
  }

  let payload;
  try {payload=JSON.parse(new TextDecoder().decode(rawBytes));}
  catch {
    await writeEvidence(env,{...invalidEvidence,signature_verified:true,json_valid:false});
    return new Response(null,{status:400});
  }

  const token=typeof payload?.event_data?.token==='string'?payload.event_data.token:'';
  const linkUrl=typeof payload?.event_data?.link_url==='string'?payload.event_data.link_url:'';
  let linkHost=null;
  try {linkHost=linkUrl?new URL(linkUrl).hostname:null;} catch {}
  const evidence={
    ready:true,
    signature_verified:true,
    json_valid:true,
    raw_body_bytes:rawBytes.byteLength,
    raw_body_sha256:await sha256Hex(rawBytes),
    neon_header_names:neonHeaderNames,
    event_type_header:request.headers.get('x-neon-event-type')||null,
    event_id:request.headers.get('x-neon-event-id')||null,
    delivery_attempt:request.headers.get('x-neon-delivery-attempt')||null,
    signature_kid_present:Boolean(request.headers.get('x-neon-signature-kid')),
    signature_parts:signature.split('.').map(part=>part.length),
    event_type_payload:payload?.event_type||null,
    payload_shape:payloadShape(payload),
    user_email_present:typeof payload?.user?.email==='string',
    link_type:payload?.event_data?.link_type||null,
    link_host:linkHost,
    token_present:Boolean(token),
    token_length:token.length,
    token_sha256:token?await sha256Hex(token):null,
  };
  await writeEvidence(env,evidence);
  return new Response(null,{status:204});
}

export default {fetch:authProbe};
