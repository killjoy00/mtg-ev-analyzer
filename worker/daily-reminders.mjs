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
const apiError=(message,status=400)=>Object.assign(Error(message),{status});
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
  if(rest.length||!encoded||!/^[A-Za-z0-9_-]{43}$/.test(signature||''))throw apiError('Invalid unsubscribe link.',400);
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
export async function reminderSnapshot(query,authId,{env=process.env}={}) {
  const [row,email,recent]=await Promise.all([setting(query,authId),deletionEmailForAuth(query,authId),
    query('SELECT DISTINCT ON (channel) channel,state,accepted_at,delivered_at,push_receipt_result FROM daily_reminder_deliveries WHERE auth_user_id=$1::uuid ORDER BY channel,created_at DESC LIMIT 2',[authId])]);
  const status=Object.fromEntries(recent.rows.map(item=>[item.channel,{
    state:item.state,acceptedAt:item.accepted_at||null,deliveredAt:item.delivered_at||null,
    platformReceipt:item.push_receipt_result||null}]));
  const config=scheduleFromRow(row);
  const suppressed=Boolean(email&&row?.suppressed_email_hash===emailFingerprint(email,env));
  return {
    schedule:config,
    email:{enabled:yes(row?.email_enabled),eligible:Boolean(email),suppressed,
      consentedAt:row?.email_consented_at||null,deliveredAt:row?.last_email_delivered_at||null,
      lastAttempt:status.email||null},
    push:{enabled:yes(row?.push_enabled),consentedAt:row?.push_consented_at||null,
      providerAcceptedAt:row?.last_push_accepted_at||null,lastAttempt:status.push||null},
    nextAt:row?.next_due_at||null,
    // A stored opt-in alone is never evidence of a functioning scheduler.
    deliveryActive:env.PACK1_DAILY_REMINDERS_ENABLED==='1',
  };
}
export async function updateReminderSettings(query,auth,payload,{env=process.env,clock=Date.now()}={}) {
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw apiError('Invalid reminder request.');
  if(!['email','push'].includes(payload.channel)||typeof payload.enabled!=='boolean')
    throw apiError('Choose email or push and an explicit enabled state.');
  const config=validateReminderSchedule(payload);
  if(payload.enabled&&payload.channel==='email') {
    const destination=await deletionEmailForAuth(query,auth.user_id);
    if(!destination)throw apiError('Verify your account email before enabling email reminders.',403);
    const previous=await setting(query,auth.user_id);
    if(previous?.suppressed_email_hash===emailFingerprint(destination,env))
      throw apiError('Email delivery is suppressed after a bounce or complaint. Contact support.',409);
  }
  if(payload.enabled&&payload.channel==='push') {
    const devices=await query('SELECT 1 FROM daily_reminder_devices WHERE auth_user_id=$1::uuid AND revoked_at IS NULL AND session_hash IN (SELECT session_hash FROM account_sessions WHERE revoked_at IS NULL AND expires_at>now()) LIMIT 1',[auth.user_id]);
    if(!devices.rows.length)throw apiError('Enable notifications on a device first.',409);
  }
  const next=nextReminderOccurrence(config,Number(clock));
  const result=await query(
    'INSERT INTO daily_reminder_settings(auth_user_id,frequency,weekdays,local_time,time_zone,email_enabled,push_enabled,email_consented_at,push_consented_at,next_due_at) '+
    'SELECT $1::uuid,$2,$3::integer[],$4,$5,($6::text=\'email\' AND $7::boolean),($6::text=\'push\' AND $7::boolean),'+
    'CASE WHEN $6=\'email\' AND $7::boolean THEN now() ELSE NULL END,'+
    'CASE WHEN $6=\'push\' AND $7::boolean THEN now() ELSE NULL END,$8::timestamptz '+
    'WHERE pack1_identity_attachment_allowed($1::uuid) '+
    'ON CONFLICT(auth_user_id) DO UPDATE SET frequency=EXCLUDED.frequency,weekdays=EXCLUDED.weekdays,'+
    'local_time=EXCLUDED.local_time,time_zone=EXCLUDED.time_zone,'+
    'email_enabled=CASE WHEN $6=\'email\' THEN $7::boolean ELSE daily_reminder_settings.email_enabled END,'+
    'push_enabled=CASE WHEN $6=\'push\' THEN $7::boolean ELSE daily_reminder_settings.push_enabled END,'+
    'email_consented_at=CASE WHEN $6=\'email\' AND $7::boolean AND NOT daily_reminder_settings.email_enabled THEN now() ELSE daily_reminder_settings.email_consented_at END,'+
    'push_consented_at=CASE WHEN $6=\'push\' AND $7::boolean AND NOT daily_reminder_settings.push_enabled THEN now() ELSE daily_reminder_settings.push_consented_at END,'+
    'next_due_at=$8::timestamptz,schedule_version=daily_reminder_settings.schedule_version+1,'+
    'unsubscribe_nonce=gen_random_uuid(),updated_at=now() '+
    'WHERE pack1_identity_attachment_allowed($1::uuid) RETURNING auth_user_id',
    [auth.user_id,config.frequency,'{'+config.weekdays.join(',')+'}',config.localTime,config.timeZone,payload.channel,String(payload.enabled),next.dueAt]);
  if(!result.rows.length)throw apiError('Account is being deleted.',409);
  await query('INSERT INTO daily_reminder_changes(auth_user_id,channel,action) VALUES($1::uuid,$2,$3)',[
    auth.user_id,payload.channel,payload.enabled?'enable':'disable']);
  return reminderSnapshot(query,auth.user_id,{env});
}
export async function registerReminderDevice(query,auth,payload,{env=process.env}={}) {
  if(!payload||!validId(payload.installationId)||!TOKEN.test(String(payload.token||''))||
    !['ios','android'].includes(payload.platform)||auth.source!=='mobile'||!/^[a-f0-9]{64}$/.test(String(auth.session_hash||'')))
    throw apiError('Invalid notification device registration.');
  const count=await query('SELECT count(*)::int count FROM daily_reminder_devices WHERE auth_user_id=$1::uuid AND revoked_at IS NULL AND installation_id<>$2::uuid', [auth.user_id,payload.installationId]);
  if(Number(count.rows[0]?.count||0)>=5)throw apiError('You can register up to five devices. Disable notifications on an old device first.',409);
  const fingerprint=hash(payload.token);
  const ciphertext=protectToken(payload.token,env);
  await query('UPDATE daily_reminder_devices SET revoked_at=now(),updated_at=now() WHERE token_hash=$1 AND installation_id<>$2::uuid',
    [fingerprint,payload.installationId]);
  const changed=await query(
    'INSERT INTO daily_reminder_devices(installation_id,auth_user_id,session_hash,platform,token_hash,token_ciphertext) '+
    'SELECT $1::uuid,$2::uuid,$3,$4,$5,$6 WHERE pack1_identity_attachment_allowed($2::uuid) '+
    'ON CONFLICT(installation_id) DO UPDATE SET auth_user_id=EXCLUDED.auth_user_id,session_hash=EXCLUDED.session_hash,'+
    'platform=EXCLUDED.platform,token_hash=EXCLUDED.token_hash,token_ciphertext=EXCLUDED.token_ciphertext,'+
    'revoked_at=NULL,updated_at=now() WHERE pack1_identity_attachment_allowed($2::uuid) AND ' +
'(daily_reminder_devices.auth_user_id=EXCLUDED.auth_user_id OR daily_reminder_devices.revoked_at IS NOT NULL) RETURNING installation_id',
    [payload.installationId,auth.user_id,auth.session_hash,payload.platform,fingerprint,ciphertext]);
  if(!changed.rows.length)throw apiError('This installation is registered to a different account. Sign out on that account first.',409);
  return {ok:true};
}
export async function unregisterReminderDevice(query,auth,payload) {
  if(!validId(payload?.installationId))throw apiError('Invalid device registration.');
  await query('UPDATE daily_reminder_devices SET revoked_at=now(),updated_at=now() WHERE installation_id=$1::uuid AND auth_user_id=$2::uuid',
    [payload.installationId,auth.user_id]);
  return {ok:true};
}
export async function revokeReminderSessionDevices(query,auth) {
  if(auth?.session_hash)await query('UPDATE daily_reminder_devices SET revoked_at=now(),updated_at=now() WHERE session_hash=$1',[auth.session_hash]);
}
async function eligibilityAndCompletion(query,row,env=process.env) {
  let email=null;
  if(row.channel==='email') {
    email=await deletionEmailForAuth(query,row.auth_user_id);
    if(!email||emailFingerprint(email,env)===row.suppressed_email_hash)return {suppress:true,email:null};
  }
  // A push subscription does not require email verification; only the email
  // channel is bound to the verified Auth email.
  const completed=await query(
    'SELECT count(DISTINCT s.set_id)::int completed FROM scores s '+
    'JOIN account_links a ON a.player_id=s.player_id WHERE a.auth_user_id=$1::uuid '+
    'AND s.challenge_date=$2::date AND s.mode=\'draft_run\' AND s.set_id IN (\'mixed\',\'powered-cube\',\'latest\')',
    [row.auth_user_id,row.pacificDay]);
  return {suppress:Number(completed.rows[0]?.completed)===3,email};
}
async function suppressDelivery(query,id) {
  await query('UPDATE daily_reminder_deliveries SET state=\'suppressed\',updated_at=now() WHERE id=$1::uuid AND state IN (\'queued\',\'retry\')',[id]);
}
async function deliverOne(query,id,clock,{env=process.env,fetcher=fetch,pacificDay}={}) {
  const result=await query(
    'SELECT d.*,s.email_enabled,s.push_enabled,s.schedule_version current_version,s.unsubscribe_nonce,'+
    's.suppressed_email_hash,dv.token_ciphertext,dv.auth_user_id device_owner,dv.revoked_at device_revoked '+
    'FROM daily_reminder_deliveries d JOIN daily_reminder_settings s ON s.auth_user_id=d.auth_user_id '+
    'LEFT JOIN daily_reminder_devices dv ON dv.installation_id=d.installation_id '+
    'WHERE d.id=$1::uuid',[id]);
  const row=result.rows[0];
  if(!row||!['queued','retry'].includes(row.state))return 'skipped';
  const inDate=Date.parse(row.created_at);
  const allowed=Number(row.schedule_version)===Number(row.current_version)&&
    ((row.channel==='email'&&yes(row.email_enabled))||(row.channel==='push'&&yes(row.push_enabled)&&
      row.device_owner===row.auth_user_id&&!row.device_revoked));
  const account=await query('SELECT 1 FROM account_deletion_operations WHERE auth_user_id=$1::uuid LIMIT 1',[row.auth_user_id]);
  if(!allowed||account.rows.length||!Number.isFinite(inDate)||clock-inDate>MAX_LATENESS_MS) {
    await suppressDelivery(query,id);return 'suppressed';
  }
  const {suppress,email}=await eligibilityAndCompletion(query,{...row,pacificDay},env);
  if(suppress){await suppressDelivery(query,id);return 'suppressed';}
  if(row.channel==='push') {
    const session=await query('SELECT 1 FROM account_sessions WHERE session_hash=(SELECT session_hash FROM daily_reminder_devices WHERE installation_id=$1::uuid) AND revoked_at IS NULL AND expires_at>now() LIMIT 1',[row.installation_id]);
    if(!session.rows.length){await suppressDelivery(query,id);return 'suppressed';}
  }
  const claim=await query('UPDATE daily_reminder_deliveries SET state=\'sending\',attempts=attempts+1,started_at=now(),updated_at=now() '+
    'WHERE id=$1::uuid AND state IN (\'queued\',\'retry\') AND attempts<3 '+
    'AND (next_retry_at IS NULL OR next_retry_at<=now()) AND '+
    'EXISTS(SELECT 1 FROM daily_reminder_settings WHERE auth_user_id=$2::uuid AND schedule_version=$3::bigint '+
    'AND CASE WHEN $4=\'email\' THEN email_enabled ELSE push_enabled END) RETURNING id,attempts',
    [id,row.auth_user_id,row.schedule_version,row.channel]);
  if(!claim.rows.length)return 'not-claimed';
  try {
    let response;
    if(row.channel==='email') {
      const key=String(env.PACK1_ACCOUNT_DELETE_RESEND_API_KEY||'');
      if(!key.startsWith('re_'))throw apiError('Email provider not configured.',503);
      const unsubscribe=UNSUBSCRIBE_URL+'?token='+encodeURIComponent(unsubscribeToken(row.auth_user_id,row.unsubscribe_nonce,env));
      const text=['Your Pack One Dailies are ready.','',
        'Play today: https://packone.pro/','','You receive this because you enabled email Daily reminders.',
        'Manage reminders: https://packone.pro/ (My Pack One → Account settings)',
        'Unsubscribe: '+unsubscribe].join('\n');
      response=await fetcher('https://api.resend.com/emails',{
        method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json',
          'Idempotency-Key':'pack1-daily-'+id},
        body:JSON.stringify({from:DEFAULT_EMAIL,to:[email],subject:'Your Pack One Dailies are ready',
          text,headers:{'List-Unsubscribe':'<'+unsubscribe+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}}),
        redirect:'error',signal:AbortSignal.timeout(10000)});
    } else {
      const token=openToken(row.token_ciphertext,env);
      response=await fetcher('https://exp.host/--/api/v2/push/send',{
        method:'POST',headers:{'content-type':'application/json',accept:'application/json',
          ...(env.PACK1_EXPO_PUSH_ACCESS_TOKEN?{authorization:'Bearer '+env.PACK1_EXPO_PUSH_ACCESS_TOKEN}:{})},
        body:JSON.stringify({to:token,title:'Your Pack One Dailies are ready',
          body:'Three fresh Daily challenges are waiting.',data:{screen:'daily',owner:row.auth_user_id},channelId:'daily-reminders'}),
        redirect:'error',signal:AbortSignal.timeout(10000)});
    }
    if(response.status===429) {
      await query('UPDATE daily_reminder_deliveries SET state=CASE WHEN attempts<3 THEN \'retry\' ELSE \'failed\' END,'+
        'next_retry_at=now()+interval \'5 minutes\',updated_at=now() WHERE id=$1::uuid AND state=\'sending\'',[id]);
      return 'rate-limited';
    }
    if(!response.ok) {
      // A 5xx response or connection failure may follow provider acceptance.
      const permanent=response.status>=400&&response.status<500;
      await query('UPDATE daily_reminder_deliveries SET state=$2,updated_at=now() WHERE id=$1::uuid AND state=\'sending\'',
        [id,permanent?'failed':'uncertain']);
      return permanent?'rejected':'uncertain';
    }
    const value=await response.json().catch(()=>({}));
    const ticket=row.channel==='push'?(Array.isArray(value.data)?value.data[0]:value.data):null;
    if(row.channel==='push'&&ticket?.status==='error') {
      if(ticket.details?.error==='DeviceNotRegistered')await query(
        'UPDATE daily_reminder_devices SET revoked_at=now(),updated_at=now() WHERE installation_id=$1::uuid AND auth_user_id=$2::uuid',
        [row.installation_id,row.auth_user_id]);
      await query('UPDATE daily_reminder_deliveries SET state=\'failed\',updated_at=now() WHERE id=$1::uuid',[id]);
      return 'rejected';
    }
    const providerId=row.channel==='email'?value.id:ticket?.id;
    if(!providerId||typeof providerId!=='string'||providerId.length>200) {
      await query('UPDATE daily_reminder_deliveries SET state=\'uncertain\',updated_at=now() WHERE id=$1::uuid',[id]);
      return 'uncertain';
    }
    await query('UPDATE daily_reminder_deliveries SET state=\'accepted\',provider_id=$2,accepted_at=now(),updated_at=now() WHERE id=$1::uuid AND state=\'sending\'',[id,providerId]);
    if(row.channel==='push')await query('UPDATE daily_reminder_settings SET last_push_accepted_at=now() WHERE auth_user_id=$1::uuid',[row.auth_user_id]);
    return 'accepted';
  } catch {
    // At-most-once beyond Resend's idempotency window: never blindly retry
    // an ambiguous timeout, worker crash, or interrupted provider response.
    await query('UPDATE daily_reminder_deliveries SET state=\'uncertain\',updated_at=now() WHERE id=$1::uuid AND state=\'sending\'',[id]);
    return 'uncertain';
  }
}
export async function refreshPushReceipts(query,{env=process.env,fetcher=fetch,clock=Date.now()}={}) {
  // Tickets are acceptance receipts. Expo push receipts validate delivery to
  // APNs/FCM, not display on the user's screen; never call them 'delivered'.
  const pending=await query(
    "SELECT id,provider_id,auth_user_id,installation_id,accepted_at FROM daily_reminder_deliveries "+
    "WHERE channel='push' AND state='accepted' AND push_receipt_checked_at IS NULL "+
    "AND accepted_at<now()-interval '15 minutes' AND accepted_at>now()-interval '2 hours' "+
    "ORDER BY accepted_at LIMIT 50");
  if(!pending.rows.length)return {checked:0,invalidated:0};
  let response;
  try {
    response=await fetcher('https://exp.host/--/api/v2/push/getReceipts',{
      method:'POST',headers:{'content-type':'application/json',accept:'application/json',
        ...(env.PACK1_EXPO_PUSH_ACCESS_TOKEN?{authorization:'Bearer '+env.PACK1_EXPO_PUSH_ACCESS_TOKEN}:{})},
      body:JSON.stringify({ids:pending.rows.map(row=>row.provider_id)}),
      redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)return {checked:0,invalidated:0};
  }catch{return {checked:0,invalidated:0};}
  const payload=await response.json().catch(()=>({}));
  const receipts=payload?.data&&typeof payload.data==='object'&&!Array.isArray(payload.data)?payload.data:{};
  let checked=0,invalidated=0;
  for(const row of pending.rows) {
    const receipt=receipts[row.provider_id];
    if(!receipt||!['ok','error'].includes(receipt.status))continue;
    const error=String(receipt.details?.error||'').slice(0,80);
    await query(
      "UPDATE daily_reminder_deliveries SET push_receipt_checked_at=now(),"+
      "push_receipt_result=$2,updated_at=now() WHERE id=$1::uuid AND state='accepted' AND push_receipt_checked_at IS NULL",
      [row.id,receipt.status==='ok'?'platform_accepted':error==='DeviceNotRegistered'?'invalid_token':'provider_rejected']);
    checked++;
    if(error==='DeviceNotRegistered') {
      await query('UPDATE daily_reminder_devices SET revoked_at=now(),updated_at=now() WHERE installation_id=$1::uuid AND auth_user_id=$2::uuid',
        [row.installation_id,row.auth_user_id]);
      invalidated++;
    }
  }
  await query(
    "UPDATE daily_reminder_deliveries SET push_receipt_checked_at=now(),"+
    "push_receipt_result='receipt_expired',updated_at=now() WHERE channel='push' AND state='accepted' "+
    "AND push_receipt_checked_at IS NULL AND accepted_at<=now()-interval '2 hours'");
  return {checked,invalidated};
}
export async function dispatchReminderTick(query,scheduledAt,{env=process.env,clock=Date.now(),fetcher=fetch,pacificDay}={}) {
  if(env.PACK1_DAILY_REMINDERS_ENABLED!=='1')return {active:false,scanned:0,accepted:0};
  await refreshPushReceipts(query,{env,fetcher,clock});
  if(!pacificDay)throw Error('Pacific day is required.');
  const due=await query('SELECT * FROM daily_reminder_settings WHERE (email_enabled OR push_enabled) '+
    'AND next_due_at<=now() ORDER BY next_due_at LIMIT 50');
  let accepted=0,suppressed=0,uncertain=0;
  for(const row of due.rows) {
    const schedule=scheduleFromRow(row),date=localReminderDay(row.next_due_at,schedule);
    const next=nextReminderOccurrence(schedule,Date.parse(row.next_due_at)+1000);
    // One SQL statement atomically advances the schedule and records all
    // occurrences. Concurrent trigger invocations cannot claim the same time.
    const inserted=await query(
      'WITH advance AS (UPDATE daily_reminder_settings SET next_due_at=$3::timestamptz '+
      'WHERE auth_user_id=$1::uuid AND schedule_version=$2::bigint AND next_due_at=$4::timestamptz '+
      'RETURNING auth_user_id,email_enabled,push_enabled,schedule_version), '+
      'targets AS (SELECT a.auth_user_id,\'email\'::text channel,NULL::uuid installation_id FROM advance a WHERE a.email_enabled '+
      'UNION ALL SELECT a.auth_user_id,\'push\',d.installation_id FROM advance a '+
      'JOIN daily_reminder_devices d ON d.auth_user_id=a.auth_user_id AND d.revoked_at IS NULL '+
      'JOIN account_sessions s ON s.session_hash=d.session_hash AND s.revoked_at IS NULL AND s.expires_at>now() WHERE a.push_enabled) '+
      'INSERT INTO daily_reminder_deliveries(auth_user_id,channel,installation_id,local_day,schedule_version) '+
      'SELECT t.auth_user_id,t.channel,t.installation_id,$5::date,$2::bigint FROM targets t '+
      'ON CONFLICT DO NOTHING RETURNING id',
      [row.auth_user_id,row.schedule_version,next.dueAt,row.next_due_at,date]);
    if(clock-Date.parse(row.next_due_at)>MAX_LATENESS_MS) {
      for(const item of inserted.rows){await suppressDelivery(query,item.id);suppressed++;}
      continue;
    }
    for(const item of inserted.rows) {
      const outcome=await deliverOne(query,item.id,clock,{env,fetcher,pacificDay});
      if(outcome==='accepted')accepted++;
      if(outcome==='suppressed')suppressed++;
      if(outcome==='uncertain')uncertain++;
    }
  }
  // Retry only explicitly rejected 429s within the same short occurrence
  // freshness window; abandoned sending leases are uncertain, not retryable.
  const retries=await query('SELECT id FROM daily_reminder_deliveries WHERE state=\'retry\' AND next_retry_at<=now() '+
    'AND created_at>now()-interval \'20 minutes\' ORDER BY next_retry_at LIMIT 25');
  for(const row of retries.rows) {
    const outcome=await deliverOne(query,row.id,clock,{env,fetcher,pacificDay});
    if(outcome==='accepted')accepted++;
    if(outcome==='uncertain')uncertain++;
  }
  await query('UPDATE daily_reminder_deliveries SET state=\'uncertain\',updated_at=now() '+
    'WHERE state=\'sending\' AND started_at<now()-interval \'2 minutes\'');
  await query('UPDATE daily_reminder_deliveries SET state=\'failed\',updated_at=now() '+
    'WHERE state=\'retry\' AND created_at<now()-interval \'20 minutes\'');
  return {active:true,scanned:due.rows.length,accepted,suppressed,uncertain};
}
async function unsubscribeRequest(request,query,env) {
  const url=new URL(request.url);
  const token=url.searchParams.get('token');
  const {authId,nonce}=verifyUnsubscribeToken(token,env);
  const current=await setting(query,authId);
  if(!current||current.unsubscribe_nonce!==nonce)throw apiError('This unsubscribe link has expired.',410);
  if(request.method==='GET') {
    return new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Pack One reminders</title>'+
      '<main style="max-width:34rem;margin:4rem auto;font:1rem system-ui"><h1>Stop Daily email reminders?</h1>'+
      '<p>This only affects email. Push reminders remain separate.</p>'+
      '<form method="POST"><button type="submit">Unsubscribe from email</button></form></main></html>',
      {headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'}});
  }
  if(request.method!=='POST')throw apiError('Not found.',404);
  const changed=await query('UPDATE daily_reminder_settings SET email_enabled=false,unsubscribe_nonce=gen_random_uuid(),'+
    'schedule_version=schedule_version+1,updated_at=now() WHERE auth_user_id=$1::uuid AND unsubscribe_nonce=$2::uuid RETURNING auth_user_id',[authId,nonce]);
  if(changed.rows.length)await query('INSERT INTO daily_reminder_changes(auth_user_id,channel,action) VALUES($1::uuid,\'email\',\'unsubscribe\')',[authId]);
  return new Response('<!doctype html><html lang="en"><title>Unsubscribed</title><main style="font:1rem system-ui"><h1>Email reminders are off</h1><p>Push settings are unchanged.</p><a href="https://packone.pro/">Pack One</a></main></html>',
    {headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
}
export function verifyReminderWebhook(request,raw,env=process.env,clock=Date.now()) {
  const secret=String(env.PACK1_REMINDER_RESEND_WEBHOOK_SECRET||'');
  const id=request.headers.get('svix-id')||'',timestamp=request.headers.get('svix-timestamp')||'';
  const signatures=request.headers.get('svix-signature')||'';
  if(!secret.startsWith('whsec_')||!id||!/^\d{10}$/.test(timestamp)||Math.abs(clock-Number(timestamp)*1000)>300000)
    throw apiError('Webhook verification failed.',403);
  const expected=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(id+'.'+timestamp+'.'+raw).digest();
  const valid=signatures.split(' ').some(part=>{
    if(!part.startsWith('v1,'))return false;
    const supplied=Buffer.from(part.slice(3),'base64');
    return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
  });
  if(!valid)throw apiError('Webhook verification failed.',403);
}
async function providerEvent(request,query,env) {
  const raw=await request.text();
  if(raw.length>32768)throw apiError('Payload too large.',413);
  verifyReminderWebhook(request,raw,env);
  let event;
  try {event=JSON.parse(raw);} catch {throw apiError('Invalid event.');}
  const type=String(event?.type||'');
  const providerId=String(event?.data?.email_id||'');
  if(!['email.delivered','email.bounced','email.complained'].includes(type)||!providerId||providerId.length>200)
    return {ok:true,ignored:true};
  const delivery=(await query('SELECT auth_user_id FROM daily_reminder_deliveries WHERE provider_id=$1 AND channel=\'email\' LIMIT 1',[providerId])).rows[0];
  if(!delivery)return {ok:true,ignored:true};
  if(type==='email.delivered') {
    await query('UPDATE daily_reminder_deliveries SET state=\'delivered\',delivered_at=now(),updated_at=now() WHERE provider_id=$1 AND state IN (\'accepted\',\'uncertain\')',[providerId]);
    await query('UPDATE daily_reminder_settings SET last_email_delivered_at=now() WHERE auth_user_id=$1::uuid',[delivery.auth_user_id]);
  } else {
    const email=await deletionEmailForAuth(query,delivery.auth_user_id);
    if(email)await query('UPDATE daily_reminder_settings SET suppressed_email_hash=$2,suppressed_reason=$3,'+
      'email_enabled=false,schedule_version=schedule_version+1,updated_at=now() WHERE auth_user_id=$1::uuid',
      [delivery.auth_user_id,emailFingerprint(email,env),type==='email.bounced'?'bounce':'complaint']);
    await query('UPDATE daily_reminder_deliveries SET state=\'failed\',updated_at=now() WHERE provider_id=$1',[providerId]);
    await query('INSERT INTO daily_reminder_changes(auth_user_id,channel,action) VALUES($1::uuid,\'email\',$2)',
      [delivery.auth_user_id,type==='email.bounced'?'bounce':'complaint']);
  }
  return {ok:true};
}
export async function reminderRoute(request,{query,json,readJson,authBrowser,authMutation,authMobile,trigger,pacificDay,env=process.env}={}) {
  const path=new URL(request.url).pathname,method=request.method;
  if(path==='/internal/daily-reminders') {
    const body=await readJson(request);
    const checked=trigger(request,body,{names:TRIGGERS});
    if(!checked)throw apiError('Neon scheduler identity required.',403);
    if(Math.abs(Date.now()-Date.parse(checked.scheduledAt))>20*60*1000)
      return json({ok:true,stale:true});
    return json(await dispatchReminderTick(query,checked.scheduledAt,{env,pacificDay}));
  }
  if(path==='/v1/reminders/unsubscribe')return unsubscribeRequest(request,query,env);
  if(path==='/v1/reminders/provider-event') {
    if(method!=='POST')throw apiError('Not found.',404);
    return json(await providerEvent(request,query,env));
  }
  const mobile=path.startsWith('/v1/mobile/');
  const auth=mobile
    ? (await authMobile(request)).auth
    : (method==='GET'?await authBrowser(request):await authMutation(request,{mobile:false}));
  if(method==='GET'&&path.endsWith('/account/reminders'))return json(await reminderSnapshot(query,auth.user_id,{env}));
  if(method==='PATCH'&&path.endsWith('/account/reminders'))
    return json(await updateReminderSettings(query,auth,await readJson(request),{env}));
  if(mobile&&path.endsWith('/account/reminders/devices')&&method==='POST')
    return json(await registerReminderDevice(query,auth,await readJson(request),{env}));
  if(mobile&&path.endsWith('/account/reminders/devices')&&method==='DELETE')
    return json(await unregisterReminderDevice(query,auth,await readJson(request)));
  throw apiError('Not found.',404);
}
