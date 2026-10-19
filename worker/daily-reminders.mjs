import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {nextReminderOccurrence,localReminderDay,validateReminderSchedule} from './daily-reminder-schedule.mjs';
import {deletionEmailForAuth} from './account-deletion-verification.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TOKEN=/^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,192}\]$/;
const TRIGGERS=new Set(['pack1-daily-reminders']);
const MAX_LATENESS_MS=20*60*1000;
const DEFAULT={frequency:'daily',weekdays:[1],localTime:'09:00',timeZone:'Etc/UTC'};
const UNSUBSCRIBE_URL='https://api.packone.pro/growth/v1/reminders/unsubscribe';
const DEFAULT_EMAIL='Pack One <accounts@packone.pro>';
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
function unsubscribeToken(authId,nonce,env=process.env) {
  if(!validId(authId)||!validId(nonce))throw Error('Unsubscribe identity invalid.');
  const payload=authId+'.'+nonce;
  const signature=createHmac('sha256',hmacKey(env)).update('pack1-daily-unsubscribe:'+payload).digest('base64url');
  return Buffer.from(payload).toString('base64url')+'.'+signature;
}
function verifyUnsubscribeToken(token,env=process.env) {
  const [encoded,signature,...rest]=String(token||'').split('.');
  if(String(token||'').length>256||rest.length||!encoded||!/^[A-Za-z0-9_-]{43}$/.test(signature||''))throw apiError('Invalid unsubscribe link.',400);
  let payload;
  try {payload=Buffer.from(encoded,'base64url').toString('utf8');} catch {throw apiError('Invalid unsubscribe link.',400);}
  const [authId,nonce,...extra]=payload.split('.');
  if(extra.length||!validId(authId)||!validId(nonce))throw apiError('Invalid unsubscribe link.',400);
  const expected=unsubscribeToken(authId,nonce,env).split('.')[1];
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))throw apiError('Invalid unsubscribe link.',400);
  return {authId,nonce};
}
function scheduleFromRow(row) {
  return validateReminderSchedule({
    frequency:row?.frequency||DEFAULT.frequency,
    weekdays:Array.isArray(row?.weekdays)?row.weekdays:(typeof row?.weekdays==='string'?
      row.weekdays.replace(/[{}]/g,'').split(',').filter(Boolean).map(Number):DEFAULT.weekdays),
    localTime:row?.local_time||DEFAULT.localTime,
    timeZone:row?.time_zone||DEFAULT.timeZone,
  });
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
function scheduleInput(value) {
  try {return validateReminderSchedule(value);} catch {throw apiError('Choose a valid frequency, weekdays, local time and IANA timezone.');}
}
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
export async function reminderSnapshot(query,authId,{env=process.env}={}) {
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
    schedule:scheduleFromRow(row),
    email:{enabled:yes(row?.email_enabled),eligible:Boolean(email),suppressed:Boolean(blocked.rows.length||fingerprint&&row?.suppressed_email_hash===fingerprint),
      addressChanged:Boolean(yes(row?.email_enabled)&&fingerprint!==row?.email_destination_hash),
      consentedAt:row?.email_consented_at||null,deliveredAt:row?.last_email_delivered_at||null,lastAttempt:status.email||null,deliveryActive:active.email.active},
    push:{enabled:yes(row?.push_enabled),consentedAt:row?.push_consented_at||null,providerAcceptedAt:row?.last_push_accepted_at||null,
      lastAttempt:status.push||null,registeredDevices:Number(devices.rows[0]?.count||0),deliveryActive:active.push.active},
    nextAt:row?.next_due_at||null,deliveryActive:active.email.active||active.push.active,
  };
}
export async function updateReminderSettings(query,auth,payload,{env=process.env,clock=Date.now()}={}) {
  if(!validId(auth?.user_id))throw apiError('Account session required.',401);
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||!['email','push'].includes(payload.channel)||typeof payload.enabled!=='boolean')
    throw apiError('Choose a reminder channel and explicit enabled state.');
  const allowed=new Set(['channel','enabled','frequency','weekdays','localTime','timeZone','expectedAccountId']);
  if(payload.expectedAccountId!==undefined&&payload.expectedAccountId!==auth.user_id)throw apiError('Account changed. Reload reminder settings.',409);
  if(Object.keys(payload).some(key=>!allowed.has(key)))throw apiError('Unexpected reminder settings field.');
  // Opt-out must not depend on an unsaved/invalid editor value.
  const config=payload.enabled?scheduleInput(payload):scheduleFromRow(await setting(query,auth.user_id));
  const email=payload.enabled&&payload.channel==='email'?await deletionEmailForAuth(query,auth.user_id):null;
  if(payload.enabled&&payload.channel==='email'&&!email)throw domainError('REMINDER_EMAIL_UNVERIFIED');
  const next=nextReminderOccurrence(config,Number(clock));
  const saved=await store(query,'SELECT * FROM pack1_reminder_save_settings($1::uuid,$2::text,$3::integer[],$4::text,$5::text,$6::text,$7::boolean,$8::timestamptz,$9::text,$10::text)',
    [auth.user_id,config.frequency,'{'+config.weekdays.join(',')+'}',config.localTime,config.timeZone,payload.channel,String(payload.enabled),next.dueAt,email?emailFingerprint(email,env):null,email]);
  if(!saved.rows.length)throw domainError('ACCOUNT_DELETING');
  return reminderSnapshot(query,auth.user_id,{env});
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
async function deliverOne(query,id,{env,fetcher,clock,pacificDay,active}={}) {
  const result=await query('SELECT d.*,s.unsubscribe_nonce,v.token_ciphertext FROM daily_reminder_deliveries d JOIN daily_reminder_settings s ON s.auth_user_id=d.auth_user_id LEFT JOIN daily_reminder_devices v ON v.installation_id=d.installation_id WHERE d.id=$1::uuid',[id]);
  const row=result.rows[0];
  if(!row||!['queued','retry'].includes(row.state))return 'not_claimed';
  let email=null,destination=null,body,endpoint,headers;
  if(row.channel==='email') {
    if(!active.email.active)return 'inactive';
    email=await deletionEmailForAuth(query,row.auth_user_id);
    destination=email?emailFingerprint(email,env):null;
    const unsubscribe=UNSUBSCRIBE_URL+'?token='+encodeURIComponent(unsubscribeToken(row.auth_user_id,row.unsubscribe_nonce,env));
    body={from:DEFAULT_EMAIL,to:email?[email]:[],subject:'Your Pack One Dailies are ready',
      text:['Your Pack One Dailies are ready.','','Play today: https://packone.pro/','',
        'You receive this because you enabled email Daily reminders.',
        'Manage reminders: https://packone.pro/?account=reminders','Unsubscribe: '+unsubscribe].join('\n'),
      headers:{'List-Unsubscribe':'<'+unsubscribe+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'},
      tags:[{name:'pack1_reminder',value:id}]};
    endpoint='https://api.resend.com/emails';
    headers={authorization:'Bearer '+String(env.PACK1_REMINDER_RESEND_API_KEY||env.PACK1_ACCOUNT_DELETE_RESEND_API_KEY),
      'content-type':'application/json','Idempotency-Key':'pack1-daily-'+id};
  } else {
    if(!active.push.active)return 'inactive';
    // An obsolete registration is rejected in the atomic admission function.
    // Never attempt to decrypt a deliberately erased revoked token.
    let token='';
    if(row.token_ciphertext)try {token=openToken(row.token_ciphertext,env);} catch {
      await query("UPDATE daily_reminder_deliveries SET state='failed',failure_reason='device_configuration',updated_at=now() WHERE id=$1::uuid AND state IN ('queued','retry')",[id]);
      return 'failed';
    }
    body={to:token,title:'Your Pack One Dailies are ready',body:'Three fresh Daily challenges are waiting.',
      data:{screen:'daily',owner:row.auth_user_id,registrationVersion:Number(row.device_version)},channelId:'daily-reminders',ttl:60};
    endpoint='https://exp.host/--/api/v2/push/send';
    headers={'content-type':'application/json',accept:'application/json',
      ...(env.PACK1_EXPO_PUSH_ACCESS_TOKEN?{authorization:'Bearer '+env.PACK1_EXPO_PUSH_ACCESS_TOKEN}:{})};
  }
  const serialized=JSON.stringify(body);
  // This is the final database operation before dispatch. The function locks
  // with consent/deletion/device mutations and rechecks the actual destination,
  // current Pacific game, ownership, version, suppression and daily admission.
  const claimed=object((await query('SELECT pack1_reminder_claim($1::uuid,$2::text,$3::text,$4::text,$5::date,$6::boolean,$7::boolean) result',
    [id,email,destination,hash(serialized),pacificDay,String(active.email.active),String(active.push.active)])).rows[0]?.result);
  if(claimed?.result!=='claimed')return claimed?.result||'not_claimed';
  try {
    const response=await fetcher(endpoint,{method:'POST',headers,body:serialized,redirect:'error',signal:timeoutSignal()});
    if(response.status===429) {
      const retrySeconds=Math.min(900,Math.max(30,Number(response.headers.get('retry-after'))||300));
      const next=new Date(Number(clock)+retrySeconds*1000).toISOString();
      await finishSending(query,id,Number(claimed.attempts)<3?'retry':'failed','provider_rate_limit',next);
      return 'retry';
    }
    if(!response.ok) {
      const permanent=response.status>=400&&response.status<500;
      // 5xx/transport ambiguity can mean the provider accepted the message.
      // Do not resend blindly, even after the provider's idempotency TTL.
      await finishSending(query,id,permanent?'failed':'uncertain',permanent?'provider_rejected':'provider_ambiguous');
      return permanent?'failed':'uncertain';
    }
    const value=await response.json();
    const ticket=row.channel==='push'?(Array.isArray(value.data)?value.data[0]:value.data):null;
    if(ticket?.status==='error') {
      if(ticket.details?.error==='DeviceNotRegistered')await revokeInvalidDeliveryDevice(query,row);
      await finishSending(query,id,'failed','push_rejected');
      return 'failed';
    }
    const providerId=row.channel==='email'?value.id:ticket?.id;
    if(typeof providerId!=='string'||!providerId||providerId.length>200)throw Error('Provider response could not be confirmed.');
    await query('SELECT pack1_reminder_provider_accepted($1::uuid,$2::text)',[id,providerId]);
    if(row.channel==='email')await reconcileReminderEvents(query,{providerId});
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
export async function dispatchReminderTick(query,scheduledAt,{env=process.env,clock=Date.now(),fetcher=fetch,pacificDay,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const active=reminderDeliveryConfiguration(env);
  if(!pacificDay||!/^\d{4}-\d{2}-\d{2}$/.test(pacificDay))throw Error('Pacific day is required.');
  // Receipt/event reconciliation and abandoned-work classification run even
  // when send flags are off. Turning off consent does not erase late bounces.
  await reconcileReminderEvents(query);
  await refreshPushReceipts(query,{env,fetcher});
  await query("UPDATE daily_reminder_deliveries SET state='uncertain',failure_reason='abandoned_send',updated_at=now() WHERE id IN (SELECT id FROM daily_reminder_deliveries WHERE state='sending' AND last_attempt_at<now()-interval '2 minutes' LIMIT 200)");
  await query("UPDATE daily_reminder_deliveries SET state='suppressed',failure_reason='expired',updated_at=now() WHERE id IN (SELECT id FROM daily_reminder_deliveries WHERE state IN ('queued','retry') AND due_at<now()-interval '20 minutes' LIMIT 500)");
  await query("DELETE FROM daily_reminder_provider_events WHERE event_id IN (SELECT event_id FROM daily_reminder_provider_events WHERE created_at<now()-interval '7 days' LIMIT 500)");
  await query("DELETE FROM daily_reminder_deliveries WHERE id IN (SELECT id FROM daily_reminder_deliveries WHERE created_at<now()-interval '90 days' AND state NOT IN ('queued','retry','sending') LIMIT 500)");
  await query("DELETE FROM daily_reminder_rate_limits WHERE bucket<now()-interval '1 hour'");
  await query("DELETE FROM daily_reminder_changes WHERE id IN (SELECT id FROM daily_reminder_changes WHERE created_at<now()-interval '365 days' LIMIT 500)");
  await query("DELETE FROM daily_reminder_devices WHERE installation_id IN (SELECT installation_id FROM daily_reminder_devices WHERE revoked_at<now()-interval '30 days' AND updated_at<now()-interval '30 days' LIMIT 100)");
  const metrics={active:active.email.active||active.push.active,scanned:0,accepted:0,suppressed:0,uncertain:0,retry:0,failed:0,rateLimited:0};
  if(!metrics.active)return metrics;
  const due=await query('SELECT * FROM daily_reminder_settings WHERE ((email_enabled AND $1::boolean) OR (push_enabled AND $2::boolean)) AND next_due_at<=now() ORDER BY next_due_at LIMIT 100',[String(active.email.active),String(active.push.active)]);
  const began=Date.now();
  for(const row of due.rows) {
    const schedule=scheduleFromRow(row);
    const next=nextReminderOccurrence(schedule,Math.max(Number(clock),Date.parse(row.next_due_at)));
    await query('SELECT pack1_reminder_enqueue($1::uuid,$2::bigint,$3::timestamptz,$4::timestamptz,$5::date,$6::boolean,$7::boolean) id',
      [row.auth_user_id,row.schedule_version,row.next_due_at,next.dueAt,localReminderDay(row.next_due_at,schedule),String(active.email.active),String(active.push.active)]);
    metrics.scanned++;
    if(Date.now()-began>90000)break;
  }
  // Always recover prior queued work, not just IDs returned by this tick's
  // enqueue. The atomic dispatch function arbitrates concurrent recoverers.
  const queued=await query("SELECT id,channel FROM daily_reminder_deliveries WHERE state IN ('queued','retry') AND due_at<=now() AND due_at>=now()-interval '20 minutes' AND (next_retry_at IS NULL OR next_retry_at<=now()) AND ((channel='email' AND $1::boolean) OR (channel='push' AND $2::boolean)) ORDER BY due_at,id LIMIT 200",
    [String(active.email.active),String(active.push.active)]);
  for(const row of queued.rows) {
    if(Date.now()-began>90000)break;
    const outcome=await deliverOne(query,row.id,{env,fetcher,clock:Date.now(),pacificDay,active});
    if(Object.hasOwn(metrics,outcome)&&typeof metrics[outcome]==='number')metrics[outcome]++;
    if(outcome==='rate_limited'){metrics.rateLimited++;break;}
    if(['accepted','uncertain','retry','failed'].includes(outcome))await pause(row.channel==='email'?550:60);
  }
  return metrics;
}
const UNSUB_HEADERS={'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
async function unsubscribeRequest(request,query,env) {
  if(!['GET','POST'].includes(request.method))throw apiError('Not found.',404);
  const {authId,nonce}=verifyUnsubscribeToken(new URL(request.url).searchParams.get('token'),env);
  if(request.method==='GET')return new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Pack One reminders</title><main style="max-width:34rem;margin:4rem auto;font:1rem system-ui"><h1>Stop Daily email reminders?</h1><p>This only affects email. Push consent stays separate.</p><form method="POST"><button type="submit">Unsubscribe from email</button></form></main></html>',{headers:UNSUB_HEADERS});
  await query('SELECT pack1_reminder_unsubscribe($1::uuid,$2::uuid)',[authId,nonce]);
  return new Response('<!doctype html><html lang="en"><title>Unsubscribed</title><main style="font:1rem system-ui"><h1>Email reminders are off</h1><p>Push settings are unchanged.</p><a href="https://packone.pro/">Pack One</a></main></html>',{headers:UNSUB_HEADERS});
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
  // Provider webhooks are account-wide: unrelated verification, recovery and
  // account-deletion messages must not be retained as reminder event records.
  // Our reminder sender always tags its email with the immutable delivery ID.
  // For older untagged events, retain only a delivery we can already identify.
  if(hinted===undefined) {
    const known=await query("SELECT 1 FROM daily_reminder_deliveries WHERE channel='email' AND provider_id=$1::text LIMIT 1",[providerId]);
    if(!known.rows.length)return {ok:true,ignored:true};
  }
  const recipients=event?.data?.to;
  if(recipients!==undefined&&(!Array.isArray(recipients)||recipients.length!==1||typeof recipients[0]!=='string'||recipients[0].length>320))
    throw apiError('Invalid reminder event destination.');
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
    if(Math.abs(Date.now()-Date.parse(checked.scheduledAt))>MAX_LATENESS_MS)return json({ok:true,stale:true});
    return json(await dispatchReminderTick(query,checked.scheduledAt,{env,pacificDay}));
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
