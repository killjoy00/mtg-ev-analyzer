import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {nextReminderOccurrence,localReminderDay} from './daily-reminder-schedule.mjs';
import {deletionEmailForAuth} from './account-deletion-verification.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TOKEN=/^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,192}\]$/;
const TRIGGERS=new Set(['pack1-daily-reminders']);
// One reminder a day for everyone, sent by the pack1-daily-reminders trigger.
export const DAILY_REMINDER_CRON='5 23 * * *';
export const DAILY_REMINDER_SCHEDULE=Object.freeze({frequency:'daily',weekdays:Object.freeze([0,1,2,3,4,5,6]),localTime:'23:05',timeZone:'Etc/UTC'});
const MAX_TRIGGER_LATENESS_MS=3*60*60*1000;
const EMAIL_BATCH_SIZE=100;
const DISPATCH_BUDGET_MS=90000;
const MAX_DAILY_EMAIL_CANDIDATES=5000;
const UNSUBSCRIBE_URL='https://api.packone.pro/growth/v1/reminders/unsubscribe';
const REMINDER_EMAIL_FROM='Pack One <reminders@packone.pro>';
const apiError=(message,status=400)=>Object.assign(Error(message),{status,reminderSafe:true});
const yes=value=>value===true||value==='t'||value==='true'||value==='1'||value===1;
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const validId=value=>UUID.test(String(value||''));
function hmacKey(env=process.env) {
  const key=String(env.PACK1_RATE_LIMIT_SECRET||'');
  if(key.length<32)throw apiError('Reminder signing is not configured.',503);
  return key;
}
function emailFingerprint(email,env=process.env) {
  return createHmac('sha256',hmacKey(env)).update('pack1-reminder-email:'+String(email).trim().toLowerCase()).digest('hex');
}
function tokenKey(env=process.env) {
  const hex=String(env.PACK1_REMINDER_TOKEN_KEY||'');
  if(!/^[a-f0-9]{64}$/i.test(hex))throw apiError('Device notification registration is unavailable.',503);
  return Buffer.from(hex,'hex');
}
function protectToken(token,env=process.env) {
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',tokenKey(env),iv);
  const encrypted=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),encrypted].map(x=>x.toString('base64url')).join('.');
}
function openToken(value,env=process.env) {
  const parts=String(value).split('.');
  if(parts.length!==3)throw Error('Invalid push token record.');
  const [iv,tag,data]=parts.map(x=>Buffer.from(x,'base64url'));
  const decipher=createDecipheriv('aes-256-gcm',tokenKey(env),iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');
}
function legacyUnsubscribeToken(authId,nonce,env=process.env) {
  if(!validId(authId)||!validId(nonce))throw Error('Unsubscribe identity invalid.');
  const payload=authId+'.'+nonce;
  const signature=createHmac('sha256',hmacKey(env)).update('pack1-daily-unsubscribe:'+payload).digest('base64url');
  return Buffer.from(payload).toString('base64url')+'.'+signature;
}
const shortUnsubscribeMac=(nonce,env)=>createHmac('sha256',hmacKey(env)).update('pack1-daily-unsubscribe-v2:'+nonce).digest().subarray(0,12);
// 38 characters: the account's random unsubscribe nonce plus a 96-bit HMAC.
// The account is looked up from the nonce when the link is used.
function unsubscribeToken(nonce,env=process.env) {
  if(!validId(nonce))throw Error('Unsubscribe identity invalid.');
  const id=String(nonce).toLowerCase();
  return Buffer.concat([Buffer.from(id.replaceAll('-',''),'hex'),shortUnsubscribeMac(id,env)]).toString('base64url');
}
function verifyUnsubscribeToken(token,env=process.env) {
  const value=String(token||'');
  if(/^[A-Za-z0-9_-]{38}$/.test(value)) {
    const raw=Buffer.from(value,'base64url');
    const hex=raw.subarray(0,16).toString('hex');
    const nonce=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
    // Only the canonical spelling is accepted (the last character has unused bits).
    if(raw.length!==28||raw.toString('base64url')!==value||!validId(nonce)||!timingSafeEqual(raw.subarray(16),shortUnsubscribeMac(nonce,env)))
      throw apiError('Invalid unsubscribe link.',400);
    return {authId:null,nonce};
  }
  // Links in emails sent before October 20, 2026 carry the account ID as well.
  const [encoded,signature,...rest]=value.split('.');
  if(String(token||'').length>256||rest.length||!encoded||!/^[A-Za-z0-9_-]{43}$/.test(signature||''))throw apiError('Invalid unsubscribe link.',400);
  let payload;
  try {payload=Buffer.from(encoded,'base64url').toString('utf8');} catch {throw apiError('Invalid unsubscribe link.',400);}
  const [authId,nonce,...extra]=payload.split('.');
  if(extra.length||!validId(authId)||!validId(nonce))throw apiError('Invalid unsubscribe link.',400);
  const expected=legacyUnsubscribeToken(authId,nonce,env).split('.')[1];
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))throw apiError('Invalid unsubscribe link.',400);
  return {authId,nonce};
}
async function setting(query,authId) {
  const result=await query('SELECT * FROM daily_reminder_settings WHERE auth_user_id=$1::uuid',[authId]);
  return result.rows[0]||null;
}
// Independent operational switches. Neither enabling email nor missing native
// credentials can silently enable/block the other channel.
export function reminderDeliveryConfiguration(env=process.env) {
  const signing=String(env.PACK1_RATE_LIMIT_SECRET||'').length>=32;
  const emailKey=String(env.PACK1_REMINDER_RESEND_API_KEY||env.PACK1_ACCOUNT_DELETE_RESEND_API_KEY||'');
  const emailReady=signing&&emailKey.startsWith('re_')&&String(env.PACK1_REMINDER_RESEND_WEBHOOK_SECRET||'').startsWith('whsec_');
  const pushReady=/^[a-f0-9]{64}$/i.test(String(env.PACK1_REMINDER_TOKEN_KEY||''));
  return {
    email:{ready:emailReady,active:emailReady&&env.PACK1_REMINDER_EMAIL_ENABLED==='1'},
    push:{ready:pushReady,active:pushReady&&env.PACK1_REMINDER_PUSH_ENABLED==='1'},
  };
}
export function reminderReadiness(env=process.env) {
  const {email,push}=reminderDeliveryConfiguration(env);
  return {emailReady:email.ready,pushReady:push.ready,emailActive:email.active,pushActive:push.active};
}
const object=value=>typeof value==='string'?JSON.parse(value):value;
export const nextDailyReminderAt=(clock=Date.now())=>nextReminderOccurrence(DAILY_REMINDER_SCHEDULE,Number(clock)).dueAt;
const errors={
  REMINDER_INVALID_SCHEDULE:['Choose a valid reminder schedule.',400],
  REMINDER_EMAIL_UNVERIFIED:['Verify your account email before enabling email reminders.',403],
  REMINDER_EMAIL_SUPPRESSED:['Email is suppressed after a bounce or complaint. Contact support.',409],
  REMINDER_DEVICE_REQUIRED:['Enable notifications on this device first.',409],
  ACCOUNT_DELETING:['This account is being deleted.',409],
  SESSION_EXPIRED:['Sign in again to manage device notifications.',401],
  DEVICE_PROOF_REQUIRED:['Device registration could not be verified. Disable notifications on the original installation first.',409],
  DEVICE_VERSION_CHANGED:['Device registration changed. Reload notification settings before trying again.',409],
  DEVICE_STILL_ATTACHED:['This device is still attached to another account. Sign out of that account first.',409],
  DEVICE_LIMIT:['You can register up to five devices. Disable an old device first.',409],
};
// The SQL adapter may retain this fixed domain code without retaining a
// provider error body. Keep its allowlist tied to the existing UI contract.
export function reminderDatabaseReason(message) {
  return typeof message==='string'&&Object.hasOwn(errors,message)?message:null;
}
function domainError(code) {
  const [message,status]=errors[code]||['Reminder settings are temporarily unavailable.',503];
  return Object.assign(apiError(message,status),{code});
}
async function store(query,sql,params) {
  try {return await query(sql,params);} catch(error) {
    for(const code of Object.keys(errors))if(String(error?.message).includes(code))throw domainError(code);
    throw error;
  }
}
function sessionAuth(auth) {
  if(!validId(auth?.user_id)||auth?.source!=='mobile'||!/^[a-f0-9]{64}$/.test(String(auth.session_hash||'')))
    throw apiError('Native account session required.',401);
}
export async function reminderSnapshot(query,authId,{env=process.env,clock=Date.now()}={}) {
  if(!validId(authId))throw apiError('Account session required.',401);
  const [row,email,recent,devices]=await Promise.all([setting(query,authId),deletionEmailForAuth(query,authId),
    query('SELECT DISTINCT ON (channel) channel,state,accepted_at,delivered_at,push_receipt_result FROM daily_reminder_deliveries WHERE auth_user_id=$1::uuid ORDER BY channel,created_at DESC LIMIT 2',[authId]),
    query('SELECT count(*)::int count FROM daily_reminder_devices d JOIN account_sessions a ON a.session_hash=d.session_hash AND a.auth_user_id=d.auth_user_id WHERE d.auth_user_id=$1::uuid AND d.revoked_at IS NULL AND a.revoked_at IS NULL AND a.expires_at>now()',[authId])]);
  const fingerprint=email?emailFingerprint(email,env):null;
  const blocked=fingerprint?await query('SELECT 1 FROM daily_reminder_email_suppressions WHERE auth_user_id=$1::uuid AND destination_hash=$2',[authId,fingerprint]):{rows:[]};
  const status=Object.fromEntries(recent.rows.map(item=>[item.channel,{
    state:item.state,acceptedAt:item.accepted_at||null,deliveredAt:item.delivered_at||null,platformReceipt:item.push_receipt_result||null,
  }]));
  const active=reminderDeliveryConfiguration(env);
  return {
    schedule:{...DAILY_REMINDER_SCHEDULE,weekdays:[...DAILY_REMINDER_SCHEDULE.weekdays]},
    email:{enabled:yes(row?.email_enabled),eligible:Boolean(email),suppressed:Boolean(blocked.rows.length||fingerprint&&row?.suppressed_email_hash===fingerprint),
      addressChanged:Boolean(yes(row?.email_enabled)&&fingerprint!==row?.email_destination_hash),
      consentedAt:row?.email_consented_at||null,deliveredAt:row?.last_email_delivered_at||null,lastAttempt:status.email||null,deliveryActive:active.email.active},
    push:{enabled:yes(row?.push_enabled),consentedAt:row?.push_consented_at||null,providerAcceptedAt:row?.last_push_accepted_at||null,
      lastAttempt:status.push||null,registeredDevices:Number(devices.rows[0]?.count||0),deliveryActive:active.push.active},
    nextAt:yes(row?.email_enabled)||yes(row?.push_enabled)?nextDailyReminderAt(clock):null,deliveryActive:active.email.active||active.push.active,
  };
}
export async function updateReminderSettings(query,auth,payload,{env=process.env,clock=Date.now()}={}) {
  if(!validId(auth?.user_id))throw apiError('Account session required.',401);
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||!['email','push'].includes(payload.channel)||typeof payload.enabled!=='boolean')
    throw apiError('Choose a reminder channel and explicit enabled state.');
  const allowed=new Set(['channel','enabled','frequency','weekdays','localTime','timeZone','expectedAccountId']);
  if(payload.expectedAccountId!==undefined&&payload.expectedAccountId!==auth.user_id)throw apiError('Account changed. Reload reminder settings.',409);
  if(Object.keys(payload).some(key=>!allowed.has(key)))throw apiError('Unexpected reminder settings field.');
  // Everyone shares the once-daily send; any client schedule fields are ignored.
  const config=DAILY_REMINDER_SCHEDULE;
  const email=payload.enabled&&payload.channel==='email'?await deletionEmailForAuth(query,auth.user_id):null;
  if(payload.enabled&&payload.channel==='email'&&!email)throw domainError('REMINDER_EMAIL_UNVERIFIED');
  const next=nextReminderOccurrence(config,Number(clock));
  const saved=await store(query,'SELECT * FROM pack1_reminder_save_settings($1::uuid,$2::text,$3::integer[],$4::text,$5::text,$6::text,$7::boolean,$8::timestamptz,$9::text,$10::text)',
    [auth.user_id,config.frequency,'{'+config.weekdays.join(',')+'}',config.localTime,config.timeZone,payload.channel,String(payload.enabled),next.dueAt,email?emailFingerprint(email,env):null,email]);
  if(!saved.rows.length)throw domainError('ACCOUNT_DELETING');
  return reminderSnapshot(query,auth.user_id,{env,clock});
}
export async function registerReminderDevice(query,auth,payload,{env=process.env}={}) {
  sessionAuth(auth);
  if(!payload||!validId(payload.installationId)||!TOKEN.test(String(payload.token||''))||!['ios','android'].includes(payload.platform))
    throw apiError('Invalid notification device registration.');
  if(payload.bindingSecret!==undefined&&!/^[A-Za-z0-9_-]{43}$/.test(String(payload.bindingSecret)))throw apiError('Invalid device proof.');
  if(payload.registrationVersion!==undefined&&(!Number.isSafeInteger(payload.registrationVersion)||payload.registrationVersion<1))throw apiError('Invalid device version.');
  const candidate=randomBytes(32).toString('base64url');
  const result=await store(query,'SELECT pack1_reminder_register_device($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::bigint,$10::boolean) result',
    [payload.installationId,auth.user_id,auth.session_hash,payload.platform,hash(payload.token),protectToken(payload.token,env),hash(candidate),payload.bindingSecret?hash(payload.bindingSecret):null,payload.registrationVersion??null,String(payload.explicitEnable===true)]);
  const value=object(result.rows[0]?.result);
  if(value?.error)throw domainError(value.error);
  if(!value?.ok)throw apiError('Device registration is temporarily unavailable.',503);
  return {ok:true,registrationVersion:Number(value.registrationVersion),...(value.secretCreated?{bindingSecret:candidate}:{})};
}
export async function unregisterReminderDevice(query,auth,payload) {
  sessionAuth(auth);
  if(!validId(payload?.installationId))throw apiError('Invalid device registration.');
  const result=await query('SELECT pack1_reminder_unregister_device($1::uuid,$2::uuid) result',[auth.user_id,payload.installationId]);
  return object(result.rows[0]?.result)||{ok:true};
}
export async function revokeReminderSessionDevices(query,auth) {
  if(!auth?.session_hash||!validId(auth.user_id))return;
  // Uses the same account lock as dispatch and deletion, without moving the
  // unrelated session-revocation or credential lifecycle into this module.
  await query('SELECT pack1_reminder_revoke_session($1::uuid,$2::text)',[auth.user_id,auth.session_hash]);
}
export async function reconcileReminderEvents(query,{providerId=null,limit=50}={}) {
  const pending=await query("SELECT event_id FROM daily_reminder_provider_events WHERE state='pending' AND ($1::text IS NULL OR provider_id=$1) ORDER BY created_at LIMIT $2::int",[providerId,Math.min(100,Math.max(1,Number(limit)||50))]);
  let applied=0;
  for(const event of pending.rows) {
    const result=await query('SELECT pack1_reminder_apply_event($1::text) applied',[event.event_id]);
    if(yes(result.rows[0]?.applied))applied++;
  }
  return {applied};
}
const timeoutSignal=()=>AbortSignal.timeout(10000);
async function finishSending(query,id,state,reason,nextRetryAt=null) {
  // Never overwrite an authenticated event that already advanced the row.
  await query("UPDATE daily_reminder_deliveries SET state=$2,failure_reason=$3,next_retry_at=$4::timestamptz,updated_at=now() WHERE id=$1::uuid AND state='sending'",[id,state,reason,nextRetryAt]);
}
// Push sends are per device and claimed one at a time; email uses daily batches below.
async function deliverOne(query,id,{env,fetcher,clock,pacificDay,active}={}) {
  const result=await query('SELECT d.*,v.token_ciphertext FROM daily_reminder_deliveries d LEFT JOIN daily_reminder_devices v ON v.installation_id=d.installation_id WHERE d.id=$1::uuid',[id]);
  const row=result.rows[0];
  if(!row||row.channel!=='push'||!['queued','retry'].includes(row.state))return 'not_claimed';
  if(!active.push.active)return 'inactive';
  // An obsolete registration is rejected in the atomic admission function.
  // Never attempt to decrypt a deliberately erased revoked token.
  let token='';
  if(row.token_ciphertext)try {token=openToken(row.token_ciphertext,env);} catch {
    await query("UPDATE daily_reminder_deliveries SET state='failed',failure_reason='device_configuration',updated_at=now() WHERE id=$1::uuid AND state IN ('queued','retry')",[id]);
    return 'failed';
  }
  const body={to:token,title:'Your Pack One Dailies are ready',body:'Three fresh Daily challenges are waiting.',
    data:{screen:'daily',owner:row.auth_user_id,registrationVersion:Number(row.device_version)},channelId:'daily-reminders',ttl:60};
  const headers={'content-type':'application/json',accept:'application/json',
    ...(env.PACK1_EXPO_PUSH_ACCESS_TOKEN?{authorization:'Bearer '+env.PACK1_EXPO_PUSH_ACCESS_TOKEN}:{})};
  const serialized=JSON.stringify(body);
  // This is the final database operation before dispatch. The function locks
  // with consent/deletion/device mutations and rechecks ownership, version,
  // the current Pacific game and daily admission.
  const claimed=object((await query('SELECT pack1_reminder_claim($1::uuid,$2::text,$3::text,$4::text,$5::date,$6::boolean,$7::boolean) result',
    [id,null,null,hash(serialized),pacificDay,'false',String(active.push.active)])).rows[0]?.result);
  if(claimed?.result!=='claimed')return claimed?.result||'not_claimed';
  try {
    const response=await fetcher('https://exp.host/--/api/v2/push/send',{method:'POST',headers,body:serialized,redirect:'error',signal:timeoutSignal()});
    if(response.status===429) {
      const retrySeconds=Math.min(900,Math.max(30,Number(response.headers.get('retry-after'))||300));
      const next=new Date(Number(clock)+retrySeconds*1000).toISOString();
      await finishSending(query,id,Number(claimed.attempts)<3?'retry':'failed','provider_rate_limit',next);
      return 'retry';
    }
    if(!response.ok) {
      const permanent=response.status>=400&&response.status<500;
      // 5xx/transport ambiguity can mean the provider accepted the message.
      await finishSending(query,id,permanent?'failed':'uncertain',permanent?'provider_rejected':'provider_ambiguous');
      return permanent?'failed':'uncertain';
    }
    const value=await response.json();
    const ticket=Array.isArray(value.data)?value.data[0]:value.data;
    if(ticket?.status==='error') {
      if(ticket.details?.error==='DeviceNotRegistered')await revokeInvalidDeliveryDevice(query,row);
      await finishSending(query,id,'failed','push_rejected');
      return 'failed';
    }
    const providerId=ticket?.id;
    if(typeof providerId!=='string'||!providerId||providerId.length>200)throw Error('Provider response could not be confirmed.');
    await query('SELECT pack1_reminder_provider_accepted($1::uuid,$2::text)',[id,providerId]);
    return 'accepted';
  }catch {
    await finishSending(query,id,'uncertain','provider_ambiguous');
    return 'uncertain';
  }
}
async function revokeInvalidDeliveryDevice(query,row) {
  // An old receipt must never revoke a rotated token or another account's
  // registration. All three captured dispatch fields must still match.
  await query("UPDATE daily_reminder_devices SET revoked_at=now(),token_ciphertext='',registration_version=registration_version+1,updated_at=now() WHERE installation_id=$1::uuid AND auth_user_id=$2::uuid AND registration_version=$3::bigint AND session_hash=$4::text AND token_hash::text=$5::text AND revoked_at IS NULL",
    [row.installation_id,row.auth_user_id,row.device_version,row.device_session_hash,row.device_token_hash]);
}
export async function refreshPushReceipts(query,{env=process.env,fetcher=fetch}={}) {
  const pending=await query("SELECT id,provider_id,auth_user_id,installation_id,device_version,device_session_hash,device_token_hash FROM daily_reminder_deliveries WHERE channel='push' AND state='accepted' AND push_receipt_checked_at IS NULL AND accepted_at<now()-interval '15 minutes' AND accepted_at>now()-interval '2 hours' ORDER BY accepted_at LIMIT 50");
  let checked=0,invalidated=0;
  if(pending.rows.length) {
    try {
      const response=await fetcher('https://exp.host/--/api/v2/push/getReceipts',{method:'POST',
        headers:{'content-type':'application/json',...(env.PACK1_EXPO_PUSH_ACCESS_TOKEN?{authorization:'Bearer '+env.PACK1_EXPO_PUSH_ACCESS_TOKEN}:{})},
        body:JSON.stringify({ids:pending.rows.map(row=>row.provider_id)}),redirect:'error',signal:timeoutSignal()});
      const payload=response.ok?await response.json():{};
      for(const row of pending.rows) {
        const receipt=payload?.data?.[row.provider_id];
        if(!receipt||!['ok','error'].includes(receipt.status))continue;
        const invalid=receipt.details?.error==='DeviceNotRegistered';
        const result=await query("UPDATE daily_reminder_deliveries SET push_receipt_checked_at=now(),push_receipt_result=$2,updated_at=now() WHERE id=$1::uuid AND state='accepted' AND push_receipt_checked_at IS NULL RETURNING id",
          [row.id,receipt.status==='ok'?'platform_accepted':invalid?'invalid_token':'provider_rejected']);
        if(!result.rows.length)continue;
        checked++;
        if(invalid){await revokeInvalidDeliveryDevice(query,row);invalidated++;}
      }
    }catch { /* No send retries are inferred from unavailable receipt reads. */ }
  }
  await query("UPDATE daily_reminder_deliveries SET push_receipt_checked_at=now(),push_receipt_result='receipt_expired',updated_at=now() WHERE id IN (SELECT id FROM daily_reminder_deliveries WHERE channel='push' AND state='accepted' AND push_receipt_checked_at IS NULL AND accepted_at<=now()-interval '2 hours' LIMIT 100)");
  return {checked,invalidated};
}
const PLAY_URL='https://packone.pro/';
const MANAGE_URL='https://packone.pro/?account=reminders';
const htmlText=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
// Layout follows the account emails in edge/auth-webhook.mjs. The logo is the app
// icon; if images are blocked, its navy cell and alt text still read as the mark.
const MARK_FONT="'Barlow Condensed','Arial Narrow',Arial,Helvetica,sans-serif;";
const LOGO_URL='https://packone.pro/pack-one-icon-v1.png';
function dailyEmailHtml(unsubscribe) {
  const font='font-family:Arial,Helvetica,sans-serif;';
  const footerLink=(href,label)=>'<a href="'+htmlText(href)+'" style="'+font+'font-size:13px;line-height:20px;color:#555555;text-decoration:underline;">'+label+'</a>';
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"></head>'+
    '<body style="margin:0;padding:0;background-color:#f5f5f5;">'+
    '<div style="display:none;max-height:0;overflow:hidden;">Three new Dailies, eight picks each. Play before midnight Pacific.</div>'+
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"><tr><td align="center" style="padding-top:32px;padding-right:16px;padding-bottom:32px;padding-left:16px;background-color:#f5f5f5;">'+
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:600px;background-color:#ffffff;">'+
    '<tr><td style="padding-top:32px;padding-right:32px;padding-bottom:16px;padding-left:32px;"><table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr>'+
    '<td width="40" height="40" align="center" valign="middle" bgcolor="#1e4d7a" style="width:40px;height:40px;background-color:#1e4d7a;">'+
    '<img src="'+LOGO_URL+'" width="40" height="40" alt="P¹" style="display:block;width:40px;height:40px;border:0;outline:none;text-decoration:none;'+font+'font-size:16px;font-weight:700;line-height:40px;color:#ffffff;text-align:center;"></td>'+
    '<td style="padding-left:11px;font-family:'+MARK_FONT+'font-size:20px;line-height:22px;color:#171918;font-weight:700;">Pack One</td></tr></table></td></tr>'+
    '<tr><td style="padding-top:0;padding-right:32px;padding-bottom:16px;padding-left:32px;'+font+'font-size:18px;line-height:28px;color:#111111;font-weight:700;">Today’s Dailies are waiting</td></tr>'+
    '<tr><td style="padding-top:0;padding-right:32px;padding-bottom:24px;padding-left:32px;'+font+'font-size:16px;line-height:24px;color:#333333;">Your three Pack One Dailies are ready. They close at midnight Pacific.</td></tr>'+
    '<tr><td align="center" style="padding-top:0;padding-right:32px;padding-bottom:32px;padding-left:32px;"><table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr><td bgcolor="#111111" style="background-color:#111111;">'+
    '<a href="'+PLAY_URL+'" style="display:inline-block;padding-top:14px;padding-right:24px;padding-bottom:14px;padding-left:24px;'+font+'font-size:16px;line-height:20px;color:#ffffff;text-decoration:none;font-weight:700;">Play today’s Dailies</a></td></tr></table></td></tr>'+
    '<tr><td style="padding-top:20px;padding-right:32px;padding-bottom:12px;padding-left:32px;border-top:1px solid #e5e5e5;'+font+'font-size:13px;line-height:20px;color:#777777;">You get this because you turned on Daily email reminders. It comes once a day and is skipped on days you’ve finished all three Dailies.</td></tr>'+
    '<tr><td style="padding-top:0;padding-right:32px;padding-bottom:32px;padding-left:32px;'+font+'font-size:13px;line-height:20px;color:#777777;">'+footerLink(MANAGE_URL,'Manage reminders')+' &nbsp;·&nbsp; '+footerLink(unsubscribe,'Unsubscribe')+'</td></tr>'+
    '</table></td></tr></table></body></html>';
}
function dailyEmail(id,email,nonce,env) {
  const unsubscribe=UNSUBSCRIBE_URL+'?token='+unsubscribeToken(nonce,env);
  return {from:REMINDER_EMAIL_FROM,to:[email],subject:'Today\'s Pack One Dailies are waiting',
    text:['Today\'s three Pack One Dailies are waiting. They close at midnight Pacific.','',
      'Play now: '+PLAY_URL,'','',
      'You get this because you turned on Daily email reminders. It comes once a day and is skipped on days you have finished all three Dailies.','',
      'Manage reminders: '+MANAGE_URL,'',
      'Unsubscribe: '+unsubscribe].join('\n'),
    html:dailyEmailHtml(unsubscribe),
    headers:{'List-Unsubscribe':'<'+unsubscribe+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'},
    tags:[{name:'pack1_reminder',value:id}]};
}
async function markEmails(query,ids,state,reason) {
  // Never overwrite a row that an authenticated provider event already advanced.
  await query("UPDATE daily_reminder_deliveries SET state=$2,failure_reason=$3,updated_at=now() WHERE id=ANY($1::uuid[]) AND state='sending'",[ids,state,reason]);
}
async function sendEmailBatch(query,admitted,{env,fetcher,pacificDay,pause,metrics}) {
  const ids=admitted.map(item=>item.id);
  const body=JSON.stringify(admitted.map(item=>item.message));
  const headers={authorization:'Bearer '+String(env.PACK1_REMINDER_RESEND_API_KEY||env.PACK1_ACCOUNT_DELETE_RESEND_API_KEY),
    'content-type':'application/json','Idempotency-Key':'pack1-daily-'+pacificDay+'-'+hash(ids.join(',')).slice(0,40)};
  for(let attempt=0;attempt<2;attempt++) {
    let response;
    try {response=await fetcher('https://api.resend.com/emails/batch',{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(20000)});}
    catch {await markEmails(query,ids,'uncertain','provider_ambiguous');metrics.uncertain+=ids.length;return;}
    if(response.status===429&&attempt===0) {
      await pause(Math.min(30,Math.max(1,Number(response.headers.get('retry-after'))||5))*1000);
      continue;
    }
    if(!response.ok) {
      // 5xx can mean the provider accepted the batch; never resend it blindly.
      const permanent=response.status>=400&&response.status<500;
      await markEmails(query,ids,permanent?'failed':'uncertain',response.status===429?'provider_rate_limit':permanent?'provider_rejected':'provider_ambiguous');
      metrics[permanent?'failed':'uncertain']+=ids.length;
      return;
    }
    const data=await response.json().then(value=>value?.data).catch(()=>null);
    if(!Array.isArray(data)||data.length!==ids.length) {
      await markEmails(query,ids,'uncertain','provider_unconfirmed');metrics.uncertain+=ids.length;return;
    }
    for(let i=0;i<ids.length;i++) {
      const providerId=data[i]?.id;
      if(typeof providerId==='string'&&providerId&&providerId.length<=200) {
        // The provider took it; a failed write here must not stop later batches.
        try {await query('SELECT pack1_reminder_provider_accepted($1::uuid,$2::text)',[ids[i],providerId]);metrics.accepted++;}
        catch {await markEmails(query,[ids[i]],'uncertain','provider_ambiguous');metrics.uncertain++;}
      } else {
        await markEmails(query,[ids[i]],'uncertain','provider_unconfirmed');metrics.uncertain++;
      }
    }
    return;
  }
}
async function sendDailyEmails(query,{env,fetcher,pacificDay,pause,began,metrics}) {
  const candidates=await query(`SELECT s.auth_user_id,s.email_destination_hash,s.unsubscribe_nonce,u.email
    FROM daily_reminder_settings s JOIN neon_auth."user" u ON u.id=s.auth_user_id
    WHERE s.email_enabled AND u."emailVerified" IS TRUE
      AND NOT EXISTS(SELECT 1 FROM daily_reminder_deliveries d WHERE d.auth_user_id=s.auth_user_id AND d.channel='email' AND d.game_day=$1::date)
    ORDER BY s.auth_user_id LIMIT $2::int`,[pacificDay,MAX_DAILY_EMAIL_CANDIDATES]);
  metrics.candidates=candidates.rows.length;
  for(let start=0;start<candidates.rows.length;start+=EMAIL_BATCH_SIZE) {
    if(Date.now()-began>DISPATCH_BUDGET_MS){metrics.deferred+=candidates.rows.length-start;break;}
    const admitted=[];
    for(const row of candidates.rows.slice(start,start+EMAIL_BATCH_SIZE)) {
      const email=String(row.email||'').trim();
      const destination=email?emailFingerprint(email,env):null;
      // Consent belongs to the address it was given for; a changed address needs a fresh opt-in.
      if(!destination||destination!==row.email_destination_hash){metrics.skipped++;continue;}
      const id=(await query('SELECT pack1_reminder_admit_daily_email($1::uuid,$2::text,$3::date) id',[row.auth_user_id,destination,pacificDay])).rows[0]?.id;
      if(!id){metrics.skipped++;continue;}
      admitted.push({id,message:dailyEmail(id,email,row.unsubscribe_nonce,env)});
    }
    if(!admitted.length)continue;
    metrics.admitted+=admitted.length;
    await sendEmailBatch(query,admitted,{env,fetcher,pacificDay,pause,metrics});
    await pause(600);
  }
}
async function sendDuePush(query,{env,fetcher,clock,pacificDay,pause,began,active,metrics}) {
  const due=await query('SELECT * FROM daily_reminder_settings WHERE push_enabled AND next_due_at<=now() ORDER BY next_due_at LIMIT 100');
  for(const row of due.rows) {
    const next=nextReminderOccurrence(DAILY_REMINDER_SCHEDULE,Math.max(Number(clock),Date.parse(row.next_due_at)));
    await query('SELECT pack1_reminder_enqueue($1::uuid,$2::bigint,$3::timestamptz,$4::timestamptz,$5::date,$6::boolean,$7::boolean) id',
      [row.auth_user_id,row.schedule_version,row.next_due_at,next.dueAt,localReminderDay(row.next_due_at,DAILY_REMINDER_SCHEDULE),'false','true']);
    if(Date.now()-began>DISPATCH_BUDGET_MS)break;
  }
  const queued=await query("SELECT id FROM daily_reminder_deliveries WHERE channel='push' AND state IN ('queued','retry') AND due_at<=now() AND due_at>=now()-interval '20 minutes' AND (next_retry_at IS NULL OR next_retry_at<=now()) ORDER BY due_at,id LIMIT 200");
  for(const row of queued.rows) {
    if(Date.now()-began>DISPATCH_BUDGET_MS)break;
    const outcome=await deliverOne(query,row.id,{env,fetcher,clock:Date.now(),pacificDay,active});
    if(typeof metrics[outcome]==='number')metrics[outcome]++;
    if(outcome==='rate_limited')break;
    if(['accepted','uncertain','retry','failed'].includes(outcome))await pause(60);
  }
}
// The once-daily job: housekeeping, then one email per opted-in account for today's
// Pacific Daily. Push runs only when its channel is switched on.
export async function dispatchDailyReminders(query,{env=process.env,clock=Date.now(),fetcher=fetch,pacificDay,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const active=reminderDeliveryConfiguration(env);
  if(!pacificDay||!/^\d{4}-\d{2}-\d{2}$/.test(pacificDay))throw Error('Pacific day is required.');
  // Event reconciliation and cleanup run even when sending is off; late bounces still apply.
  await reconcileReminderEvents(query);
  await refreshPushReceipts(query,{env,fetcher});
  await query("UPDATE daily_reminder_deliveries SET state='uncertain',failure_reason='abandoned_send',updated_at=now() WHERE id IN (SELECT id FROM daily_reminder_deliveries WHERE state='sending' AND last_attempt_at<now()-interval '2 minutes' LIMIT 500)");
  await query("UPDATE daily_reminder_deliveries SET state='suppressed',failure_reason='expired',updated_at=now() WHERE id IN (SELECT id FROM daily_reminder_deliveries WHERE state IN ('queued','retry') AND due_at<now()-interval '20 minutes' LIMIT 500)");
  await query("DELETE FROM daily_reminder_provider_events WHERE event_id IN (SELECT event_id FROM daily_reminder_provider_events WHERE created_at<now()-interval '7 days' LIMIT 500)");
  await query("DELETE FROM daily_reminder_deliveries WHERE id IN (SELECT id FROM daily_reminder_deliveries WHERE created_at<now()-interval '90 days' AND state NOT IN ('queued','retry','sending') LIMIT 500)");
  await query("DELETE FROM daily_reminder_rate_limits WHERE bucket<now()-interval '1 hour'");
  await query("DELETE FROM daily_reminder_changes WHERE id IN (SELECT id FROM daily_reminder_changes WHERE created_at<now()-interval '365 days' LIMIT 500)");
  await query("DELETE FROM daily_reminder_devices WHERE installation_id IN (SELECT installation_id FROM daily_reminder_devices WHERE revoked_at<now()-interval '30 days' AND updated_at<now()-interval '30 days' LIMIT 100)");
  const metrics={active:active.email.active||active.push.active,
    email:{candidates:0,admitted:0,accepted:0,uncertain:0,failed:0,skipped:0,deferred:0},
    push:{accepted:0,uncertain:0,retry:0,failed:0,suppressed:0}};
  if(!metrics.active)return metrics;
  const began=Date.now();
  if(active.email.active)await sendDailyEmails(query,{env,fetcher,pacificDay,pause,began,metrics:metrics.email});
  if(active.push.active)await sendDuePush(query,{env,fetcher,clock,pacificDay,pause,began,active,metrics:metrics.push});
  await reconcileReminderEvents(query);
  return metrics;
}
const UNSUB_HEADERS={'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const unsubscribePage=(title,body)=>'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title>'+
  '<body style="margin:0;background:#f5f5f5;font:16px/1.5 Arial,Helvetica,sans-serif;color:#333"><main style="max-width:30rem;margin:3rem auto;padding:2rem;background:#fff">'+
  '<p style="margin:0 0 1.5rem;font-weight:700;color:#171918"><span style="display:inline-block;width:36px;height:40px;margin-right:11px;border-radius:2px;background:#1e4d7a;color:#fff;font:600 24px/40px '+MARK_FONT+'text-align:center;vertical-align:middle">P<sup style="font:900 11px/0 Arial,Helvetica,sans-serif;vertical-align:9px">1</sup></span>Pack One</p>'+
  body+'</main></body></html>';
async function unsubscribeRequest(request,query,env) {
  if(!['GET','POST'].includes(request.method))throw apiError('Not found.',404);
  const verified=verifyUnsubscribeToken(new URL(request.url).searchParams.get('token'),env);
  if(request.method==='GET')return new Response(unsubscribePage('Pack One reminders','<h1 style="margin:0 0 .5rem;font-size:20px;color:#111">Stop Daily email reminders?</h1><p style="margin:0 0 1.5rem">You can turn them back on anytime in My Pack One.</p><form method="POST"><button type="submit" style="padding:12px 22px;border:0;background:#111;color:#fff;font:700 16px Arial,Helvetica,sans-serif;cursor:pointer">Unsubscribe</button></form>'),{headers:UNSUB_HEADERS});
  let authId=verified.authId;
  if(!authId) {
    const owners=(await query('SELECT auth_user_id FROM daily_reminder_settings WHERE unsubscribe_nonce=$1::uuid LIMIT 2',[verified.nonce])).rows;
    authId=owners.length===1?owners[0].auth_user_id:null;
  }
  // A deleted account has no settings row; the link stays a harmless success.
  if(authId)await query('SELECT pack1_reminder_unsubscribe($1::uuid,$2::uuid)',[authId,verified.nonce]);
  return new Response(unsubscribePage('Unsubscribed','<h1 style="margin:0 0 .5rem;font-size:20px;color:#111">Email reminders are off</h1><p style="margin:0 0 1.5rem">You won’t get Daily reminder emails anymore.</p><a href="https://packone.pro/" style="color:#111;font-weight:700">Back to Pack One</a>'),{headers:UNSUB_HEADERS});
}
export function verifyReminderWebhook(request,raw,env=process.env,clock=Date.now()) {
  const secret=String(env.PACK1_REMINDER_RESEND_WEBHOOK_SECRET||'');
  const id=request.headers.get('svix-id')||'',timestamp=request.headers.get('svix-timestamp')||'',signatures=request.headers.get('svix-signature')||'';
  if(!secret.startsWith('whsec_')||!id||id.length>200||!/^[A-Za-z0-9_-]+$/.test(id)||!/^[0-9]{10}$/.test(timestamp)||Math.abs(Number(clock)-Number(timestamp)*1000)>300000||signatures.length>2048)
    throw apiError('Webhook verification failed.',403);
  const expected=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(id+'.'+timestamp+'.'+raw).digest();
  if(!signatures.split(' ').some(part=>{if(!part.startsWith('v1,'))return false;const supplied=Buffer.from(part.slice(3),'base64');return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}))
    throw apiError('Webhook verification failed.',403);
}
async function boundedRawBody(request,limit=32768) {
  if(Number(request.headers.get('content-length'))>limit)throw apiError('Payload too large.',413);
  const reader=request.body?.getReader();if(!reader)return '';
  const chunks=[];let size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw apiError('Payload too large.',413);}chunks.push(value);}}
  finally {reader.releaseLock();}
  return Buffer.concat(chunks).toString('utf8');
}
async function providerEvent(request,query,env) {
  const raw=await boundedRawBody(request);
  verifyReminderWebhook(request,raw,env);
  let event;try {event=JSON.parse(raw);} catch {throw apiError('Invalid provider event.');}
  const types=new Set(['email.sent','email.delivered','email.bounced','email.complained']);
  if(!types.has(event?.type))return {ok:true,ignored:true};
  const providerId=event?.data?.email_id,eventAt=Date.parse(event?.created_at);
  if(typeof providerId!=='string'||!providerId||providerId.length>200||!Number.isFinite(eventAt)||eventAt>Date.now()+300000)
    throw apiError('Invalid provider event.');
  const tags=event?.data?.tags;
  const hinted=Array.isArray(tags)?tags.find(item=>item?.name==='pack1_reminder')?.value:tags?.pack1_reminder;
  if(hinted!==undefined&&!validId(hinted))throw apiError('Invalid reminder event identity.');
  const recipients=event?.data?.to;
  if(recipients!==undefined&&(!Array.isArray(recipients)||recipients.length!==1||typeof recipients[0]!=='string'||recipients[0].length>320))
    throw apiError('Invalid reminder event destination.');
  // Validate the entire event shape before making *any* database query. This
  // preserves the malformed-destination rejection even when an unrelated
  // provider event is correctly ignored.
  // Provider webhooks are account-wide: unrelated verification, recovery and
  // account-deletion messages must not be retained as reminder event records.
  // Our reminder sender always tags its email with the immutable delivery ID.
  // For older untagged events, retain only a delivery we can already identify.
  if(hinted===undefined) {
    const known=await query("SELECT 1 FROM daily_reminder_deliveries WHERE channel='email' AND provider_id=$1::text LIMIT 1",[providerId]);
    if(!known.rows.length)return {ok:true,ignored:true};
  }
  const eventId=request.headers.get('svix-id'),digest=hash(raw);
  // Store only minimal provider metadata and an HMAC of the actual recipient.
  // Address and raw webhook payload never enter tables or public diagnostics.
  await query('INSERT INTO daily_reminder_provider_events(event_id,provider_id,delivery_hint,event_type,event_at,destination_hash,payload_hash) VALUES($1,$2,$3::uuid,$4,$5::timestamptz,$6,$7) ON CONFLICT(event_id) DO NOTHING',
    [eventId,providerId,hinted||null,event.type,new Date(eventAt).toISOString(),recipients?emailFingerprint(recipients[0],env):null,digest]);
  const existing=(await query('SELECT payload_hash FROM daily_reminder_provider_events WHERE event_id=$1',[eventId])).rows[0];
  if(existing&&existing.payload_hash!==digest)throw apiError('Conflicting provider event identity.',409);
  await query('SELECT pack1_reminder_apply_event($1::text)',[eventId]);
  return {ok:true};
}
export async function reminderRoute(request,{query,json,readJson,authBrowser,authMutation,authMobile,trigger,pacificDay,env=process.env}={}) {
  const path=new URL(request.url).pathname,method=request.method;
  if(path==='/internal/daily-reminders') {
    if(method!=='POST')throw apiError('Not found.',404);
    const body=await readJson(request),checked=trigger(request,body,{names:TRIGGERS});
    if(!checked)throw apiError('Neon scheduler identity required.',403);
    if(Math.abs(Date.now()-Date.parse(checked.scheduledAt))>MAX_TRIGGER_LATENESS_MS)return json({ok:true,stale:true});
    return json(await dispatchDailyReminders(query,{env,pacificDay}));
  }
  if(path==='/v1/reminders/unsubscribe')return unsubscribeRequest(request,query,env);
  if(path==='/v1/reminders/provider-event') {
    if(method!=='POST')throw apiError('Not found.',404);
    return json(await providerEvent(request,query,env));
  }
  const mobile=path.startsWith('/v1/mobile/');
  const auth=mobile?(await authMobile(request)).auth:(method==='GET'?await authBrowser(request):await authMutation(request,{mobile:false}));
  if(method==='GET'&&path.endsWith('/account/reminders'))return json(await reminderSnapshot(query,auth.user_id,{env}));
  if(method==='PATCH'&&path.endsWith('/account/reminders')) {
    const payload=await readJson(request);
    // Bind the editor's identity as well as the live authenticated request.
    // Cookies can switch accounts between the preflight read and this PATCH.
    if(payload?.expectedAccountId!==auth.user_id)throw apiError('Account changed. Reload reminder settings.',409);
    return json(await updateReminderSettings(query,auth,payload,{env}));
  }
  if(mobile&&path.endsWith('/account/reminders/devices')&&method==='POST')return json(await registerReminderDevice(query,auth,await readJson(request),{env}));
  if(mobile&&path.endsWith('/account/reminders/devices')&&method==='DELETE')return json(await unregisterReminderDevice(query,auth,await readJson(request)));
  throw apiError('Not found.',404);
}
