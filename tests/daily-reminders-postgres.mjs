// Real PostgreSQL integration tests. No production connection or provider sends.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHmac,createHash} from 'node:crypto';
import {fixturePool,textTypes,postgresTransport,SQL_CONNECTION} from './support/postgres-fixture.mjs';
import {reminderSnapshot,updateReminderSettings,dispatchDailyReminders,reminderRoute,registerReminderDevice,unregisterReminderDevice,revokeReminderSessionDevices,reconcileReminderEvents} from '../worker/daily-reminders.mjs';
import {cleanupPackOne} from '../worker/account-deletion.mjs';
import {gameDateKey} from '../game-date.mjs';
import {gateway} from '../edge/gateway.mjs';

const pool=fixturePool();
const query=(text,values=[])=>pool.query({text,values,types:textTypes});
const env={PACK1_DAILY_REMINDERS_ENABLED:'1',PACK1_REMINDER_EMAIL_ENABLED:'1',PACK1_REMINDER_PUSH_ENABLED:'0',
  PACK1_RATE_LIMIT_SECRET:'isolated-fixture-signing-key-not-a-real-secret',
  PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_fixture_only',PACK1_REMINDER_RESEND_API_KEY:'re_fixture_only',
  PACK1_REMINDER_RESEND_WEBHOOK_SECRET:'whsec_'+Buffer.from('isolated-fixture-webhook-key').toString('base64')};
const schedule={frequency:'daily',weekdays:[1],localTime:'09:00',timeZone:'Etc/UTC'};
const users=[],players=[];
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
// Records each email of each batch request, and accepts every one.
function provider(){
  const calls=[],batches=[];
  return {calls,batches,fetcher:async(url,options)=>{
    const batch=JSON.parse(options.body);batches.push({url:String(url),options});
    for(const email of batch)calls.push({url:String(url),options,email});
    return Response.json({data:batch.map(()=>({id:randomUUID()}))});
  }};
}
const dispatch=(q,{fetcher,...options}={})=>dispatchDailyReminders(q,{env,fetcher,pacificDay:gameDateKey(),pause:async()=>{},...options});
async function tick(q,send){return dispatch(q,{fetcher:send.fetcher});}
async function completeDaily(player,{day=gameDateKey(),environments=['mixed','powered-cube','latest'],answered=10,account=null}={}) {
  const puzzles=JSON.stringify(Array.from({length:10},(_,i)=>'fixture-puzzle-'+i));
  for(const environment of environments)await query(`INSERT INTO draft_run_sessions(player_id,day,environment,seed,corpus_version,scoring_version,puzzle_ids,answers,seen_sources,daily_account_id)
    VALUES($1::uuid,$2::date,$3,'fixture','fixture','fixture',$4::jsonb,$5::jsonb,'[]'::jsonb,$6::uuid)`,
    [player,day,environment,puzzles,JSON.stringify(Array.from({length:answered},(_,i)=>i)),account]);
}
async function linkedPlayer(a) {
  const player=randomUUID();players.push(player);
  await query("INSERT INTO players(id,display_name) VALUES($1::uuid,'Fixture player')",[player]);
  await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[a.user_id,player]);
  return player;
}
async function isolate(){await query('UPDATE daily_reminder_settings SET email_enabled=false,push_enabled=false,next_due_at=NULL');await query('DELETE FROM daily_reminder_rate_limits');}
const routeArgs={query,json:Response.json,readJson:r=>r.json(),env};
const pushEnv={...env,PACK1_REMINDER_PUSH_ENABLED:'1',PACK1_REMINDER_TOKEN_KEY:'b'.repeat(64)};
const json=value=>typeof value==='string'?JSON.parse(value):value;
async function delivery(a) {return (await query('SELECT * FROM daily_reminder_deliveries WHERE auth_user_id=$1::uuid ORDER BY created_at DESC LIMIT 1',[a.user_id])).rows[0];}
async function native(a) {
  const session=randomBytes(32).toString('hex');
  await query("INSERT INTO account_sessions(session_hash,auth_user_id,csrf_hash,expires_at) VALUES($1,$2::uuid,$1,now()+interval '1 day')",[session,a.user_id]);
  return {...a,source:'mobile',session_hash:session};
}
async function device(a,overrides={}) {
  const payload={installationId:randomUUID(),token:'ExpoPushToken['+randomBytes(24).toString('base64url')+']',platform:'ios',...overrides};
  const registered=await registerReminderDevice(query,a,payload,{env:pushEnv});
  return {...payload,...registered};
}
function eventRequest(type,providerId,{id='msg_'+randomBytes(16).toString('hex'),hint,recipient,at=new Date().toISOString()}={}) {
  const raw=JSON.stringify({type,created_at:at,data:{email_id:providerId,...(hint?{tags:{pack1_reminder:hint}}:{}),...(recipient?{to:[recipient]}:{})}});
  const timestamp=String(Math.floor(Date.now()/1000));
  const signature=createHmac('sha256',Buffer.from(env.PACK1_REMINDER_RESEND_WEBHOOK_SECRET.slice(6),'base64')).update(id+'.'+timestamp+'.'+raw).digest('base64');
  return new Request('https://api.test/v1/reminders/provider-event',{method:'POST',body:raw,headers:{'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature}});
}
async function event(type,providerId,options={}) {return reminderRoute(eventRequest(type,providerId,options),routeArgs);}
async function enqueue(a,{push=false}={}) {
  await due(a);
  const row=(await query('SELECT * FROM daily_reminder_settings WHERE auth_user_id=$1::uuid',[a.user_id])).rows[0];
  const localDay=new Intl.DateTimeFormat('en-CA',{timeZone:row.time_zone}).format(new Date(row.next_due_at));
  await query("SELECT pack1_reminder_enqueue($1::uuid,$2::bigint,$3::timestamptz,now()+interval '1 day',$4::date,true,$5::boolean)",[a.user_id,row.schedule_version,row.next_due_at,localDay,String(push)]);
  return delivery(a);
}


try {
  await test('real gateway/worker/PostgreSQL enforces cookie ownership, CSRF, expected account and one-click unsubscribe',async()=>{
    await isolate();const a=await account(),b=await account(),secret='c'.repeat(64),csrf=randomBytes(32).toString('base64url');
    const token=randomBytes(32).toString('base64url'),tokenB=randomBytes(32).toString('base64url');
    const digest=value=>createHash('sha256').update(value).digest('hex');
    for(const [owner,value] of [[a,token],[b,tokenB]])await query("INSERT INTO account_sessions(session_hash,auth_user_id,csrf_hash,expires_at) VALUES($1,$2::uuid,$3,now()+interval '1 day')",[digest(value),owner.user_id,digest(csrf)]);
    const previousFetch=globalThis.fetch,keys=['DATABASE_URL','PACK1_REQUIRE_INGRESS','PACK1_INGRESS_SECRET',...Object.keys(env)],oldEnv=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
    Object.assign(process.env,env,{DATABASE_URL:SQL_CONNECTION,PACK1_REQUIRE_INGRESS:'1',PACK1_INGRESS_SECRET:secret});
    globalThis.fetch=postgresTransport(pool);
    const edge={MODE:'preview',NEON_BRANCH_ID:'br-reminder-fixture',QUOTA_KEY:secret,PREVIEW_KEY:secret,ORIGIN_SECRET:secret,
      NETWORK_QUOTA:{idFromName:value=>value,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
    try {
      const {default:worker}=await import('../worker/growth-function.js');
      const request=async(path,{method='GET',body,session=token,proof=csrf,origin='https://packone.pro'}={})=>{
        const headers={'content-type':'application/json','x-pack1-preview-key':secret,'cf-connecting-ip':'192.0.2.1',origin};
        if(session)headers.cookie='__Host-pack1_account='+session;if(proof)headers['x-pack1-csrf']=proof;
        return gateway(new Request('https://api-preview.packone.pro/growth'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),edge,async(url,options)=>{
          assert.equal(new URL(url).hostname,'br-reminder-fixture-pack1growth.compute.c-5.us-east-2.aws.neon.tech');
          return worker.fetch(new Request(url,options));
        });
      };
      assert.equal((await (await request('/v1/account/reminders')).json()).email.enabled,false);
      const edit={...schedule,channel:'email',enabled:true,expectedAccountId:a.user_id};
      assert.equal((await request('/v1/account/reminders',{method:'PATCH',body:edit,proof:null})).status,403);
      assert.equal((await request('/v1/account/reminders',{method:'PATCH',body:{...edit,expectedAccountId:b.user_id}})).status,409);
      assert.equal((await request('/v1/account/reminders',{method:'PATCH',body:{...edit,email:'other@example.invalid'}})).status,400);
      const saved=await request('/v1/account/reminders',{method:'PATCH',body:edit});assert.equal(saved.status,200);assert.equal((await saved.json()).email.enabled,true);
      assert.equal((await request('/v1/account/reminders',{method:'PATCH',body:edit,session:tokenB})).status,409);
      assert.equal((await (await request('/v1/account/reminders',{session:tokenB})).json()).email.enabled,false);
      assert.equal((await request('/v1/account/reminders',{session:null})).status,401);
      await due(a);const send=provider();await tick(query,send);assert.equal(send.calls.length,1);
      const email=send.calls[0].email,url=new URL(email.text.split('Unsubscribe: ')[1].trim());
      const path=url.pathname.replace('/growth','')+url.search;
      const get=await request(path,{session:null});assert.equal(get.status,200);assert.match(get.headers.get('content-security-policy'),/form-action 'self'/);
      assert.equal((await reminderSnapshot(query,a.user_id,{env})).email.enabled,true);
      for(let count=0;count<2;count++)assert.equal((await request(path,{method:'POST',session:null,proof:null,origin:'https://api-preview.packone.pro'})).status,200);
      assert.equal((await reminderSnapshot(query,a.user_id,{env})).email.enabled,false);
      assert.equal((await request('/v1/reminders/provider-event',{method:'POST',session:null,body:{type:'email.bounced'}})).status,403);
    } finally {
      globalThis.fetch=previousFetch;for(const key of keys)if(oldEnv[key]===undefined)delete process.env[key];else process.env[key]=oldEnv[key];
    }
  });
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
  await test('a crash between admission and send never sends that Daily twice',async()=>{
    await isolate();const a=await account();await enable(a);const send=provider();let crashed=false;
    const crash=async(sql,args)=>{const result=await query(sql,args);if(!crashed&&sql.includes('pack1_reminder_admit_daily_email')){crashed=true;throw Error('simulated process exit');}return result;};
    await assert.rejects(()=>tick(crash,send),/simulated process exit/);
    assert.equal(send.calls.length,0);assert.equal(crashed,true);assert.equal((await delivery(a)).state,'sending');
    await tick(query,send);assert.equal(send.calls.length,0);
    await query("UPDATE daily_reminder_deliveries SET last_attempt_at=now()-interval '3 minutes' WHERE auth_user_id=$1::uuid",[a.user_id]);
    await tick(query,send);assert.equal(send.calls.length,0);assert.equal((await delivery(a)).state,'uncertain');
  });
  await test('turning reminders off and on cannot send twice on one Daily',async()=>{
    await isolate();const a=await account();await enable(a);const send=provider();await tick(query,send);
    await updateReminderSettings(query,a,{channel:'email',enabled:false},{env});await enable(a);await tick(query,send);
    assert.equal(send.calls.length,1);
  });
  await test('client schedule fields are ignored; every account shares the once-daily send',async()=>{
    await isolate();const a=await account();await enable(a,{timeZone:'Pacific/Kiritimati',localTime:'06:00',weekdays:[2]});
    const row=(await query('SELECT frequency,local_time,time_zone FROM daily_reminder_settings WHERE auth_user_id=$1::uuid',[a.user_id])).rows[0];
    assert.deepEqual({...row},{frequency:'daily',local_time:'23:05',time_zone:'Etc/UTC'});
    assert.equal(new Date((await reminderSnapshot(query,a.user_id,{env})).nextAt).toISOString().slice(11,16),'23:05');
  });
  await test('old email link and repeated one-click unsubscribe remain harmless',async()=>{
    await isolate();const a=await account();await enable(a);const send=provider();await tick(query,send);
    const email=send.calls[0].email;
    const link=email.headers['List-Unsubscribe'].slice(1,-1).replace('/growth/v1/','/v1/');
    await enable(a);
    for(let i=0;i<2;i++)assert.equal((await reminderRoute(new Request(link,{method:'POST'}),routeArgs)).status,200);
    assert.equal((await reminderSnapshot(query,a.user_id,{env})).email.enabled,false);
    // Next Daily: the account is no longer a candidate.
    await query('DELETE FROM daily_reminder_deliveries WHERE auth_user_id=$1::uuid',[a.user_id]);
    await tick(query,send);assert.equal(send.calls.length,1);
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
    await query("INSERT INTO daily_reminder_devices(installation_id,auth_user_id,session_hash,platform,token_hash,token_ciphertext) VALUES($1::uuid,$2::uuid,$3::text,'ios',$4::text,'fixture')",[device,a.user_id,session,session]);
    await due(a);await tick(query,provider());
    await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[a.user_id]);
    for(const table of ['daily_reminder_settings','daily_reminder_devices','daily_reminder_changes','daily_reminder_deliveries'])
      assert.equal((await query('SELECT 1 FROM '+table+' WHERE auth_user_id=$1::uuid',[a.user_id])).rows.length,0);
  });

  await test('email activation needs no native encryption key and leaves unconsented accounts untouched',async()=>{
    await isolate();const yes=await account(),no=await account();await enable(yes);await due(yes);const send=provider();await tick(query,send);
    assert.equal(send.calls.length,1);assert.equal(env.PACK1_REMINDER_TOKEN_KEY,undefined);
    assert.equal((await query('SELECT 1 FROM daily_reminder_settings WHERE auth_user_id=$1::uuid',[no.user_id])).rows.length,0);
  });
  await test('a long outage sends only today’s Daily, never catch-up emails',async()=>{
    await isolate();const a=await account();await enable(a);
    await query("UPDATE daily_reminder_settings SET next_due_at=now()-interval '40 days' WHERE auth_user_id=$1::uuid",[a.user_id]);
    const send=provider();await tick(query,send);await tick(query,send);assert.equal(send.calls.length,1);
    assert.deepEqual((await query('SELECT game_day::text FROM daily_reminder_deliveries WHERE auth_user_id=$1::uuid',[a.user_id])).rows.map(row=>row.game_day),[gameDateKey()]);
    assert.ok(Date.parse((await reminderSnapshot(query,a.user_id,{env})).nextAt)>Date.now());
  });
  await test('legacy queued email work expires without attempting the provider',async()=>{
    await isolate();const a=await account();await enable(a);const d=await enqueue(a);
    await query("UPDATE daily_reminder_deliveries SET due_at=now()-interval '21 minutes' WHERE id=$1::uuid",[d.id]);
    const send=provider();await tick(query,send);assert.equal(send.calls.length,0);assert.equal((await delivery(a)).state,'suppressed');
  });
  await test('explicit opt-out ignores invalid editor values and immediately cancels queued work',async()=>{
    await isolate();const a=await account();await enable(a);
    await updateReminderSettings(query,a,{channel:'email',enabled:false,timeZone:'bad',localTime:'99:99',weekdays:[]},{env});
    const send=provider();await tick(query,send);assert.equal(send.calls.length,0);
    assert.equal((await reminderSnapshot(query,a.user_id,{env})).email.enabled,false);
  });
  await test('parallel daily jobs admit exactly one email per account',async()=>{
    await isolate();const all=await Promise.all(Array.from({length:3},()=>account()));
    for(const a of all)await enable(a);const send=provider();
    await Promise.all(Array.from({length:5},()=>tick(query,send)));assert.equal(send.calls.length,3);
    assert.equal(new Set(send.calls.map(call=>call.email.to[0])).size,3);
  });
  await test('provider 429 gets one bounded wait with the same batch and idempotency key',async()=>{
    await isolate();const a=await account();await enable(a);const requests=[];
    const send={fetcher:async(url,options)=>{requests.push(options);return new Response('{}',{status:429,headers:{'retry-after':'30'}});}};
    await tick(query,send);await tick(query,send);
    assert.equal(requests.length,2);assert.equal(new Set(requests.map(r=>r.headers['Idempotency-Key'])).size,1);
    assert.equal(new Set(requests.map(r=>r.body)).size,1);assert.equal((await delivery(a)).state,'failed');
  });
  await test('one job sends many accounts in provider batches of at most 100',async()=>{
    await isolate();const all=await Promise.all(Array.from({length:120},()=>account()));
    for(const a of all)await enable(a);const send=provider();const result=await tick(query,send);
    assert.deepEqual(send.batches.map(batch=>JSON.parse(batch.options.body).length),[100,20]);
    assert.equal(result.email.accepted,120);
    assert.equal((await query("SELECT count(*) n FROM daily_reminder_deliveries WHERE auth_user_id=ANY($1::uuid[]) AND state='accepted'",[all.map(a=>a.user_id)])).rows[0].n,'120');
  });
  await test('ambiguous provider timeout remains uncertain across later invocations',async()=>{
    await isolate();const a=await account();await enable(a);let sends=0;
    const send={fetcher:async()=>{sends++;throw Error('controlled transport timeout');}};
    await tick(query,send);await tick(query,send);assert.equal(sends,1);assert.equal((await delivery(a)).state,'uncertain');
  });
  await test('provider-accepted crash is reconciled by its signed delivery tag, without resending',async()=>{
    await isolate();const a=await account();await enable(a);await due(a);const send=provider();let interrupted=false;
    const crash=async(sql,args)=>{if(sql.includes('pack1_reminder_provider_accepted')){interrupted=true;throw Error('process persistence interrupted');}return query(sql,args);};
    await tick(crash,send);assert.equal(interrupted,true);const d=await delivery(a);assert.equal(d.state,'uncertain');
    await event('email.delivered','accepted_before_crash',{hint:d.id,recipient:a.user_id+'@example.invalid'});
    assert.equal((await delivery(a)).state,'delivered');await tick(query,send);assert.equal(send.calls.length,1);
  });
  await test('an abandoned sending lease is uncertain, not blindly requeued',async()=>{
    await isolate();const a=await account();await enable(a);const d=await enqueue(a);
    await query("UPDATE daily_reminder_deliveries SET state='sending',attempts=1,started_at=now()-interval '3 minutes',last_attempt_at=now()-interval '3 minutes' WHERE id=$1::uuid",[d.id]);
    const send=provider();await tick(query,send);assert.equal(send.calls.length,0);assert.equal((await delivery(a)).state,'uncertain');
  });
  await test('a webhook arriving before the provider response preserves confirmed delivery',async()=>{
    await isolate();const a=await account();await enable(a);await due(a);const providerId=randomUUID();
    const send={fetcher:async(url,options)=>{
      const [payload]=JSON.parse(options.body);
      await event('email.delivered',providerId,{hint:payload.tags[0].value,recipient:payload.to[0]});
      return Response.json({data:[{id:providerId}]});
    }};
    await tick(query,send);const d=await delivery(a);assert.equal(d.state,'delivered');assert.equal(d.provider_id,providerId);assert.ok(d.delivered_at);
  });
  await test('an early tagged reminder event reconciles before the provider response without a resend',async()=>{
    await isolate();const a=await account();await enable(a);await due(a);const providerId=randomUUID(),eventId='msg_'+randomBytes(12).toString('hex');
    let sends=0;
    const send={fetcher:async(url,options)=>{
      sends++;
      const [payload]=JSON.parse(options.body);
      await event('email.delivered',providerId,{id:eventId,hint:payload.tags[0].value,recipient:payload.to[0]});
      assert.equal((await query('SELECT state FROM daily_reminder_provider_events WHERE event_id=$1',[eventId])).rows[0].state,'applied');
      return Response.json({data:[{id:providerId}]});
    }};
    await tick(query,send);await tick(query,send);
    const d=await delivery(a);
    assert.equal(d.state,'delivered');assert.equal(d.provider_id,providerId);assert.equal(sends,1);
  });
  await test('account-wide webhook ignores unrelated and unknown untagged email without retention',async()=>{
    await isolate();const unrelated=randomUUID(),eventId='msg_'+randomBytes(12).toString('hex');
    const ignored=await event('email.delivered',unrelated,{id:eventId,recipient:'other@example.invalid'});
    assert.deepEqual(await ignored.json(),{ok:true,ignored:true});
    assert.equal((await query('SELECT 1 FROM daily_reminder_provider_events WHERE event_id=$1',[eventId])).rows.length,0);
    const a=await account();await enable(a);await due(a);await tick(query,provider());const d=await delivery(a);
    await event('email.delivered',d.provider_id,{recipient:a.user_id+'@example.invalid'});
    assert.equal((await delivery(a)).state,'delivered');
  });
  await test('an old bounce suppresses only the destination that was actually sent',async()=>{
    await isolate();const a=await account();await enable(a);await due(a);await tick(query,provider());const d=await delivery(a);
    await query('UPDATE neon_auth."user" SET email=$2 WHERE id=$1::uuid',[a.user_id,'new-'+a.user_id+'@example.invalid']);
    await enable(a);
    await event('email.bounced',d.provider_id,{hint:d.id,recipient:a.user_id+'@example.invalid'});
    const snapshot=await reminderSnapshot(query,a.user_id,{env});assert.equal(snapshot.email.enabled,true);assert.equal(snapshot.email.suppressed,false);
    const suppression=(await query('SELECT destination_hash FROM daily_reminder_email_suppressions WHERE auth_user_id=$1::uuid',[a.user_id])).rows[0];
    assert.equal(suppression.destination_hash,d.destination_hash);assert.equal((await delivery(a)).state,'failed');
  });
  await test('email address changes require a fresh explicit email consent before dispatch',async()=>{
    await isolate();const a=await account();await enable(a);
    await query('UPDATE neon_auth."user" SET email=$2 WHERE id=$1::uuid',[a.user_id,'new-'+a.user_id+'@example.invalid']);
    const send=provider();await tick(query,send);assert.equal(send.calls.length,0);
    assert.equal((await query('SELECT 1 FROM daily_reminder_deliveries WHERE auth_user_id=$1::uuid',[a.user_id])).rows.length,0);
    assert.equal((await reminderSnapshot(query,a.user_id,{env})).email.addressChanged,true);
  });
  await test('duplicate and out-of-order events cannot regress status, consent or timestamps',async()=>{
    await isolate();const a=await account();await enable(a);await due(a);await tick(query,provider());const d=await delivery(a);
    const before=new Date(Date.parse(d.started_at)+10).toISOString(),later=new Date(Date.parse(d.started_at)+20).toISOString();
    const id='msg_'+randomBytes(12).toString('hex');
    await event('email.complained',d.provider_id,{id,hint:d.id,recipient:a.user_id+'@example.invalid',at:later});
    const first=(await query('SELECT updated_at FROM daily_reminder_settings WHERE auth_user_id=$1::uuid',[a.user_id])).rows[0].updated_at;
    await event('email.complained',d.provider_id,{id,hint:d.id,recipient:a.user_id+'@example.invalid',at:later});
    await event('email.delivered',d.provider_id,{hint:d.id,recipient:a.user_id+'@example.invalid',at:before});
    await event('email.sent',d.provider_id,{hint:d.id,recipient:a.user_id+'@example.invalid',at:d.started_at});
    await event('email.bounced',d.provider_id,{hint:d.id,recipient:a.user_id+'@example.invalid',at:before});
    const final=await delivery(a);assert.equal(final.state,'failed');assert.equal(final.failure_reason,'complaint');
    assert.equal(Date.parse(final.delivered_at),Date.parse(before));
    const saved=(await query('SELECT * FROM daily_reminder_settings WHERE auth_user_id=$1::uuid',[a.user_id])).rows[0];
    assert.equal(saved.email_enabled,'f');assert.equal(saved.updated_at,first);assert.equal(saved.last_email_delivered_at,null);
    assert.equal((await query("SELECT count(*) n FROM daily_reminder_changes WHERE auth_user_id=$1::uuid AND action='complaint'",[a.user_id])).rows[0].n,'1');
    assert.equal((await query('SELECT reason FROM daily_reminder_email_suppressions WHERE auth_user_id=$1::uuid',[a.user_id])).rows[0].reason,'complaint');
  });
  await test('conflicting event IDs are rejected and do not mutate the original event',async()=>{
    await isolate();const a=await account();await enable(a);await due(a);await tick(query,provider());const d=await delivery(a),id='msg_'+randomBytes(12).toString('hex');
    await event('email.delivered',d.provider_id,{id,hint:d.id});
    await assert.rejects(event('email.bounced',d.provider_id,{id,hint:d.id}),error=>error.status===409);
    assert.equal((await delivery(a)).state,'delivered');
  });
  await test('a signed event for the wrong recipient cannot suppress another destination',async()=>{
    await isolate();const a=await account();await enable(a);await due(a);await tick(query,provider());const d=await delivery(a);
    await event('email.complained',d.provider_id,{hint:d.id,recipient:'different@example.invalid'});
    assert.equal((await reminderSnapshot(query,a.user_id,{env})).email.enabled,true);assert.equal((await delivery(a)).state,'accepted');
  });
  await test('delivery records retain HMACs, not raw addresses or webhook payloads',async()=>{
    await isolate();const a=await account();await enable(a);await due(a);await tick(query,provider());const d=await delivery(a);
    await event('email.bounced',d.provider_id,{hint:d.id,recipient:a.user_id+'@example.invalid'});
    const stored=JSON.stringify((await query('SELECT * FROM daily_reminder_provider_events WHERE delivery_hint=$1::uuid',[d.id])).rows)+JSON.stringify(await delivery(a));
    assert.ok(!stored.includes('@'));assert.match(d.destination_hash,/^[a-f0-9]{64}$/);
    await assert.rejects(enable(a),error=>error.status===409);
  });
  await test('a tombstone committed while dispatch waits prevents provider access',async()=>{
    await isolate();const a=await account();await enable(a);const lock=await pool.connect();const send=provider();
    try {
      await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[a.user_id]);
      const pending=tick(query,send);
      await lock.query('SELECT * FROM pack1_begin_account_deletion($1::uuid,NULL)',[a.user_id]);await lock.query('COMMIT');await pending;
      assert.equal(send.calls.length,0);
    }finally{await lock.query('ROLLBACK');lock.release();}
  });
  await test('unsubscribe committed while dispatch waits prevents provider access',async()=>{
    await isolate();const a=await account();await enable(a);const lock=await pool.connect(),send=provider();
    try {
      await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[a.user_id]);
      const pending=tick(query,send);
      await lock.query('SELECT pack1_reminder_unsubscribe($1::uuid,(SELECT unsubscribe_nonce FROM daily_reminder_settings WHERE auth_user_id=$1::uuid))',[a.user_id]);
      await lock.query('COMMIT');await pending;assert.equal(send.calls.length,0);
    }finally{await lock.query('ROLLBACK');lock.release();}
  });
  await test('invalid-token receipts cannot revoke a newer rotated registration',async()=>{
    await isolate();const a=await native(await account()),registered=await device(a);
    await updateReminderSettings(query,a,{...schedule,channel:'push',enabled:true},{env:pushEnv});await enqueue(a,{push:true});const d=await delivery(a);
    await query("UPDATE daily_reminder_deliveries SET state='accepted',provider_id=$2,accepted_at=now()-interval '16 minutes' WHERE id=$1::uuid",[d.id,'old_push_receipt']);
    const rotated=await device(a,{installationId:registered.installationId,bindingSecret:registered.bindingSecret,registrationVersion:registered.registrationVersion});
    const fetcher=async()=>Response.json({data:{old_push_receipt:{status:'error',details:{error:'DeviceNotRegistered'}}}});
    await dispatch(query,{fetcher});
    const row=(await query('SELECT * FROM daily_reminder_devices WHERE installation_id=$1::uuid',[registered.installationId])).rows[0];
    assert.equal(row.revoked_at,null);assert.equal(Number(row.registration_version),rotated.registrationVersion);
  });
  await test('another account cannot steal a registration with its public installation label',async()=>{
    await isolate();const a=await native(await account()),b=await native(await account()),registered=await device(a);
    await assert.rejects(device(b,{installationId:registered.installationId}),error=>error.code==='DEVICE_PROOF_REQUIRED');
    await unregisterReminderDevice(query,b,{installationId:registered.installationId});
    assert.equal((await query('SELECT revoked_at FROM daily_reminder_devices WHERE installation_id=$1::uuid',[registered.installationId])).rows[0].revoked_at,null);
  });
  await test('account switching invalidates previous account pushes and stale registration requests',async()=>{
    await isolate();const a=await native(await account()),b=await native(await account()),registered=await device(a);
    await updateReminderSettings(query,a,{...schedule,channel:'push',enabled:true},{env:pushEnv});await enqueue(a,{push:true});
    const revoked=await unregisterReminderDevice(query,a,{installationId:registered.installationId});
    const switched=await device(b,{installationId:registered.installationId,bindingSecret:registered.bindingSecret,registrationVersion:Number(revoked.registrationVersion)});
    await assert.rejects(device(a,{...registered}),error=>error.code==='DEVICE_VERSION_CHANGED');
    const send=provider();await dispatch(query,{env:pushEnv,fetcher:send.fetcher});
    assert.equal(send.batches.length,0);assert.equal((await delivery(a)).state,'suppressed');assert.ok(switched.registrationVersion>registered.registrationVersion);
  });
  await test('logout clears protected token material and cancels queued device eligibility',async()=>{
    await isolate();const a=await native(await account()),registered=await device(a);
    await updateReminderSettings(query,a,{...schedule,channel:'push',enabled:true},{env:pushEnv});await enqueue(a,{push:true});
    await revokeReminderSessionDevices(query,a);
    const row=(await query('SELECT * FROM daily_reminder_devices WHERE installation_id=$1::uuid',[registered.installationId])).rows[0];
    assert.equal(row.token_ciphertext,'');assert.ok(row.revoked_at);
    const send=provider();await dispatch(query,{env:pushEnv,fetcher:send.fetcher});assert.equal(send.batches.length,0);
  });
  await test('registration blocked on deletion lock cannot attach after deletion begins',async()=>{
    await isolate();const a=await native(await account()),lock=await pool.connect();
    try {
      await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[a.user_id]);
      const pending=device(a).then(()=>({ok:true}),error=>({error}));
      await lock.query('SELECT * FROM pack1_begin_account_deletion($1::uuid,NULL)',[a.user_id]);await lock.query('COMMIT');
      assert.equal((await pending).error?.status,409);assert.equal((await query('SELECT 1 FROM daily_reminder_devices WHERE auth_user_id=$1::uuid',[a.user_id])).rows.length,0);
    }finally{await lock.query('ROLLBACK');lock.release();}
  });
  await test('suppression and provider events cascade on deletion, and delayed tagged events do not recreate them',async()=>{
    await isolate();const a=await account();await enable(a);await due(a);await tick(query,provider());const d=await delivery(a);
    await event('email.bounced',d.provider_id,{hint:d.id,recipient:a.user_id+'@example.invalid'});
    await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[a.user_id]);
    await event('email.complained',d.provider_id,{hint:d.id,recipient:a.user_id+'@example.invalid'});
    for(const table of ['daily_reminder_dispatch_claims','daily_reminder_email_suppressions','daily_reminder_provider_events'])
      assert.equal((await query('SELECT 1 FROM '+table+' WHERE auth_user_id=$1::uuid',[a.user_id])).rows.length,0);
    assert.equal((await query('SELECT 1 FROM daily_reminder_provider_events WHERE delivery_hint=$1::uuid',[d.id])).rows.length,0);
  });
  await test('independent channel changes preserve the other channel and original consent timestamps',async()=>{
    await isolate();const a=await native(await account());await device(a);await enable(a);
    const before=await reminderSnapshot(query,a.user_id,{env:pushEnv});
    await updateReminderSettings(query,a,{...schedule,channel:'push',enabled:true},{env:pushEnv});
    const both=await reminderSnapshot(query,a.user_id,{env:pushEnv});assert.equal(both.email.enabled,true);assert.equal(both.push.enabled,true);
    assert.equal(both.email.consentedAt,before.email.consentedAt);
    await updateReminderSettings(query,a,{channel:'email',enabled:false},{env:pushEnv});
    const pushOnly=await reminderSnapshot(query,a.user_id,{env:pushEnv});assert.equal(pushOnly.push.enabled,true);assert.equal(pushOnly.push.consentedAt,both.push.consentedAt);
  });
  await test('native push remains independent of verified email and email credentials',async()=>{
    await isolate();const a=await native(await account());await query('UPDATE neon_auth."user" SET "emailVerified"=false WHERE id=$1::uuid',[a.user_id]);
    await device(a);const onlyPush={PACK1_REMINDER_PUSH_ENABLED:'1',PACK1_REMINDER_TOKEN_KEY:pushEnv.PACK1_REMINDER_TOKEN_KEY};
    await updateReminderSettings(query,a,{...schedule,channel:'push',enabled:true},{env:onlyPush});await due(a);let sends=0;
    await dispatch(query,{env:onlyPush,fetcher:async(url,options)=>{
      assert.equal(String(url),'https://exp.host/--/api/v2/push/send');const payload=JSON.parse(options.body);assert.equal(payload.data.owner,a.user_id);assert.ok(payload.data.registrationVersion);
      sends++;return Response.json({data:{status:'ok',id:'push-only-fixture'}});
    }});assert.equal(sends,1);assert.equal((await delivery(a)).state,'accepted');assert.equal((await delivery(a)).delivered_at,null);
  });
  await test('account-wide push opt-out revokes sleeping devices; re-enabling one does not resurrect the others',async()=>{
    await isolate();const a=await native(await account()),first=await device(a),second=await device(a);
    await updateReminderSettings(query,a,{...schedule,channel:'push',enabled:true},{env:pushEnv});
    await updateReminderSettings(query,a,{channel:'push',enabled:false},{env:pushEnv});
    assert.equal((await query('SELECT 1 FROM daily_reminder_devices WHERE auth_user_id=$1::uuid AND revoked_at IS NULL',[a.user_id])).rows.length,0);
    assert.equal((await query("SELECT 1 FROM daily_reminder_devices WHERE auth_user_id=$1::uuid AND token_ciphertext<>''",[a.user_id])).rows.length,0);
    await device(a,{...first,explicitEnable:true});
    await updateReminderSettings(query,a,{...schedule,channel:'push',enabled:true},{env:pushEnv});
    await assert.rejects(device(a,{...second,explicitEnable:false}),e=>e.code==='DEVICE_VERSION_CHANGED');
    const active=(await query('SELECT installation_id FROM daily_reminder_devices WHERE auth_user_id=$1::uuid AND revoked_at IS NULL',[a.user_id])).rows;
    assert.deepEqual(active.map(row=>row.installation_id),[first.installationId]);
  });
  await test('concurrent device additions cannot exceed five active devices',async()=>{
    await isolate();const a=await native(await account());const results=await Promise.allSettled(Array.from({length:7},()=>device(a)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,5);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='DEVICE_LIMIT').length,2);
    assert.equal((await query('SELECT count(*) n FROM daily_reminder_devices WHERE auth_user_id=$1::uuid AND revoked_at IS NULL',[a.user_id])).rows[0].n,'5');
  });
  await test('explicit re-enable recovers invalidated device versions without allowing stale background refresh',async()=>{
    await isolate();const a=await native(await account()),registered=await device(a);
    await unregisterReminderDevice(query,a,{installationId:registered.installationId});
    await assert.rejects(device(a,{...registered,explicitEnable:false}),e=>e.code==='DEVICE_VERSION_CHANGED');
    const enabled=await device(a,{...registered,explicitEnable:true});assert.ok(enabled.registrationVersion>registered.registrationVersion);
  });
  for(const count of [2,3])await test(count+' completed Dailies today '+(count===3?'skip':'do not skip')+' the email, ranked or not',async()=>{
    await isolate();const a=await account(),player=await linkedPlayer(a);
    await completeDaily(player,{environments:['mixed','powered-cube','latest'].slice(0,count)});
    await enable(a);const send=provider();await tick(query,send);assert.equal(send.calls.length,count===3?0:1);
    assert.equal((await query('SELECT 1 FROM scores WHERE player_id=$1::uuid',[player])).rows.length,0);
  });
  await test('runs owned by the account itself count, and unfinished runs do not',async()=>{
    await isolate();const owned=await account(),ownedPlayer=randomUUID();players.push(ownedPlayer);
    await query("INSERT INTO players(id,display_name) VALUES($1::uuid,'Fixture player')",[ownedPlayer]);
    await completeDaily(ownedPlayer,{account:owned.user_id});
    const partial=await account(),partialPlayer=await linkedPlayer(partial);
    await completeDaily(partialPlayer,{environments:['mixed','powered-cube']});await completeDaily(partialPlayer,{environments:['latest'],answered:9});
    await enable(owned);await enable(partial);const send=provider();await tick(query,send);
    assert.deepEqual(send.calls.map(call=>call.email.to[0]),[partial.user_id+'@example.invalid']);
  });
  await test('past Daily completions do not skip a new Pacific Daily',async()=>{
    await isolate();const a=await account(),player=await linkedPlayer(a);
    const yesterday=new Date(Date.parse(gameDateKey()+'T12:00:00Z')-86400000).toISOString().slice(0,10);
    await completeDaily(player,{day:yesterday});
    await enable(a);const send=provider();await tick(query,send);assert.equal(send.calls.length,1);
  });
  await test('admission accepts only today’s Pacific Daily, the consented address, and once',async()=>{
    await isolate();const a=await account();await enable(a);
    const hash=(await query('SELECT email_destination_hash h FROM daily_reminder_settings WHERE auth_user_id=$1::uuid',[a.user_id])).rows[0].h;
    const admit=async(destination,day)=>(await query('SELECT pack1_reminder_admit_daily_email($1::uuid,$2::text,$3::date) id',[a.user_id,destination,day])).rows[0].id;
    const yesterday=new Date(Date.parse(gameDateKey()+'T12:00:00Z')-86400000).toISOString().slice(0,10);
    assert.equal(await admit(hash,yesterday),null);assert.equal(await admit('0'.repeat(64),gameDateKey()),null);
    assert.match(await admit(hash,gameDateKey()),/^[0-9a-f-]{36}$/);assert.equal(await admit(hash,gameDateKey()),null);
  });
  await test('bounce after delivered recomputes last successful delivery instead of keeping a stale cache',async()=>{
    await isolate();const a=await account();await enable(a);await due(a);await tick(query,provider());const d=await delivery(a);
    await event('email.delivered',d.provider_id,{hint:d.id});assert.ok((await reminderSnapshot(query,a.user_id,{env})).email.deliveredAt);
    await event('email.bounced',d.provider_id,{hint:d.id});assert.equal((await reminderSnapshot(query,a.user_id,{env})).email.deliveredAt,null);
  });
  await test('deletion cleanup removes reminder data before external Auth removal',async()=>{
    await isolate();const a=await account();await enable(a);await due(a);await tick(query,provider());const d=await delivery(a);
    await event('email.delivered',d.provider_id,{hint:d.id});
    const op=(await query('SELECT * FROM pack1_begin_account_deletion($1::uuid,NULL)',[a.user_id])).rows[0];
    await cleanupPackOne(query,op);
    assert.equal((await query('SELECT 1 FROM neon_auth."user" WHERE id=$1::uuid',[a.user_id])).rows.length,1);
    for(const table of ['daily_reminder_settings','daily_reminder_deliveries','daily_reminder_devices','daily_reminder_changes','daily_reminder_dispatch_claims','daily_reminder_provider_events','daily_reminder_email_suppressions'])
      assert.equal((await query('SELECT 1 FROM '+table+' WHERE auth_user_id=$1::uuid',[a.user_id])).rows.length,0);
  });

}finally{
  for(const id of players){await query('DELETE FROM draft_run_sessions WHERE player_id=$1::uuid',[id]);await query('DELETE FROM players WHERE id=$1::uuid',[id]);}
  for(const id of users){await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[id]);await query('DELETE FROM account_deletion_operations WHERE auth_user_id=$1::uuid',[id]);}
  await pool.end();
}
console.log('PostgreSQL reminder contracts: '+passed+' passed, '+failures+' failed.');
if(failures)process.exitCode=1;
