import {Buffer} from 'node:buffer';
import {createPublicKey,verify as verifySignature} from 'node:crypto';
import {accountRuntimeConfig} from './account-config.mjs';

const MAX_BODY_BYTES=64*1024;
const MAX_CLOCK_SKEW_MS=5*60*1000;
const MAX_FUTURE_SKEW_MS=60*1000;
const JWKS_CACHE_MS=10*60*1000;
const RESEND_TIMEOUT_MS=4000;
const EVENT_TYPE='send.magic_link';
const LINK_TYPE='forget-password';
const FROM='Pack One <accounts@packone.pro>';
const keyCache=new Map();

function json(value,status=200) {
  return Response.json(value,{status,headers:{'cache-control':'no-store'}});
}
function fail(status,code) {
  throw Object.assign(new Error(code),{status,code});
}
function releaseCommit() {
  return process.env.PACK1_RELEASE_COMMIT||null;
}
function base64url(bytes) {
  return Buffer.from(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes)).toString('base64url');
}
function validEventId(value) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(value||''));
}
function validToken(value) {
  return typeof value==='string'&&value.length>=16&&value.length<=512&&!/\s/.test(value);
}
function validEmail(value) {
  return typeof value==='string'&&value.length>=3&&value.length<=254&&/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}
function parseProtectedHeader(encoded) {
  try {return JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}
  catch {return null;}
}
function cacheKey(authBase,kid){return authBase+'|'+kid;}

async function publicKeyFor(authBase,kid,fetcher,now) {
  const cached=keyCache.get(cacheKey(authBase,kid));
  if(cached&&now-cached.at<JWKS_CACHE_MS)return cached.key;

  let response;
  try {
    response=await fetcher(authBase+'/.well-known/jwks.json',{signal:AbortSignal.timeout(5000)});
  } catch {
    fail(503,'JWKS_UNAVAILABLE');
  }
  if(!response.ok)fail(503,'JWKS_UNAVAILABLE');

  let jwks;
  try {jwks=await response.json();} catch {fail(503,'JWKS_UNAVAILABLE');}
  const rows=Array.isArray(jwks?.keys)?jwks.keys:[];
  for(const jwk of rows) {
    if(!jwk?.kid)continue;
    try {
      keyCache.set(cacheKey(authBase,jwk.kid),{at:now,key:createPublicKey({key:jwk,format:'jwk'})});
    } catch {}
  }
  const found=keyCache.get(cacheKey(authBase,kid));
  if(!found)fail(401,'UNKNOWN_SIGNING_KEY');
  return found.key;
}

export function clearAuthWebhookKeyCache(){keyCache.clear();}

export async function verifyAuthWebhook(rawBytes,headers,authBase,{fetcher=fetch,now=Date.now()}={}) {
  const signature=String(headers.get('x-neon-signature')||'');
  const kid=String(headers.get('x-neon-signature-kid')||'');
  const timestamp=String(headers.get('x-neon-timestamp')||'');
  const [protectedB64,emptyPayload,signatureB64]=signature.split('.');
  if(!protectedB64||emptyPayload!==''||!signatureB64||!kid||!/^\d{13}$/.test(timestamp))
    fail(401,'INVALID_SIGNATURE_ENVELOPE');

  const timestampMs=Number(timestamp),age=now-timestampMs;
  if(!Number.isFinite(timestampMs)||age>MAX_CLOCK_SKEW_MS||age<-MAX_FUTURE_SKEW_MS)
    fail(401,'STALE_SIGNATURE');

  const protectedHeader=parseProtectedHeader(protectedB64);
  if(protectedHeader?.alg!=='EdDSA'||protectedHeader?.kid!==kid)
    fail(401,'INVALID_SIGNATURE_ENVELOPE');

  const publicKey=await publicKeyFor(authBase,kid,fetcher,now);
  const payloadB64=base64url(rawBytes);
  const signaturePayloadB64=Buffer.from(timestamp+'.'+payloadB64,'utf8').toString('base64url');
  const signingInput=Buffer.from(protectedB64+'.'+signaturePayloadB64,'utf8');
  let valid=false;
  try {
    valid=verifySignature(null,signingInput,publicKey,Buffer.from(signatureB64,'base64url'));
  } catch {}
  if(!valid)fail(401,'INVALID_SIGNATURE');
  return true;
}

function resetLink(destination,token) {
  const url=new URL(destination);
  url.search='';
  url.hash='token='+encodeURIComponent(token);
  return url.toString();
}
function expirationCopy(value) {
  const time=Date.parse(String(value||''));
  if(!Number.isFinite(time))fail(400,'INVALID_RECOVERY_EVENT');
  return new Intl.DateTimeFormat('en-US',{
    dateStyle:'medium',timeStyle:'short',timeZone:'UTC'
  }).format(new Date(time))+' UTC';
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
}
export function recoveryEmail({mode,email,token,expiresAt,resetDestination}) {
  if(!validEmail(email)||!validToken(token))fail(400,'INVALID_RECOVERY_EVENT');
  const url=resetLink(resetDestination,token);
  const expires=expirationCopy(expiresAt);
  const subject=mode==='qa'?'Reset Your Password - Pack One QA':'Reset Your Password - Pack One';
  const safeUrl=escapeHtml(url),safeExpires=escapeHtml(expires);
  const html=`<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#171717">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:12px"><tr><td style="padding:32px">
<p style="margin:0 0 20px;font-size:14px;line-height:20px;font-weight:700">PACK ONE</p>
<h1 style="margin:0 0 16px;font-size:28px;line-height:34px">Reset your password</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:24px">Use the button below to choose a new Pack One password.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#171717" style="border-radius:8px"><a href="${safeUrl}" style="display:inline-block;padding:12px 20px;font-size:16px;line-height:22px;color:#ffffff;text-decoration:none;font-weight:700">Reset password</a></td></tr></table>
<p style="margin:24px 0 0;font-size:14px;line-height:21px">This reset link expires at ${safeExpires}.</p>
<p style="margin:12px 0 0;font-size:14px;line-height:21px;color:#555555">If you didn’t request a password reset, you can ignore this email. Your password will not change unless the reset link is used.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text=`Pack One\n\nReset your password\n\nUse this link to choose a new Pack One password:\n${url}\n\nThis reset link expires at ${expires}.\n\nIf you didn’t request a password reset, you can ignore this email. Your password will not change unless the reset link is used.`;
  return {from:FROM,to:[email],subject,html,text,url};
}

async function sendRecoveryEmail(message,eventId,apiKey,fetcher) {
  if(typeof apiKey!=='string'||apiKey.length<20)fail(503,'MAIL_NOT_CONFIGURED');
  let response;
  try {
    response=await fetcher('https://api.resend.com/emails',{
      method:'POST',
      headers:{
        authorization:'Bearer '+apiKey,
        'content-type':'application/json',
        'idempotency-key':'neon-auth/send.magic_link/'+eventId,
      },
      body:JSON.stringify({
        from:message.from,to:message.to,subject:message.subject,html:message.html,text:message.text,
      }),
      signal:AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
  } catch {
    fail(503,'MAIL_DELIVERY_FAILED');
  }
  if(!response.ok)fail(503,'MAIL_DELIVERY_FAILED');
  return true;
}

export async function handleAuthWebhook(request,env=process.env,{fetcher=fetch,now=Date.now()}={}) {
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/health'&&url.search==='?quick=1')
    return json({ok:true,service:'pack1-auth-hook',release_commit:releaseCommit()});
  if(url.pathname!=='/webhook')return json({error:'Not found.'},404);
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);

  const length=Number(request.headers.get('content-length')||0);
  if(Number.isFinite(length)&&length>MAX_BODY_BYTES)return json({error:'Request too large.'},413);
  const rawBytes=new Uint8Array(await request.arrayBuffer());
  if(rawBytes.byteLength>MAX_BODY_BYTES)return json({error:'Request too large.'},413);

  try {
    const config=accountRuntimeConfig(env);
    await verifyAuthWebhook(rawBytes,request.headers,config.authBase,{fetcher,now});

    if(request.headers.get('x-neon-event-type')!==EVENT_TYPE)fail(400,'UNEXPECTED_EVENT');
    let payload;
    try {payload=JSON.parse(new TextDecoder().decode(rawBytes));}
    catch {fail(400,'INVALID_JSON');}

    const eventId=String(payload?.event_id||'');
    if(payload?.event_type!==EVENT_TYPE||
      request.headers.get('x-neon-event-id')!==eventId||
      !validEventId(eventId)||
      payload?.event_data?.link_type!==LINK_TYPE||
      !validEmail(payload?.user?.email)||
      !validToken(payload?.event_data?.token))
      fail(400,'INVALID_RECOVERY_EVENT');

    const message=recoveryEmail({
      mode:config.mode,
      email:payload.user.email,
      token:payload.event_data.token,
      expiresAt:payload.event_data.expires_at,
      resetDestination:config.resetDestination,
    });
    await sendRecoveryEmail(message,eventId,env.PACK1_RESEND_API_KEY,fetcher);
    return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
  } catch(error) {
    const status=Number(error?.status||503);
    if(status>=500)console.error('Pack One recovery webhook failed:',String(error?.code||'UNAVAILABLE'));
    return json({error:status>=500?'Webhook delivery failed.':'Invalid webhook.'},status);
  }
}

export default {fetch(request){return handleAuthWebhook(request,process.env);}};
