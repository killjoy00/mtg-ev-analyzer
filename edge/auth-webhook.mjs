import {Buffer} from 'node:buffer';
import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';

const MAX_BODY_BYTES=64*1024;
const MAX_CLOCK_SKEW_MS=5*60*1000;
const JWKS_CACHE_MS=10*60*1000;
const textEncoder=new TextEncoder();
const keyCache=new Map();

function base64url(bytes) {
  return Buffer.from(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes)).toString('base64url');
}
function responseJson(value,status=200) {
  return Response.json(value,{status,headers:{'cache-control':'no-store'}});
}
function safeString(value,max=512) {
  return typeof value==='string'&&value.length>0&&value.length<=max?value:null;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function validEmail(value) {
  return typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function validEventId(value) {
  return typeof value==='string'&&value.length>=8&&value.length<=128&&/^[A-Za-z0-9._:-]+$/.test(value);
}
function resetUrl(origin,token) {
  const base=new URL('/reset-password/',origin);
  base.search='';
  base.hash='token='+encodeURIComponent(token);
  return base.href;
}
function expiryCopy(expiresAt) {
  const value=Date.parse(expiresAt||'');
  if(!Number.isFinite(value))return 'This reset link expires soon.';
  return 'This reset link expires at '+new Date(value).toISOString().replace('T',' ').replace('.000Z',' UTC')+'.';
}

async function loadVerificationKey(authBase,kid,fetcher=fetch,now=Date.now(),force=false) {
  const cacheKey=authBase+'|'+kid;
  const cached=keyCache.get(cacheKey);
  if(!force&&cached&&cached.expiresAt>now)return cached.key;

  const response=await fetcher(authBase+'/.well-known/jwks.json',{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('JWKS unavailable');
  const jwks=await response.json();
  const jwk=jwks?.keys?.find(key=>key.kid===kid);
  if(!jwk)throw Error('Unknown webhook key');
  const key=createPublicKey({key:jwk,format:'jwk'});
  keyCache.set(cacheKey,{key,expiresAt:now+JWKS_CACHE_MS});
  return key;
}

export async function verifyNeonWebhook(rawBytes,headers,authBase,fetcher=fetch,now=Date.now()) {
  const signature=headers.get('x-neon-signature')||'';
  const kid=headers.get('x-neon-signature-kid')||'';
  const timestamp=headers.get('x-neon-timestamp')||'';
  const [protectedB64,emptyPayload,signatureB64]=signature.split('.');

  if(!protectedB64||emptyPayload!==''||!signatureB64||!kid||!/^\d{13}$/.test(timestamp))return false;
  let protectedHeader;
  try {protectedHeader=JSON.parse(Buffer.from(protectedB64,'base64url').toString('utf8'));} catch {return false;}
  if(protectedHeader?.alg!=='EdDSA'||protectedHeader?.kid!==kid)return false;
  const timestampMs=Number(timestamp);
  if(!Number.isFinite(timestampMs)||Math.abs(now-timestampMs)>MAX_CLOCK_SKEW_MS)return false;

  const payloadB64=base64url(rawBytes);
  const signaturePayloadB64=Buffer.from(timestamp+'.'+payloadB64,'utf8').toString('base64url');
  const signingInput=Buffer.from(protectedB64+'.'+signaturePayloadB64,'utf8');
  const signatureBytes=Buffer.from(signatureB64,'base64url');

  try {
    const key=await loadVerificationKey(authBase,kid,fetcher,now);
    if(verifySignature(null,signingInput,key,signatureBytes))return true;
    const refreshed=await loadVerificationKey(authBase,kid,fetcher,now,true);
    return verifySignature(null,signingInput,refreshed,signatureBytes);
  } catch {
    return false;
  }
}

export function validateRecoveryEvent(payload,headers) {
  const headerType=headers.get('x-neon-event-type');
  const eventId=headers.get('x-neon-event-id');
  if(headerType!=='send.magic_link'||payload?.event_type!=='send.magic_link')return null;
  if(!validEventId(eventId)||payload?.event_id!==eventId)return null;
  if(payload?.event_data?.link_type!=='forget-password')return null;

  const token=safeString(payload?.event_data?.token,512);
  const expiresAt=safeString(payload?.event_data?.expires_at,128);
  const email=payload?.user?.email;
  if(!token||!expiresAt||!validEmail(email))return null;
  return {eventId,email,token,expiresAt};
}

export function renderRecoveryEmail({resetOrigin,token,expiresAt}) {
  const url=resetUrl(resetOrigin,token);
  const expiration=expiryCopy(expiresAt);
  const escapedUrl=escapeHtml(url);
  const escapedExpiration=escapeHtml(expiration);
  const text=[
    'Reset your Pack One password',
    '',
    'We received a request to reset the password for your Pack One account.',
    '',
    url,
    '',
    expiration,
    '',
    'If you did not request this reset, you can ignore this email. Your password will not change unless the reset link is used.',
  ].join('\n');
  const html='<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"></head><body style="margin:0;padding:0;background-color:#f5f5f5;"><table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"><tr><td align="center" style="padding-top:32px;padding-right:16px;padding-bottom:32px;padding-left:16px;background-color:#f5f5f5;"><table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:600px;background-color:#ffffff;"><tr><td style="padding-top:32px;padding-right:32px;padding-bottom:16px;padding-left:32px;"><table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr><td width="40" height="40" align="center" valign="middle" bgcolor="#171918" style="width:40px;height:40px;background-color:#171918;border-radius:10px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:40px;color:#ffffff;font-weight:800;letter-spacing:-0.2px;text-align:center;">P<sup style="font-size:8px;line-height:0;vertical-align:5px;">1</sup></td><td style="padding-left:11px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:18px;color:#171918;font-weight:700;">Pack One</td></tr></table></td></tr><tr><td style="padding-top:0;padding-right:32px;padding-bottom:16px;padding-left:32px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:28px;color:#111111;font-weight:700;">Reset your password</td></tr><tr><td style="padding-top:0;padding-right:32px;padding-bottom:24px;padding-left:32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#333333;">We received a request to reset the password for your Pack One account.</td></tr><tr><td align="center" style="padding-top:0;padding-right:32px;padding-bottom:24px;padding-left:32px;"><table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr><td bgcolor="#111111" style="background-color:#111111;"><a href="'+escapedUrl+'" style="display:inline-block;padding-top:14px;padding-right:24px;padding-bottom:14px;padding-left:24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;color:#ffffff;text-decoration:none;font-weight:700;">Reset password</a></td></tr></table></td></tr><tr><td style="padding-top:0;padding-right:32px;padding-bottom:12px;padding-left:32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#555555;">'+escapedExpiration+'</td></tr><tr><td style="padding-top:0;padding-right:32px;padding-bottom:12px;padding-left:32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#555555;">If you did not request this reset, you can ignore this email. Your password will not change unless the reset link is used.</td></tr><tr><td style="padding-top:0;padding-right:32px;padding-bottom:32px;padding-left:32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#777777;word-break:break-all;">Copy and paste this Pack One link if the button does not work:<br><a href="'+escapedUrl+'" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#333333;text-decoration:underline;">'+escapedUrl+'</a></td></tr></table></td></tr></table></body></html>';
  return {url,text,html};
}

export async function sendRecoveryEmail(env,event,fetcher=fetch) {
  if(!env.RESEND_API_KEY||!env.SENDER||!env.RESET_ORIGIN||!env.SUBJECT)throw Error('Recovery email service is not configured');
  const rendered=renderRecoveryEmail({resetOrigin:env.RESET_ORIGIN,token:event.token,expiresAt:event.expiresAt});
  const response=await fetcher('https://api.resend.com/emails',{
    method:'POST',
    headers:{
      authorization:'Bearer '+env.RESEND_API_KEY,
      'content-type':'application/json',
      'idempotency-key':'neon-auth/send.magic_link/'+event.eventId,
    },
    body:JSON.stringify({
      from:env.SENDER,
      to:[event.email],
      subject:env.SUBJECT,
      html:rendered.html,
      text:rendered.text,
    }),
    signal:AbortSignal.timeout(5000),
  });
  if(!response.ok)throw Error('Recovery email delivery failed');
  const body=await response.json();
  if(!safeString(body?.id,128))throw Error('Recovery email provider returned an invalid response');
  return {id:body.id};
}

export class RecoveryEventDedupe {
  constructor(state,env) {
    this.storage=state.storage;
    this.env=env;
  }
  async fetch(request) {
    const url=new URL(request.url);
    if(url.pathname==='/telemetry') {
      if(request.method==='GET')return responseJson({entries:await this.storage.get('qa_telemetry')||[]});
      if(request.method!=='POST')return new Response(null,{status:405});
      let entry;
      try {entry=await request.json();} catch {return responseJson({ok:false},400);}
      const entries=await this.storage.get('qa_telemetry')||[];
      entries.push(entry);
      await this.storage.put('qa_telemetry',entries.slice(-30));
      return responseJson({ok:true});
    }
    if(request.method!=='POST')return new Response(null,{status:405});
    if(await this.storage.get('sent'))return responseJson({ok:true,duplicate:true});

    let event;
    try {event=await request.json();} catch {return responseJson({ok:false},400);}
    if(!validEventId(event?.eventId)||!validEmail(event?.email)||!safeString(event?.token,512)||!safeString(event?.expiresAt,128))return responseJson({ok:false},400);

    try {
      const result=await sendRecoveryEmail(this.env,event);
      await this.storage.put('sent',{messageId:result.id,sentAt:new Date().toISOString()});
      return responseJson({ok:true,duplicate:false});
    } catch {
      return responseJson({ok:false},502);
    }
  }
}

function logTiming(env,deliveryAttempt,details) {
  console.log(JSON.stringify({
    type:'pack1_authhook_timing',
    environment:env.PACK1_AUTH_ENV||'unknown',
    delivery_attempt:deliveryAttempt||null,
    ...details,
  }));
}
function eventTelemetryKey(eventId) {
  return createHash('sha256').update(String(eventId||'')).digest('hex').slice(0,16);
}
async function recordQaTelemetry(env,eventId,deliveryAttempt,details) {
  if(env.PACK1_AUTH_ENV!=='qa'||!env.RECOVERY_DEDUPE)return;
  try {
    const id=env.RECOVERY_DEDUPE.idFromName('__qa_telemetry__');
    await env.RECOVERY_DEDUPE.get(id).fetch('https://pack1.internal/telemetry',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        event_key:eventTelemetryKey(eventId),
        delivery_attempt:String(deliveryAttempt||''),
        at:new Date().toISOString(),
        ...details,
      }),
    });
  } catch {}
}

export async function authWebhook(request,env) {
  const started=Date.now();
  const url=new URL(request.url);
  if(url.pathname==='/health') {
    if(request.method!=='GET')return new Response(null,{status:405});
    if(url.searchParams.get('quick')!=='1')return new Response(null,{status:404});
    return responseJson({ok:true,service:'pack1authhook',environment:env.PACK1_AUTH_ENV||'unknown',release_commit:env.PACK1_RELEASE_COMMIT||null});
  }
  if(url.pathname==='/qa/telemetry') {
    if(env.PACK1_AUTH_ENV!=='qa')return new Response(null,{status:404});
    if(request.method!=='GET')return new Response(null,{status:405});
    const id=env.RECOVERY_DEDUPE.idFromName('__qa_telemetry__');
    return env.RECOVERY_DEDUPE.get(id).fetch('https://pack1.internal/telemetry');
  }
  if(url.pathname!=='/webhook')return new Response(null,{status:404});
  if(request.method!=='POST')return new Response(null,{status:405});

  const declared=Number(request.headers.get('content-length')||0);
  if(Number.isFinite(declared)&&declared>MAX_BODY_BYTES)return new Response(null,{status:413});
  const rawBytes=new Uint8Array(await request.arrayBuffer());
  if(rawBytes.byteLength===0||rawBytes.byteLength>MAX_BODY_BYTES)return new Response(null,{status:413});

  const verifyStarted=Date.now();
  if(!env.AUTH_BASE||!(await verifyNeonWebhook(rawBytes,request.headers,env.AUTH_BASE))) {
    logTiming(env,request.headers.get('x-neon-delivery-attempt'),{status:'invalid_signature',verify_ms:Date.now()-verifyStarted,total_ms:Date.now()-started});
    return new Response(null,{status:401});
  }
  const verifyMs=Date.now()-verifyStarted;

  let payload;
  try {payload=JSON.parse(new TextDecoder().decode(rawBytes));}
  catch {return new Response(null,{status:400});}

  const deliveryAttempt=request.headers.get('x-neon-delivery-attempt');
  const event=validateRecoveryEvent(payload,request.headers);
  if(!event) {
    const details={
      status:'rejected_event',
      event_type:safeString(payload?.event_type,64),
      link_type:safeString(payload?.event_data?.link_type,64),
      verify_ms:verifyMs,
      total_ms:Date.now()-started,
    };
    logTiming(env,deliveryAttempt,details);
    await recordQaTelemetry(env,payload?.event_id||request.headers.get('x-neon-event-id'),deliveryAttempt,details);
    return new Response(null,{status:400});
  }
  if(env.PACK1_AUTH_ENV==='qa'&&env.PACK1_FORCE_DELIVERY_FAILURE==='1') {
    const details={status:'forced_failure',verify_ms:verifyMs,total_ms:Date.now()-started};
    logTiming(env,deliveryAttempt,details);
    await recordQaTelemetry(env,event.eventId,deliveryAttempt,details);
    return new Response(null,{status:503});
  }

  const deliveryStarted=Date.now();
  const id=env.RECOVERY_DEDUPE.idFromName(event.eventId);
  const stub=env.RECOVERY_DEDUPE.get(id);
  const result=await stub.fetch('https://pack1.internal/send',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(event),
  });
  const deliveryMs=Date.now()-deliveryStarted;
  if(!result.ok) {
    const details={status:'delivery_failure',verify_ms:verifyMs,delivery_ms:deliveryMs,total_ms:Date.now()-started};
    logTiming(env,deliveryAttempt,details);
    await recordQaTelemetry(env,event.eventId,deliveryAttempt,details);
    return new Response(null,{status:502});
  }
  let deliveryResult={};
  try {deliveryResult=await result.json();} catch {}
  const details={status:'sent_or_duplicate',duplicate:Boolean(deliveryResult?.duplicate),verify_ms:verifyMs,delivery_ms:deliveryMs,total_ms:Date.now()-started};
  logTiming(env,deliveryAttempt,details);
  await recordQaTelemetry(env,event.eventId,deliveryAttempt,details);
  if(env.PACK1_AUTH_ENV==='qa'&&env.PACK1_FORCE_RETRY_AFTER_SEND==='1')return new Response(null,{status:503});
  return new Response(null,{status:204});
}

export default {fetch:authWebhook};
