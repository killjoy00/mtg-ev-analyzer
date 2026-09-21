import {Buffer} from 'node:buffer';
import {createPublicKey,verify as verifySignature} from 'node:crypto';

const MAX_BODY_BYTES=64*1024;
const textEncoder=new TextEncoder();

function base64url(bytes) {
  return Buffer.from(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes)).toString('base64url');
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
function responseJson(value,status=200) {
  return Response.json(value,{status,headers:{'cache-control':'no-store'}});
}

export async function verifyNeonWebhookDetailed(rawBytes,headers,authBase,fetcher=fetch,now=Date.now()) {
  const signature=headers.get('x-neon-signature')||'';
  const kid=headers.get('x-neon-signature-kid')||'';
  const timestamp=headers.get('x-neon-timestamp')||'';
  const [protectedB64,emptyPayload,signatureB64]=signature.split('.');
  const details={
    verified:false,
    envelope_valid:false,
    timestamp_fresh:false,
    jwks_fetch_ok:false,
    jwks_key_found:false,
    public_key_imported:false,
    signature_valid:false,
  };

  if(!protectedB64||emptyPayload!==''||!signatureB64||!kid||!/^\d{10,16}$/.test(timestamp))return details;
  details.envelope_valid=true;

  const timestampMs=Number(timestamp);
  if(!Number.isFinite(timestampMs)||Math.abs(now-timestampMs)>5*60*1000)return details;
  details.timestamp_fresh=true;

  let jwksResponse;
  try {
    jwksResponse=await fetcher(authBase+'/.well-known/jwks.json',{redirect:'error',signal:AbortSignal.timeout(5000)});
  } catch {
    return details;
  }
  if(!jwksResponse.ok)return details;
  details.jwks_fetch_ok=true;

  let jwks;
  try {jwks=await jwksResponse.json();} catch {return details;}
  const jwk=jwks?.keys?.find(key=>key.kid===kid);
  if(!jwk)return details;
  details.jwks_key_found=true;

  let publicKey;
  try {
    publicKey=createPublicKey({key:jwk,format:'jwk'});
    details.public_key_imported=true;
  } catch {
    return details;
  }

  try {
    const payloadB64=base64url(rawBytes);
    const signaturePayloadB64=Buffer.from(timestamp+'.'+payloadB64,'utf8').toString('base64url');
    const signingInput=Buffer.from(protectedB64+'.'+signaturePayloadB64,'utf8');
    details.signature_valid=verifySignature(
      null,
      signingInput,
      publicKey,
      Buffer.from(signatureB64,'base64url'),
    );
    details.verified=details.signature_valid;
  } catch {
    details.signature_valid=false;
    details.verified=false;
  }
  return details;
}

export async function verifyNeonWebhook(rawBytes,headers,authBase,fetcher=fetch,now=Date.now()) {
  return (await verifyNeonWebhookDetailed(rawBytes,headers,authBase,fetcher,now)).verified;
}

export class ProbeStore {
  constructor(state) {this.storage=state.storage;}
  async fetch(request) {
    if(request.method==='PUT') {
      await this.storage.put('evidence',await request.json());
      return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
    }
    if(request.method==='GET') {
      const evidence=await this.storage.get('evidence');
      return evidence?responseJson(evidence):responseJson({ready:false},404);
    }
    if(request.method==='DELETE') {
      await this.storage.delete('evidence');
      return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
    }
    return new Response(null,{status:405,headers:{'cache-control':'no-store'}});
  }
}

async function evidenceStore(env) {
  return env.PROBE_STORE.get(env.PROBE_STORE.idFromName('singleton'));
}
async function writeEvidence(env,evidence) {
  const store=await evidenceStore(env);
  await store.fetch('https://probe-store/evidence',{
    method:'PUT',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(evidence),
  });
}
async function sanitizedPayload(rawBytes) {
  let payload;
  try {payload=JSON.parse(new TextDecoder().decode(rawBytes));}
  catch {return {json_valid:false};}

  const token=typeof payload?.event_data?.token==='string'?payload.event_data.token:'';
  const linkUrl=typeof payload?.event_data?.link_url==='string'?payload.event_data.link_url:'';
  let linkHost=null;
  try {linkHost=linkUrl?new URL(linkUrl).hostname:null;} catch {}
  return {
    json_valid:true,
    event_type_payload:payload?.event_type||null,
    payload_shape:payloadShape(payload),
    user_email_present:typeof payload?.user?.email==='string',
    link_type:payload?.event_data?.link_type||null,
    link_host:linkHost,
    token_present:Boolean(token),
    token_length:token.length,
    token_sha256:token?await sha256Hex(token):null,
  };
}

export async function authProbe(request,env) {
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/health')return responseJson({ok:true,probe:'pack1-auth-webhook'});
  if((request.method==='GET'||request.method==='DELETE')&&url.pathname==='/evidence') {
    const store=await evidenceStore(env);
    return store.fetch('https://probe-store/evidence',{method:request.method});
  }
  if(request.method!=='POST'||url.pathname!=='/webhook')return new Response(null,{status:404});

  const rawBytes=new Uint8Array(await request.arrayBuffer());
  if(rawBytes.byteLength>MAX_BODY_BYTES)return new Response(null,{status:413,headers:{'cache-control':'no-store'}});

  const signature=request.headers.get('x-neon-signature')||'';
  const timestamp=request.headers.get('x-neon-timestamp')||'';
  const baseEvidence={
    ready:true,
    raw_body_bytes:rawBytes.byteLength,
    raw_body_sha256:await sha256Hex(rawBytes),
    neon_header_names:[...request.headers.keys()].filter(name=>name.startsWith('x-neon-')).sort(),
    event_type_header:request.headers.get('x-neon-event-type')||null,
    event_id_present:Boolean(request.headers.get('x-neon-event-id')),
    delivery_attempt:request.headers.get('x-neon-delivery-attempt')||null,
    timestamp_digits:timestamp.length,
    timestamp_age_ms:/^\d{10,16}$/.test(timestamp)?Date.now()-Number(timestamp):null,
    signature_kid_present:Boolean(request.headers.get('x-neon-signature-kid')),
    signature_parts:signature?signature.split('.').map(part=>part.length):[],
    ...(await sanitizedPayload(rawBytes)),
  };

  let verification;
  try {
    verification=await verifyNeonWebhookDetailed(rawBytes,request.headers,env.AUTH_BASE);
  } catch {
    verification={
      verified:false,
      envelope_valid:false,
      timestamp_fresh:false,
      jwks_fetch_ok:false,
      jwks_key_found:false,
      public_key_imported:false,
      signature_valid:false,
    };
  }

  const evidence={...baseEvidence,verification};
  await writeEvidence(env,evidence);
  if(!verification.verified)return new Response(null,{status:400,headers:{'cache-control':'no-store'}});
  return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
}

export default {fetch:authProbe};
