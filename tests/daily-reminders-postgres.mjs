// Real PostgreSQL integration tests. No production connection or provider sends.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {fixturePool,textTypes} from './support/postgres-fixture.mjs';
import {reminderSnapshot,updateReminderSettings,dispatchReminderTick,reminderRoute} from '../worker/daily-reminders.mjs';
import {gameDateKey} from '../game-date.mjs';

const pool=fixturePool();
const query=(text,values=[])=>pool.query({text,values,types:textTypes});
const env={PACK1_DAILY_REMINDERS_ENABLED:'1',PACK1_REMINDER_EMAIL_ENABLED:'1',PACK1_REMINDER_PUSH_ENABLED:'0',
  PACK1_RATE_LIMIT_SECRET:'isolated-fixture-signing-key-not-a-real-secret',
  PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_fixture_only',PACK1_REMINDER_RESEND_API_KEY:'re_fixture_only',
  PACK1_REMINDER_RESEND_WEBHOOK_SECRET:'whsec_'+Buffer.from('isolated-fixture-webhook-key').toString('base64')};
const schedule={frequency:'daily',weekdays:[1],localTime:'09:00',timeZone:'Etc/UTC'};
const users=[];
let failures=0,passed=0;
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(error){failures++;console.error('FAIL '+name+': '+(error.code||error.name));}}
async function account(){
  const id=randomUUID();users.push(id);
  await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,true)',[id,'Isolated fixture',id+'@example.invalid']);
  return {user_id:id,source:'cookie'};
}
async function enable(auth,changes={}){
  return updateReminderSettings(query,auth,{...schedule,...changes,channel:'email',enabled:true},{env});
}
async function due(auth){
  await query("UPDATE daily_reminder_settings SET next_due_at=now()-interval '1 minute' WHERE auth_user_id=$1::uuid",[auth.user_id]);
}
function provider(){const calls=[];return {calls,fetcher:async(url,options)=>{calls.push({url:String(url),options});return Response.json({id:randomUUID()});}};}
async function tick(q,send){return dispatchReminderTick(q,new Date().toISOString(),{env,fetcher:send.fetcher,pacificDay:gameDateKey()});}
async function isolate(){await query('UPDATE daily_reminder_settings SET email_enabled=false,push_enabled=false,next_due_at=NULL');}
const routeArgs={query,json:Response.json,readJson:r=>r.json(),env};

try {
  await test('default off and independent consent on real rows',async()=>{
    const a=await account(),s=await reminderSnapshot(query,a.user_id,{env});
    assert.equal(s.email.enabled,false);assert.equal(s.push.enabled,false);
    await enable(a);
    assert.equal((await reminderSnapshot(query,a.user_id,{env})).push.enabled,false);
  });
  await test('ordinary settings edits preserve previous unsubscribe capability',async()=>{
    const a=await account();await enable(a);
    const before=(await query('SELECT unsubscribe_nonce FROM daily_reminder_settings WHERE auth_user_id=$1::uuid',[a.user_id])).rows[0];
    await updateReminderSettings(query,a,{...schedule,channel:'push',enabled:false},{env});
    const after=(await query('SELECT unsubscribe_nonce FROM daily_reminder_settings WHERE auth_user_id=$1::uuid',[a.user_id])).rows[0];
    assert.equal(after.unsubscribe_nonce,before.unsubscribe_nonce);
  });
  await test('concurrent dispatcher invocations accept one occurrence',async()=>{
    await isolate();const a=await account();await enable(a);await due(a);const send=provider();
    await Promise.all([tick(query,send),tick(query,send),tick(query,send)]);
    assert.equal(send.calls.length,1);
  });
  await test('crash after queue insertion is recovered on the next tick',async()=>{
    await isolate();const a=await account();await enable(a);await due(a);const send=provider();let crashed=false;
    const crash=async(sql,args)=>{const result=await query(sql,args);if(!crashed&&sql.includes('WITH advance AS')){crashed=true;throw Error('simulated process exit');}return result;};
    await assert.rejects(()=>tick(crash,send),/simulated process exit/);
    assert.equal(send.calls.length,0);assert.equal(crashed,true);
    await tick(query,send);assert.equal(send.calls.length,1);
    await tick(query,send);assert.equal(send.calls.length,1);
  });
  await test('routine schedule edits cannot send twice on one day',async()=>{
    await isolate();const a=await account();await enable(a);await due(a);const send=provider();await tick(query,send);
    await enable(a,{localTime:'15:00'});await due(a);await tick(query,send);
    assert.equal(send.calls.length,1);
  });
  await test('timezone date changes cannot resend the same Daily reminder',async()=>{
    await isolate();const a=await account();await enable(a,{timeZone:'Pacific/Kiritimati'});await due(a);const send=provider();await tick(query,send);
    await enable(a,{timeZone:'Pacific/Honolulu'});await due(a);await tick(query,send);
    assert.equal(send.calls.length,1);
  });
  await test('old email link and repeated one-click unsubscribe remain harmless',async()=>{
    await isolate();const a=await account();await enable(a);await due(a);const send=provider();await tick(query,send);
    const email=JSON.parse(send.calls[0].options.body);
    const link=email.headers['List-Unsubscribe'].slice(1,-1).replace('/growth/v1/','/v1/');
    await enable(a,{localTime:'11:00'});
    for(let i=0;i<2;i++)assert.equal((await reminderRoute(new Request(link,{method:'POST'}),routeArgs)).status,200);
    assert.equal((await reminderSnapshot(query,a.user_id,{env})).email.enabled,false);
    await due(a);await tick(query,send);assert.equal(send.calls.length,1);
  });
  await test('deletion tombstone wins a concurrently waiting preference write',async()=>{
    await isolate();const a=await account();const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[a.user_id]);
      const pending=enable(a).then(()=>({ok:true}),error=>({error}));
      await client.query('SELECT * FROM pack1_begin_account_deletion($1::uuid,NULL)',[a.user_id]);
      await client.query('COMMIT');
      const result=await pending;assert.equal(result.ok,undefined);assert.equal(result.error?.status,409);
      assert.equal((await query('SELECT 1 FROM daily_reminder_settings WHERE auth_user_id=$1::uuid',[a.user_id])).rows.length,0);
    }finally{await client.query('ROLLBACK');client.release();}
  });
  await test('Auth deletion cascades preferences, audit, devices and delivery rows',async()=>{
    await isolate();const a=await account();await enable(a);const session=randomBytes(32).toString('hex'),device=randomUUID();
    await query("INSERT INTO account_sessions(session_hash,auth_user_id,csrf_hash,expires_at) VALUES($1,$2::uuid,$1,now()+interval '1 day')",[session,a.user_id]);
    await query("INSERT INTO daily_reminder_devices(installation_id,auth_user_id,session_hash,platform,token_hash,token_ciphertext) VALUES($1::uuid,$2::uuid,$3,'ios',$3,'fixture')",[device,a.user_id,session]);
    await due(a);await tick(query,provider());
    await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[a.user_id]);
    for(const table of ['daily_reminder_settings','daily_reminder_devices','daily_reminder_changes','daily_reminder_deliveries'])
      assert.equal((await query('SELECT 1 FROM '+table+' WHERE auth_user_id=$1::uuid',[a.user_id])).rows.length,0);
  });
}finally{
  for(const id of users){await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[id]);await query('DELETE FROM account_deletion_operations WHERE auth_user_id=$1::uuid',[id]);}
  await pool.end();
}
console.log('PostgreSQL reminder contracts: '+passed+' passed, '+failures+' failed.');
if(failures)process.exitCode=1;
