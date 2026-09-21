import crypto from 'node:crypto';
import getRawBody from 'raw-body';

const AUTH_BASE='https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeShape(value,depth=0) {
  if(depth>4)return '[max-depth]';
  if(value===null)return 'null';
  if(Array.isArray(value))return value.slice(0,8).map(v=>safeShape(v,depth+1));
  if(typeof value!=='object')return typeof value;
  return Object.fromEntries(Object.entries(value).slice(0,40).map(([k,v])=>[k,safeShape(v,depth+1)]));
}

async function verify(raw,headers) {
  const signature=String(headers['x-neon-signature']||'');
  const kid=String(headers['x-neon-signature-kid']||'');
  const timestamp=String(headers['x-neon-timestamp']||'');
  const [protectedB64,empty,signatureB64]=signature.split('.');
  if(!protectedB64||empty!==''||!signatureB64||!kid||!/^[0-9]{10,16}$/.test(timestamp))return false;
  const jwks=await fetch(AUTH_BASE+'/.well-known/jwks.json',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());
  const jwk=jwks?.keys?.find(k=>k.kid===kid);
  if(!jwk)return false;
  const key=crypto.createPublicKey({key:jwk,format:'jwk'});
  const payloadB64=Buffer.from(raw).toString('base64url');
  const signaturePayloadB64=Buffer.from(timestamp+'.'+payloadB64).toString('base64url');
  return crypto.verify(
    null,
    Buffer.from(protectedB64+'.'+signaturePayloadB64),
    key,
    Buffer.from(signatureB64,'base64url'),
  );
}

export default async function handler(request,response) {
  if(request.method!=='POST')return response.status(405).json({ok:false});
  const raw=await getRawBody(request,{limit:'64kb'});
  let payload;
  try {payload=JSON.parse(raw.toString('utf8'));} catch {return response.status(400).json({ok:false});}

  const token=typeof payload?.event_data?.token==='string'?payload.event_data.token:'';
  const signature=String(request.headers['x-neon-signature']||'');
  const safe={
    probe:'pack1-neon-auth',
    raw_body_bytes:raw.length,
    raw_body_sha256:sha256(raw),
    event_type:String(request.headers['x-neon-event-type']||''),
    event_id:String(request.headers['x-neon-event-id']||''),
    delivery_attempt:String(request.headers['x-neon-delivery-attempt']||''),
    timestamp:String(request.headers['x-neon-timestamp']||''),
    signature_kid:String(request.headers['x-neon-signature-kid']||''),
    signature_parts:signature?signature.split('.').map(x=>x.length):[],
    payload_event_type:String(payload?.event_type||''),
    link_type:String(payload?.event_data?.link_type||''),
    token_present:Boolean(token),
    token_length:token.length,
    token_sha256:token?sha256(token):null,
    payload_shape:safeShape(payload),
  };

  try {safe.signature_verified=await verify(raw,request.headers);}
  catch {safe.signature_verified=false;}

  console.log(JSON.stringify(safe));
  return response.status(204).end();
}

export const config={api:{bodyParser:false}};
