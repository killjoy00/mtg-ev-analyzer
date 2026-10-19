// Unit boundaries and provider protocol fixtures. Atomic SQL behavior is tested
// separately, mandatorily, against PostgreSQL in daily-reminders-postgres.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {
  reminderSnapshot,updateReminderSettings,registerReminderDevice,unregisterReminderDevice,
  revokeReminderSessionDevices,dispatchDailyReminders,verifyReminderWebhook,reminderRoute,reminderReadiness,DAILY_REMINDER_CRON,
} from '../worker/daily-reminders.mjs';
import {NEON_SCHEDULERS} from '../scripts/reconcile-neon-schedulers.mjs';
import {gameDateKey} from '../game-date.mjs';
const user='11111111-1111-4111-8111-111111111111',installation='22222222-2222-4222-8222-222222222222';
const sessionHash='a'.repeat(64);
const env={PACK1_RATE_LIMIT_SECRET:'test-secret-not-for-deployment-0000000',PACK1_REMINDER_TOKEN_KEY:'b'.repeat(64),
  PACK1_REMINDER_RESEND_WEBHOOK_SECRET:'whsec_'+Buffer.from('fake-webhook-secret-only-for-tests').toString('base64'),
  PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_testing_only',PACK1_REMINDER_EMAIL_ENABLED:'1',PACK1_REMINDER_PUSH_ENABLED:'0'};
const schedule={frequency:'daily',weekdays:[1],localTime:'09:00',timeZone:'America/Chicago'};
const auth={user_id:user,session_hash:sessionHash,source:'mobile'};
function recorder(callback=()=>({rows:[]})) {
  const calls=[];
  return {calls,query:async(sql,args=[])=>{calls.push({sql,args});return callback(sql,args)||{rows:[]};}};
}
function accountFixture({verified=true,error=null}={}) {
  return recorder(sql=>{
    if(sql.includes('FROM neon_auth."user"'))return {rows:[{email:'fixture@example.invalid',email_verified:verified}]};
    if(sql.includes('pack1_reminder_save_settings')){if(error)throw Error(error);return {rows:[{auth_user_id:user}]};}
    return {rows:[]};
  });
}
test('unconfigured account has independent default-off channels and no fabricated delivery evidence',async()=>{
  const f=accountFixture(),s=await reminderSnapshot(f.query,user,{env});
  assert.equal(s.email.enabled,false);assert.equal(s.push.enabled,false);assert.equal(s.nextAt,null);
  assert.equal(s.email.deliveredAt,null);assert.equal(s.push.providerAcceptedAt,null);assert.equal(s.email.eligible,true);
});
test('unverified email, arbitrary recipients and cross-account stale edits are rejected',async()=>{
  const f=accountFixture({verified:false});
  await assert.rejects(updateReminderSettings(f.query,auth,{...schedule,channel:'email',enabled:true},{env}),e=>e.status===403);
  await assert.rejects(updateReminderSettings(f.query,auth,{...schedule,channel:'email',enabled:true,email:'other@example.invalid'},{env}),e=>e.status===400);
  await assert.rejects(updateReminderSettings(f.query,auth,{...schedule,channel:'email',enabled:true,expectedAccountId:installation},{env}),e=>e.status===409);
  assert.ok(!f.calls.some(c=>c.sql.includes('pack1_reminder_save_settings')));
});
test('validated settings use one account-owned atomic operation, not a client-owned destination',async()=>{
  const f=accountFixture();await updateReminderSettings(f.query,auth,{...schedule,channel:'email',enabled:true},{env});
  const writes=f.calls.filter(c=>c.sql.includes('pack1_reminder_save_settings'));assert.equal(writes.length,1);
  assert.equal(writes[0].args[0],user);assert.equal(writes[0].args[5],'email');assert.equal(writes[0].args[6],'true');
  assert.equal(writes[0].args[9],'fixture@example.invalid');assert.match(writes[0].args[8],/^[a-f0-9]{64}$/);
});
test('database rejection of missing push device, suppression and deletion is preserved',async()=>{
  for(const [error,channel,status] of [['REMINDER_DEVICE_REQUIRED','push',409],['REMINDER_EMAIL_SUPPRESSED','email',409]]) {
    const f=accountFixture({error});await assert.rejects(updateReminderSettings(f.query,auth,{...schedule,channel,enabled:true},{env}),e=>e.status===status&&e.reminderSafe===true);
  }
  await assert.rejects(updateReminderSettings(async()=>({rows:[]}),auth,{channel:'email',enabled:false},{env}),e=>e.code==='ACCOUNT_DELETING');
});
test('immediate opt-out does not depend on an unsaved invalid schedule',async()=>{
  const f=accountFixture();await updateReminderSettings(f.query,auth,{channel:'email',enabled:false,localTime:'invalid',timeZone:'bad',weekdays:[]},{env});
  const write=f.calls.find(c=>c.sql.includes('pack1_reminder_save_settings'));assert.equal(write.args[6],'false');assert.equal(write.args[9],null);
});
test('invalid/native-vs-browser device registration is rejected before SQL',async()=>{
  const f=recorder(),value={installationId:installation,token:'ExpoPushToken['+'x'.repeat(32)+']',platform:'ios'};
  for(const [owner,payload] of [[{...auth,source:'cookie'},value],[auth,{...value,token:'bad'}],[auth,{...value,installationId:'bad'}],[auth,{...value,bindingSecret:'bad'}],[auth,{...value,registrationVersion:-1}]])
    await assert.rejects(registerReminderDevice(f.query,owner,payload,{env}),e=>[400,401].includes(e.status));
  assert.equal(f.calls.length,0);
});
test('device token is encrypted and binding secret is server-issued and hashed in SQL',async()=>{
  const f=recorder(sql=>sql.includes('pack1_reminder_register_device')?{rows:[{result:JSON.stringify({ok:true,registrationVersion:1,secretCreated:true})}]}:{rows:[{result:JSON.stringify({ok:true,registrationVersion:2})}]});
  const token='ExpoPushToken['+'x'.repeat(32)+']';
  const registered=await registerReminderDevice(f.query,auth,{installationId:installation,token,platform:'ios',explicitEnable:true},{env});
  assert.match(registered.bindingSecret,/^[A-Za-z0-9_-]{43}$/);assert.equal(registered.registrationVersion,1);
  const inserted=f.calls[0];assert.equal(inserted.args[1],user);assert.equal(inserted.args[2],sessionHash);
  assert.equal(inserted.args[4],createHash('sha256').update(token).digest('hex'));
  assert.notEqual(inserted.args[5],token);assert.equal(inserted.args[6],createHash('sha256').update(registered.bindingSecret).digest('hex'));
  assert.ok(!JSON.stringify(f.calls).includes(token));assert.ok(!JSON.stringify(f.calls).includes(registered.bindingSecret));
  await unregisterReminderDevice(f.query,auth,{installationId:installation});assert.deepEqual(f.calls[1].args,[user,installation]);
  await revokeReminderSessionDevices(f.query,auth);assert.deepEqual(f.calls[2].args,[user,sessionHash]);
});
test('atomic device cap and stale-version errors are actionable without leaking token material',async()=>{
  for(const code of ['DEVICE_LIMIT','DEVICE_VERSION_CHANGED','DEVICE_PROOF_REQUIRED']) {
    const f=recorder(()=>({rows:[{result:{error:code}}]}));
    await assert.rejects(registerReminderDevice(f.query,auth,{installationId:installation,token:'ExpoPushToken['+'x'.repeat(32)+']',platform:'ios'},{env}),e=>e.status===409&&e.code===code&&!e.message.includes('ExpoPushToken'));
  }
});
const fingerprint=createHmac('sha256',env.PACK1_RATE_LIMIT_SECRET).update('pack1-reminder-email:fixture@example.invalid').digest('hex');
// One opted-in account; the daily job admits it in SQL, then sends one provider batch.
function deliveryFixture({admission='claimed',providerFailure=false,responses=[200],destination=fingerprint,data}={}) {
  const id=randomUUID(),calls=[],fetches=[],now=Date.now();let state='none';
  const query=async(sql,args=[])=>{
    calls.push({sql,args});
    if(sql.startsWith('SELECT s.auth_user_id,s.email_destination_hash'))
      return {rows:state==='none'?[{auth_user_id:user,email_destination_hash:destination,unsubscribe_nonce:installation,email:'fixture@example.invalid'}]:[]};
    if(sql.includes('pack1_reminder_admit_daily_email')){if(admission!=='claimed'||state!=='none')return {rows:[{id:null}]};state='sending';return {rows:[{id}]};}
    if(sql.includes('pack1_reminder_provider_accepted')){state='accepted';return {rows:[]};}
    if(sql.startsWith('UPDATE daily_reminder_deliveries SET state=$2')&&state==='sending')state=args[1];
    return {rows:[]};
  };
  const fetcher=async(url,options)=>{
    fetches.push({url:String(url),options});
    if(providerFailure)throw Error('controlled timeout');
    const status=responses[Math.min(fetches.length,responses.length)-1];
    return Response.json({data:data??JSON.parse(options.body).map(()=>({id:'synthetic-provider-id'}))},{status,headers:status===429?{'retry-after':'2'}:{}});
  };
  const pauses=[];
  const run=(overrides={})=>dispatchDailyReminders(query,{env,clock:now,pacificDay:gameDateKey(),fetcher,pause:async ms=>{pauses.push(ms);},...overrides});
  return {query,calls,fetches,run,id,pauses,state:()=>state};
}
test('email and push activation are independent and legacy combined switch cannot enable either',()=>{
  assert.equal(reminderReadiness({...env,PACK1_REMINDER_TOKEN_KEY:''}).emailActive,true);
  assert.equal(reminderReadiness({...env,PACK1_REMINDER_TOKEN_KEY:''}).pushReady,false);
  assert.equal(reminderReadiness({...env,PACK1_REMINDER_EMAIL_ENABLED:'0',PACK1_REMINDER_PUSH_ENABLED:'1',PACK1_REMINDER_RESEND_WEBHOOK_SECRET:''}).pushActive,true);
  assert.equal(reminderReadiness({PACK1_DAILY_REMINDERS_ENABLED:'1'}).emailActive,false);
});
test('disabled delivery performs safe reconciliation but never admits or sends',async()=>{
  const f=deliveryFixture();const result=await f.run({env:{...env,PACK1_REMINDER_EMAIL_ENABLED:'0'}});
  assert.equal(result.active,false);assert.equal(f.fetches.length,0);
  assert.ok(!f.calls.some(c=>c.sql.includes('pack1_reminder_admit_daily_email')||c.sql.includes('pack1_reminder_enqueue')));
});
test('one batch request carries homepage, unsubscribe headers, stable key and precommitted correlation tag',async()=>{
  const f=deliveryFixture();const result=await f.run();assert.equal(result.email.accepted,1);assert.equal(f.fetches.length,1);
  const {url,options}=f.fetches[0],batch=JSON.parse(options.body),body=batch[0];assert.equal(url,'https://api.resend.com/emails/batch');
  assert.equal(batch.length,1);assert.equal(body.from,'Pack One <reminders@packone.pro>');
  assert.deepEqual(body.to,['fixture@example.invalid']);assert.ok(body.text.includes('Play now: https://packone.pro/'));
  assert.ok(body.text.includes('https://packone.pro/?account=reminders'));assert.equal(body.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
  assert.match(options.headers['Idempotency-Key'],new RegExp('^pack1-daily-'+gameDateKey()+'-[a-f0-9]{40}$'));assert.deepEqual(body.tags,[{name:'pack1_reminder',value:f.id}]);
  assert.equal(f.state(),'accepted');assert.ok(!f.calls.some(c=>c.sql.includes("SET state='delivered'")));
  assert.ok(!/push|notification/i.test(body.subject+body.text));
});
test('email is branded HTML with readable links and spaced plain text',async()=>{
  const f=deliveryFixture();await f.run();const body=JSON.parse(f.fetches[0].options.body)[0];
  const unsubscribe=body.headers['List-Unsubscribe'].slice(1,-1);
  assert.match(unsubscribe,/^https:\/\/api\.packone\.pro\/growth\/v1\/reminders\/unsubscribe\?token=[A-Za-z0-9_-]{38}$/);
  assert.ok(body.text.includes('all three Dailies.\n\nManage reminders: https://packone.pro/?account=reminders\n\nUnsubscribe: '+unsubscribe));
  assert.match(body.html,/P<sup[^>]*>1<\/sup><\/td><td[^>]*>Pack One<\/td>/);
  assert.ok(body.html.includes('href="https://packone.pro/"'));
  assert.ok(body.html.includes('href="'+unsubscribe+'"')&&body.html.includes('>Unsubscribe</a>'));
  assert.ok(body.html.includes('>Manage reminders</a>'));
  assert.ok(!body.html.includes(unsubscribe+'</a>'),'the unsubscribe URL is never shown as link text');
  assert.ok(!/push|notification|<script|<img/i.test(body.html));
});
test('admission is decided in SQL for today’s Pacific Daily with the current address fingerprint',async()=>{
  const f=deliveryFixture();await f.run();
  const admit=f.calls.find(c=>c.sql.includes('pack1_reminder_admit_daily_email'));
  assert.deepEqual(admit.args,[user,fingerprint,gameDateKey()]);
});
test('database admission refusal and a changed sign-in email never reach the provider',async()=>{
  const refused=deliveryFixture({admission:'refused'});const first=await refused.run();
  assert.equal(refused.fetches.length,0);assert.equal(first.email.skipped,1);
  const changed=deliveryFixture({destination:'0'.repeat(64)});const second=await changed.run();
  assert.equal(changed.fetches.length,0);assert.equal(second.email.skipped,1);
  assert.ok(!changed.calls.some(c=>c.sql.includes('pack1_reminder_admit_daily_email')));
});
test('ambiguous timeout stays uncertain and the same Daily is never resent',async()=>{
  const f=deliveryFixture({providerFailure:true});const first=await f.run();await f.run();
  assert.equal(first.email.uncertain,1);assert.equal(f.fetches.length,1);assert.equal(f.state(),'uncertain');
});
test('rate limit gets one bounded wait; permanent rejection fails and 5xx stays uncertain',async()=>{
  const recovered=deliveryFixture({responses:[429,200]});await recovered.run();
  assert.equal(recovered.fetches.length,2);assert.equal(recovered.state(),'accepted');assert.ok(recovered.pauses.includes(2000));
  assert.equal(recovered.fetches[0].options.headers['Idempotency-Key'],recovered.fetches[1].options.headers['Idempotency-Key']);
  for(const [responses,state,requests] of [[[429,429],'failed',2],[[403],'failed',1],[[503],'uncertain',1]]){
    const f=deliveryFixture({responses});await f.run();assert.equal(f.state(),state);assert.equal(f.fetches.length,requests);
  }
});
test('a provider response that cannot be matched to the batch leaves rows uncertain',async()=>{
  const f=deliveryFixture({data:[]});const result=await f.run();assert.equal(result.email.uncertain,1);assert.equal(f.state(),'uncertain');
});
test('settings save the shared once-daily send and report the next send time',async()=>{
  const f=accountFixture();await updateReminderSettings(f.query,auth,{...schedule,channel:'email',enabled:true},{env});
  const write=f.calls.find(c=>c.sql.includes('pack1_reminder_save_settings'));
  assert.deepEqual(write.args.slice(1,5),['daily','{0,1,2,3,4,5,6}','23:05','Etc/UTC']);
  const enabled=recorder(sql=>sql.startsWith('SELECT * FROM daily_reminder_settings')?{rows:[{email_enabled:true}]}:{rows:[]});
  assert.equal((await reminderSnapshot(enabled.query,user,{env,clock:Date.UTC(2026,9,19,12)})).nextAt,'2026-10-19T23:05:00.000Z');
  assert.equal((await reminderSnapshot(enabled.query,user,{env,clock:Date.UTC(2026,9,19,23,30)})).nextAt,'2026-10-20T23:05:00.000Z');
  assert.equal(NEON_SCHEDULERS.find(row=>row.name==='pack1-daily-reminders').schedule.cron,DAILY_REMINDER_CRON);
  assert.equal(DAILY_REMINDER_CRON,'5 23 * * *');
});
test('a trigger delivered hours late does no reminder work',async()=>{
  const q=recorder(),scheduledAt=new Date(Date.now()-4*60*60*1000).toISOString();
  const response=await reminderRoute(new Request('https://api.test/internal/daily-reminders',{method:'POST',body:'{}'}),{
    query:q.query,json:Response.json,readJson:r=>r.json(),trigger:()=>({scheduledAt}),env,pacificDay:gameDateKey(),
  });
  assert.deepEqual(await response.json(),{ok:true,stale:true});assert.equal(q.calls.length,0);
});
test('unsubscribe GET has no mutation; repeated signed POST uses the stable capability',async()=>{
  const f=deliveryFixture();await f.run();const body=JSON.parse(f.fetches[0].options.body)[0];
  const link=body.headers['List-Unsubscribe'].slice(1,-1).replace('/growth/v1/','/v1/'),q=recorder();
  const args={query:q.query,json:Response.json,env};
  const get=await reminderRoute(new Request(link),args);assert.equal(get.status,200);assert.equal(q.calls.length,0);
  assert.equal(get.headers.get('referrer-policy'),'no-referrer');
  const owner=recorder(sql=>sql.includes('unsubscribe_nonce=$1')?{rows:[{auth_user_id:user}]}:{rows:[]});
  const post={...args,query:owner.query};
  for(let count=0;count<2;count++)assert.equal((await reminderRoute(new Request(link,{method:'POST'}),post)).status,200);
  const writes=owner.calls.filter(call=>call.sql.includes('pack1_reminder_unsubscribe'));
  assert.equal(writes.length,2);assert.ok(writes.every(call=>call.args[0]===user&&call.args[1]===installation));
  assert.ok(owner.calls.filter(call=>!call.sql.includes('pack1_reminder_unsubscribe')).every(call=>call.args[0]===installation));
  await assert.rejects(reminderRoute(new Request(link.replace('token=','token=bad'),{method:'POST'}),post),e=>e.status===400);
  const token=new URL(link).searchParams.get('token'),tampered=token.slice(0,-1)+(token.endsWith('A')?'B':'A');
  await assert.rejects(reminderRoute(new Request(link.replace(token,tampered),{method:'POST'}),post),e=>e.status===400);
  // A deleted account has no settings row: still a harmless success, with no write.
  const gone=recorder();assert.equal((await reminderRoute(new Request(link,{method:'POST'}),{...args,query:gone.query})).status,200);
  assert.ok(!gone.calls.some(call=>call.sql.includes('pack1_reminder_unsubscribe')));
});
test('links in emails sent before short tokens still unsubscribe',async()=>{
  const payload=user+'.'+installation;
  const legacy=Buffer.from(payload).toString('base64url')+'.'+createHmac('sha256',env.PACK1_RATE_LIMIT_SECRET).update('pack1-daily-unsubscribe:'+payload).digest('base64url');
  const q=recorder();
  const response=await reminderRoute(new Request('https://api.test/v1/reminders/unsubscribe?token='+legacy,{method:'POST'}),{query:q.query,json:Response.json,env});
  assert.equal(response.status,200);
  assert.deepEqual(q.calls.map(call=>call.args),[[user,installation]]);
  await assert.rejects(reminderRoute(new Request('https://api.test/v1/reminders/unsubscribe?token='+legacy.slice(0,-2)+'xx',{method:'POST'}),{query:q.query,json:Response.json,env}),e=>e.status===400);
});
function signed(raw,changes={}) {
  const id='msg_test',timestamp=String(Math.floor(Date.now()/1000));
  const signature=createHmac('sha256',Buffer.from(env.PACK1_REMINDER_RESEND_WEBHOOK_SECRET.slice(6),'base64')).update(id+'.'+timestamp+'.'+raw).digest('base64');
  return new Request('https://api.test/v1/reminders/provider-event',{method:'POST',body:raw,headers:{'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature,...changes}});
}
test('webhook verification rejects tampering, expired timestamps and missing configuration',()=>{
  const raw=JSON.stringify({type:'email.delivered',data:{email_id:'fixture'}}),request=signed(raw);
  assert.doesNotThrow(()=>verifyReminderWebhook(request,raw,env));
  assert.throws(()=>verifyReminderWebhook(request,raw.replace('delivered','bounced'),env),e=>e.status===403);
  assert.throws(()=>verifyReminderWebhook(signed(raw,{'svix-timestamp':'1000000000'}),raw,env),e=>e.status===403);
  assert.throws(()=>verifyReminderWebhook(request,raw,{}),e=>e.status===403);
});
test('oversized provider payload and malformed destinations are rejected before database writes',async()=>{
  const q=recorder();await assert.rejects(reminderRoute(signed('x'.repeat(32769)),{query:q.query,json:Response.json,env}),e=>e.status===413);
  const raw=JSON.stringify({type:'email.bounced',created_at:new Date().toISOString(),data:{email_id:'fixture',to:['a@example.invalid','b@example.invalid']}});
  await assert.rejects(reminderRoute(signed(raw),{query:q.query,json:Response.json,env}),e=>e.status===400);assert.equal(q.calls.length,0);
});
test('unattested scheduler calls cannot reach database work',async()=>{
  const q=recorder();await assert.rejects(reminderRoute(new Request('https://api.test/internal/daily-reminders',{method:'POST',body:'{}'}),{
    query:q.query,json:Response.json,readJson:r=>r.json(),trigger:()=>null,env,pacificDay:gameDateKey(),
  }),e=>e.status===403);assert.equal(q.calls.length,0);
});
test('mandatory database gate cannot silently skip its advertised file',()=>{
  const workflow=fs.readFileSync('.github/workflows/daily-reminder-contracts.yml','utf8');
  assert.match(workflow,/run: node tests\/daily-reminders-postgres\.mjs/);
  assert.doesNotMatch(workflow,/if .*daily-reminders-postgres|test -f .*daily-reminders-postgres/);
  assert.ok(fs.existsSync('tests/daily-reminders-postgres.mjs'));
  assert.ok(!fs.existsSync('.github/workflows/reminder-source-sync.yml'));
  assert.ok(!fs.existsSync('scripts/reminder-source-sync.patch'));
});
test('private schema and deletion cleanup include durable claims, suppression and events',()=>{
  const migration=fs.readFileSync('migrations/0061_daily_reminders.sql','utf8'),deletion=fs.readFileSync('worker/account-deletion.mjs','utf8');
  assert.match(migration,/email_enabled boolean NOT NULL DEFAULT false/);assert.match(migration,/push_enabled boolean NOT NULL DEFAULT false/);
  assert.match(migration,/UNIQUE NULLS NOT DISTINCT\(auth_user_id,channel,installation_id,game_day\)/);
  for(const table of ['daily_reminder_deliveries','daily_reminder_settings','daily_reminder_devices','daily_reminder_changes','daily_reminder_dispatch_claims','daily_reminder_provider_events','daily_reminder_email_suppressions'])
    assert.ok(deletion.includes('DELETE FROM '+table),table);
  assert.equal(NEON_SCHEDULERS.filter(row=>row.function_path==='/internal/daily-reminders').length,1);
});

test('HTTP reminder editor identity is mandatory before any account mutation',async()=>{
  for(const expectedAccountId of [undefined,installation]) {
    const q=recorder();
    const req=new Request('https://api.test/v1/account/reminders',{method:'PATCH',body:JSON.stringify({channel:'email',enabled:false,expectedAccountId})});
    await assert.rejects(reminderRoute(req,{query:q.query,json:Response.json,readJson:r=>r.json(),authMutation:async()=>auth,env}),e=>e.status===409);
    assert.equal(q.calls.length,0);
  }
});
