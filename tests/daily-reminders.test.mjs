import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {
  reminderSnapshot,updateReminderSettings,registerReminderDevice,unregisterReminderDevice,
  revokeReminderSessionDevices,dispatchReminderTick,verifyReminderWebhook,reminderRoute,
} from '../worker/daily-reminders.mjs';
import {NEON_REMINDER_SCHEDULERS} from '../scripts/reconcile-neon-reminder-scheduler.mjs';

const user='11111111-1111-4111-8111-111111111111';
const installation='22222222-2222-4222-8222-222222222222';
const sessionHash='a'.repeat(64);
const env={PACK1_RATE_LIMIT_SECRET:'test-secret-not-for-deployment-0000000',
  PACK1_REMINDER_TOKEN_KEY:'b'.repeat(64),
  PACK1_REMINDER_RESEND_WEBHOOK_SECRET:'whsec_'+Buffer.from('fake-webhook-secret-only-for-tests').toString('base64'),
  PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_testing_only',
  PACK1_DAILY_REMINDERS_ENABLED:'1'};
const schedule={frequency:'daily',weekdays:[1],localTime:'09:00',timeZone:'America/Chicago'};
const auth={user_id:user,session_hash:sessionHash,source:'mobile'};
const row={auth_user_id:user,frequency:'daily',weekdays:[1],local_time:'09:00',time_zone:'America/Chicago',
  email_enabled:false,push_enabled:false,email_consented_at:null,push_consented_at:null,unsubscribe_nonce:installation};

function qRecorder(callback) {
  const calls=[];
  const query=async(sql,args=[])=>{
    calls.push({sql,args});
    return callback?.(sql,args,calls)||{rows:[],rowCount:0};
  };
  return {query,calls};
}
function authQuery(email='test@example.invalid',verified=true,extras=()=>({rows:[]})) {
  return qRecorder((sql,args)=>{
    if(sql.includes('FROM neon_auth."user"'))return {rows:[{email,email_verified:verified}]};
    return extras(sql,args);
  });
}
test('unconfigured account has independent default-off channels with no send status',async()=>{
  const {query}=authQuery();
  const snapshot=await reminderSnapshot(query,user,{env});
  assert.equal(snapshot.email.enabled,false);
  assert.equal(snapshot.email.eligible,true);
  assert.equal(snapshot.push.enabled,false);
  assert.equal(snapshot.email.deliveredAt,null);
  assert.equal(snapshot.push.providerAcceptedAt,null);
  assert.equal(snapshot.nextAt,null);
});
test('unverified email and fabricated destination cannot opt an account into email',async()=>{
  const {query,calls}=authQuery('test@example.invalid',false);
  await assert.rejects(updateReminderSettings(query,auth,{...schedule,channel:'email',enabled:true,email:'forged@example.invalid'},{env}),/Verify/);
  assert.ok(!calls.some(c=>c.sql.startsWith('INSERT INTO daily_reminder_settings')));
});
test('push consent cannot be enabled with no registered device',async()=>{
  const {query,calls}=authQuery('test@example.invalid',false);
  await assert.rejects(updateReminderSettings(query,auth,{...schedule,channel:'push',enabled:true},{env}),/device first/);
  assert.ok(!calls.some(c=>c.sql.startsWith('INSERT INTO daily_reminder_settings')));
});
test('changes preserve other channel consent in the conflict update SQL',async()=>{
  let count=0;
  const {query,calls}=authQuery('test@example.invalid',true,(sql)=>{
    if(sql.startsWith('INSERT INTO daily_reminder_settings'))return {rows:[{auth_user_id:user}]};
    if(sql.startsWith('INSERT INTO daily_reminder_changes')){count++;return {rows:[]};}
    return {rows:[]};
  });
  const result=await updateReminderSettings(query,auth,{...schedule,channel:'email',enabled:false},{env,clock:Date.parse('2026-10-18T18:00:00Z')});
  assert.equal(result.push.enabled,false);
  assert.equal(count,1);
  const sql=calls.find(c=>c.sql.startsWith('INSERT INTO daily_reminder_settings'))?.sql||'';
  assert.match(sql,/CASE WHEN \$6='email' THEN \$7::boolean ELSE daily_reminder_settings.email_enabled END/);
  assert.match(sql,/CASE WHEN \$6='push' THEN \$7::boolean ELSE daily_reminder_settings.push_enabled END/);
  assert.match(sql,/pack1_identity_attachment_allowed/);
  assert.ok(!calls.some(c=>c.sql.includes('forged@example.invalid')));
});
test('invalid or web-owned device registrations are rejected before SQL',async()=>{
  const {query,calls}=qRecorder();
  const payload={installationId:installation,token:'ExpoPushToken['+'x'.repeat(30)+']',platform:'android'};
  await assert.rejects(registerReminderDevice(query,{...auth,source:'cookie'},payload,{env}),/Invalid/);
  await assert.rejects(registerReminderDevice(query,auth,{...payload,token:'not-a-push-token'},{env}),/Invalid/);
  await assert.rejects(registerReminderDevice(query,auth,{...payload,installationId:'bad'},{env}),/Invalid/);
  assert.equal(calls.length,0);
});
test('push registration binds the current session, stores encrypted token not raw, and enforces ownership on removal',async()=>{
  const rawToken='ExpoPushToken['+'x'.repeat(36)+']';
  const {query,calls}=qRecorder(sql=>{
    if(sql.startsWith('SELECT count(*)'))return {rows:[{count:0}]};
    if(sql.includes('RETURNING installation_id'))return {rows:[{installation_id:installation}]};
    return {rows:[]};
  });
  const payload={installationId:installation,token:rawToken,platform:'ios'};
  assert.deepEqual(await registerReminderDevice(query,auth,payload,{env}),{ok:true});
  const insert=calls.find(c=>c.sql.startsWith('INSERT INTO daily_reminder_devices'));
  assert.ok(insert);
  assert.equal(insert.args[1],user);
  assert.equal(insert.args[2],sessionHash);
  assert.equal(insert.args[4],createHash('sha256').update(rawToken).digest('hex'));
  assert.notEqual(insert.args[5],rawToken);
  assert.ok(!JSON.stringify(calls).includes(rawToken));
  assert.match(insert.sql,/auth_user_id=EXCLUDED.auth_user_id OR daily_reminder_devices.revoked_at IS NOT NULL/);
  await unregisterReminderDevice(query,auth,{installationId:installation});
  const revoke=calls.find(c=>c.sql.startsWith('UPDATE daily_reminder_devices SET revoked_at=now()')&&c.args[1]===user);
  assert.ok(revoke);
  await revokeReminderSessionDevices(query,auth);
  assert.ok(calls.some(c=>c.sql.includes('WHERE session_hash=$1')&&c.args[0]===sessionHash));
});
test('device cap cannot be bypassed by adding a sixth active installation',async()=>{
  const {query,calls}=qRecorder(sql=>sql.startsWith('SELECT count(*)')?{rows:[{count:5}]}:{rows:[]});
  await assert.rejects(registerReminderDevice(query,auth,
    {installationId:installation,token:'ExpoPushToken['+'a'.repeat(25)+']',platform:'android'},{env}),/five devices/);
  assert.ok(!calls.some(c=>c.sql.startsWith('INSERT INTO daily_reminder_devices')));
});
function deliveryFixture({enabled=true,channel='email',stale=false,finish=false,providerFailure=false}={}) {
  const now=Date.now(), dueAt=new Date(now-(stale?21*60000:1000));
  const id=randomUUID(),calls=[],fetches=[];
  let claimed=false;
  const row={id,auth_user_id:user,channel,installation_id:channel==='push'?installation:null,
    local_day:'2026-10-18',schedule_version:1,current_version:1,
    state:'queued',created_at:dueAt,email_enabled:channel==='email',
    push_enabled:channel==='push',device_owner:user,device_revoked:null,token_ciphertext:null,
    unsubscribe_nonce:installation,suppressed_email_hash:null};
  const settings={auth_user_id:user,...schedule,frequency:'daily',weekdays:[1],
    local_time:'09:00',time_zone:'America/Chicago',schedule_version:1,email_enabled:channel==='email',
    push_enabled:channel==='push',next_due_at:dueAt};
  const query=async(sql,args=[])=>{
    calls.push({sql,args});
    if(sql.startsWith('SELECT * FROM daily_reminder_settings WHERE (email_enabled'))return {rows:[settings]};
    if(sql.startsWith('WITH advance AS'))return {rows:claimed?[]:[{id}]};
    if(sql.startsWith('SELECT d.*,s.email_enabled'))return {rows:[row]};
    if(sql.includes('FROM account_deletion_operations'))return {rows:[]};
    if(sql.includes('FROM neon_auth."user"'))return {rows:[{email:'test@example.invalid',email_verified:true}]};
    if(sql.includes('count(DISTINCT s.set_id)'))return {rows:[{completed:finish?3:0}]};
    if(sql.startsWith('UPDATE daily_reminder_deliveries SET state=\'sending\'')){
      if(claimed)return {rows:[]};
      claimed=true;
      return {rows:[{id,attempts:1}]};
    }
    if(sql.startsWith('SELECT id FROM daily_reminder_deliveries WHERE state=\'retry\''))return {rows:[]};
    return {rows:[]};
  };
  const fetcher=async(url,opts)=>{
    fetches.push({url:String(url),opts});
    if(providerFailure)throw Error('Ambiguous provider timeout');
    return Response.json({id:'resend_test_id'});
  };
  return {query,calls,fetches,fetcher,now,row,settings,id};
}
test('dispatcher fails closed until explicitly active and does not query or send',async()=>{
  const f=deliveryFixture();
  const result=await dispatchReminderTick(f.query,'2026-10-18T18:00:00Z',
    {env:{...env,PACK1_DAILY_REMINDERS_ENABLED:'0'},clock:f.now,pacificDay:'2026-10-18',fetcher:f.fetcher});
  assert.equal(result.active,false);
  assert.equal(f.calls.length,0);
});
test('atomic occurrence claiming uses conflict-safe identity and marks provider acceptance only',async()=>{
  const f=deliveryFixture();
  const result=await dispatchReminderTick(f.query,new Date(f.now).toISOString(),
    {env,clock:f.now,pacificDay:'2026-10-18',fetcher:f.fetcher});
  assert.equal(result.accepted,1);
  assert.equal(f.fetches.length,1);
  assert.match(f.fetches[0].url,/api.resend.com\/emails/);
  const request=JSON.parse(f.fetches[0].opts.body);
  assert.deepEqual(request.to,['test@example.invalid']);
  assert.ok(request.text.includes('https://packone.pro/'));
  assert.ok(request.headers['List-Unsubscribe-Post']);
  assert.ok(f.fetches[0].opts.headers['Idempotency-Key'].includes(f.id));
  assert.ok(f.calls.some(c=>c.sql.includes('ON CONFLICT DO NOTHING RETURNING id')));
  assert.ok(f.calls.some(c=>c.sql.includes("state='accepted'")));
  assert.ok(!f.calls.some(c=>c.sql.includes("state='delivered'")));
});
test('no provider send after completed all three current Pacific Dailies',async()=>{
  const f=deliveryFixture({finish:true});
  const result=await dispatchReminderTick(f.query,new Date(f.now).toISOString(),
    {env,clock:f.now,pacificDay:'2026-10-18',fetcher:f.fetcher});
  assert.equal(result.accepted,0);
  assert.equal(f.fetches.length,0);
  assert.ok(f.calls.some(c=>c.sql.includes("state='suppressed'")));
});
test('outage skips stale reminders rather than accumulating a catch-up queue',async()=>{
  const f=deliveryFixture({stale:true});
  const result=await dispatchReminderTick(f.query,new Date(f.now).toISOString(),
    {env,clock:f.now,pacificDay:'2026-10-18',fetcher:f.fetcher});
  assert.equal(result.accepted,0);
  assert.equal(f.fetches.length,0);
  assert.ok(f.calls.some(c=>c.sql.includes("state='suppressed'")));
});
test('ambiguous timeout never produces a second send or a blind retry',async()=>{
  const f=deliveryFixture({providerFailure:true});
  const result=await dispatchReminderTick(f.query,new Date(f.now).toISOString(),
    {env,clock:f.now,pacificDay:'2026-10-18',fetcher:f.fetcher});
  assert.equal(result.uncertain,1);
  assert.equal(f.fetches.length,1);
  assert.ok(f.calls.some(c=>c.sql.includes("state='uncertain'")));
  assert.ok(!f.calls.some(c=>c.sql.includes("state='retry'")));
});
test('unsubscribe GET is not a destructive act; signed POST revokes only email',async()=>{
  const f=deliveryFixture();
  await dispatchReminderTick(f.query,new Date(f.now).toISOString(),
    {env,clock:f.now,pacificDay:'2026-10-18',fetcher:f.fetcher});
  const email=JSON.parse(f.fetches[0].opts.body);
  const link=email.text.split('Unsubscribe: ')[1].trim().replace('/growth/v1/','/v1/');
  const extra=[];
  const query=async(sql,args=[])=>{
    extra.push({sql,args});
    if(sql.startsWith('SELECT * FROM daily_reminder_settings'))return {rows:[{unsubscribe_nonce:installation,auth_user_id:user}]};
    if(sql.startsWith('UPDATE daily_reminder_settings'))return {rows:[{auth_user_id:user}]};
    return {rows:[]};
  };
  const args={query,json:x=>Response.json(x),readJson:async()=>({}),authBrowser:async()=>auth,authMutation:async()=>auth,authMobile:async()=>({auth}),trigger:()=>false,pacificDay:'2026-10-18',env};
  const get=await reminderRoute(new Request(link,{method:'GET'}),args);
  assert.equal(get.status,200);
  assert.equal(extra.some(call=>call.sql.startsWith('UPDATE')),false);
  const post=await reminderRoute(new Request(link,{method:'POST'}),args);
  assert.equal(post.status,200);
  const revoke=extra.find(call=>call.sql.startsWith('UPDATE daily_reminder_settings'));
  assert.match(revoke.sql,/email_enabled=false/);
  assert.doesNotMatch(revoke.sql,/push_enabled=false/);
  assert.deepEqual(revoke.args,[user,installation]);
});
test('Resend webhook requires correct body signature and timestamp',()=>{
  const raw=JSON.stringify({type:'email.delivered',data:{email_id:'test-provider-id'}});
  const id='msg_test_fixture',timestamp=Math.floor(Date.now()/1000).toString();
  const secret=Buffer.from(env.PACK1_REMINDER_RESEND_WEBHOOK_SECRET.slice(6),'base64');
  const signature=createHmac('sha256',secret).update(id+'.'+timestamp+'.'+raw).digest('base64');
  const request=new Request('https://api.test/v1/reminders/provider-event',{method:'POST',body:raw,
    headers:{'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature}});
  assert.doesNotThrow(()=>verifyReminderWebhook(request,raw,env));
  assert.throws(()=>verifyReminderWebhook(request,raw.replace('delivered','bounced'),env),/Webhook/);
  const stale=new Request(request.url,{method:'POST',body:raw,headers:{
    'svix-id':id,'svix-timestamp':(Number(timestamp)-7200).toString(),'svix-signature':'v1,'+signature,
  }});
  assert.throws(()=>verifyReminderWebhook(stale,raw,env),/Webhook/);
});
test('schema is default-off, account-owned, and delete lifecycle cleans private reminder tables',()=>{
  const migration=fs.readFileSync('migrations/0061_daily_reminders.sql','utf8');
  const deletion=fs.readFileSync('worker/account-deletion.mjs','utf8');
  const ingress=fs.readFileSync('edge/gateway.mjs','utf8');
  assert.match(migration,/email_enabled boolean NOT NULL DEFAULT false/);
  assert.match(migration,/push_enabled boolean NOT NULL DEFAULT false/);
  assert.match(migration,/REFERENCES neon_auth\."user"\(id\) ON DELETE CASCADE/);
  assert.match(migration,/UNIQUE NULLS NOT DISTINCT/);
  for(const table of ['daily_reminder_deliveries','daily_reminder_settings','daily_reminder_devices','daily_reminder_changes'])
    assert.ok(deletion.includes('DELETE FROM '+table),table);
  assert.match(ingress,/\/v1\/reminders\/provider-event/);
  assert.deepEqual(NEON_REMINDER_SCHEDULERS.map(x=>x.name),['pack1-daily-reminders']);
});
