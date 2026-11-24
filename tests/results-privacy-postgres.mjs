// Real local PostgreSQL, synthetic identities, no provider sends.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHmac,createHash} from 'node:crypto';
import {fixturePool,textTypes,postgresTransport,SQL_CONNECTION} from './support/postgres-fixture.mjs';
import {resultsSnapshot,updateResultsPreferences,prepareResultsEmail,publishableResultsName,recordResultsPublication,resultsAdmin,resultsRoute,resultsEmailHash} from '../worker/results-privacy.mjs';
import {beginDeletion,cleanupPackOne} from '../worker/account-deletion.mjs';
import {gateway} from '../edge/gateway.mjs';
const pool=fixturePool(),query=(text,values=[])=>pool.query({text,values,types:textTypes});
const env={PACK1_RATE_LIMIT_SECRET:'isolated-results-test-key-not-a-real-secret',PACK1_RESULTS_POSTAL_ADDRESS:'Fixture postal address',PACK1_RESULTS_SENDER_NAME:'Pack One',PACK1_RESULTS_SENDER_EMAIL:'fixture@example.invalid',PACK1_RESULTS_RESEND_WEBHOOK_SECRET:'whsec_'+Buffer.from('fixture-webhook-secret').toString('base64')};
const content={subject:'Fixture',text:'Fixture content',html:'<p>Fixture content</p>'};
const accounts=[],players=[];let passed=0;
const json=value=>typeof value==='string'?JSON.parse(value):value;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
async function launch(age='1 second'){await query("UPDATE results_launch SET launch_at=now()-$1::interval WHERE singleton",[age]);}
async function account({old=false,verified=true,linked=true}={}){
 const id=randomUUID();accounts.push(id);
 await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified","createdAt") VALUES($1::uuid,\'Isolated fixture\',$2,$3::boolean,now()-$4::interval)',[id,id+'@example.invalid',verified,old?'40 days':'0 seconds']);
 if(linked){const player=randomUUID();players.push(player);await query('INSERT INTO players(id,display_name,username_owned) VALUES($1::uuid,$2,true)',[player,'Fixture '+player.slice(0,8)]);await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[id,player]);}
 return {user_id:id};
}
const update=(a,action)=>updateResultsPreferences(query,a,{action,expectedAccountId:a.user_id},{env});
const snapshot=a=>resultsSnapshot(query,a.user_id,{env});
const prepare=(a,config=env)=>prepareResultsEmail(query,a.user_id,content,{env:config});
async function changeEmail(a,verified=true){await query('UPDATE neon_auth."user" SET email=$2,"emailVerified"=$3::boolean WHERE id=$1::uuid',[a.user_id,randomUUID()+'@example.invalid',verified]);}
const route=(request,extra={})=>resultsRoute(request,{query,json:Response.json,readJson:r=>r.json(),env,...extra});
function eventRequest(envelope,type='email.bounced',to=envelope.to){
 const raw=JSON.stringify({type,data:{to,tags:envelope.tags}}),id='msg_'+randomBytes(16).toString('hex'),time=String(Math.floor(Date.now()/1000));
 const signature=createHmac('sha256',Buffer.from(env.PACK1_RESULTS_RESEND_WEBHOOK_SECRET.slice(6),'base64')).update(id+'.'+time+'.'+raw).digest('base64');
 return new Request('https://api.test/v1/results/provider-event',{method:'POST',body:raw,headers:{'svix-id':id,'svix-timestamp':time,'svix-signature':'v1,'+signature}});
}
try{
 await test('launch is default off; unanswered is no permission; future launch remains off',async()=>{
  await query('UPDATE results_launch SET launch_at=NULL');const a=await account();assert.equal((await snapshot(a)).active,false);
  await assert.rejects(update(a,'settings:on'),/not available yet/);await assert.rejects(prepare(a),/not permitted/);
  await query("UPDATE results_launch SET launch_at=now()+interval '1 day'");assert.equal((await snapshot(a)).active,false);await assert.rejects(prepare(a),/not permitted/);
  await launch();assert.equal((await snapshot(a)).emailState,'unanswered');await assert.rejects(prepare(a),/not permitted/);
 });
 await test('new prompt is claimed once across concurrent clients; yes/no record independent choices',async()=>{
  await launch();const a=await account(),b=await account();
  const claims=await Promise.all([update(a,'present'),update(a,'present'),update(a,'present')]);assert.equal(claims.filter(x=>x.presentation==='prompt').length,1);
  assert.equal((await update(a,'prompt:on')).emailState,'on');await assert.rejects(update(a,'prompt:off'),/already been saved/);
  assert.equal((await update(a,'present')).presentation,null);
  assert.equal((await update(b,'present')).presentation,'prompt');assert.equal((await update(b,'prompt:off')).emailState,'off');
  assert.equal((await update(b,'present')).presentation,null);
  assert.equal((await query('SELECT count(*)::int n FROM daily_reminder_settings WHERE auth_user_id IN ($1::uuid,$2::uuid)',[a.user_id,b.user_id])).rows[0].n,'0');
 });
 await test('new account offers independent verified news and weekly preferences',async()=>{
  await launch();
  const newsOnly=await account(),weeklyOnly=await account(),both=await account(),neither=await account();
  const n=await update(newsOnly,'signup:on:off');
  assert.equal(n.newsEmailState,'on');assert.equal(n.emailState,'off');
  const user=(await query('SELECT email FROM neon_auth."user" WHERE id=$1::uuid',[newsOnly.user_id])).rows[0];
  const hash=resultsEmailHash(user.email,env);
  assert.ok((await query('SELECT pack1_results_admit_news($1::uuid,$2,$3) id',[newsOnly.user_id,hash,user.email])).rows[0].id);
  assert.equal((await query('SELECT pack1_results_admit($1::uuid,$2,$3) id',[newsOnly.user_id,hash,user.email])).rows[0].id,null);
  const w=await update(weeklyOnly,'signup:off:on');
  assert.equal(w.newsEmailState,'off');assert.equal(w.emailState,'on');
  const b=await update(both,'signup:on:on');
  assert.equal(b.newsEmailState,'on');assert.equal(b.emailState,'on');
  const none=await update(neither,'signup:off:off');
  assert.equal(none.newsEmailState,'off');assert.equal(none.emailState,'off');
  assert.equal((await update(newsOnly,'news:off')).newsEmailState,'off');
  assert.equal((await snapshot(newsOnly)).emailState,'off');
  await update(newsOnly,'news:on');
  await changeEmail(newsOnly);
  const after=await snapshot(newsOnly);
  assert.equal(after.newsEmailState,'unanswered');
  assert.equal(after.emailState,'off');
 });
 await test('legacy single-toggle clients control both topics; weekly:* controls weekly only',async()=>{
  await launch();const a=await account();
  await update(a,'signup:on:on');
  // An older native build or cached page turning off "Results and news" must stop announcements too.
  let s=await update(a,'settings:off');assert.equal(s.emailState,'off');assert.equal(s.newsEmailState,'off');
  s=await update(a,'settings:on');assert.equal(s.emailState,'on');assert.equal(s.newsEmailState,'on');
  s=await update(a,'weekly:off');assert.equal(s.emailState,'off');assert.equal(s.newsEmailState,'on');
  s=await update(a,'weekly:on');assert.equal(s.emailState,'on');assert.equal(s.newsEmailState,'on');
  const b=await account();assert.equal((await update(b,'present')).presentation,'prompt');
  s=await update(b,'prompt:off');assert.equal(s.emailState,'off');assert.equal(s.newsEmailState,'off');
  const c=await account();await update(c,'weekly:on');
  assert.equal((await update(c,'present')).presentation,'prompt');
  s=await update(c,'prompt:on');assert.equal(s.newsEmailState,'on');
 });
 await test('every news transition is recorded with its topic and source',async()=>{
  await launch();const a=await account();
  await update(a,'signup:on:off');await update(a,'news:off');await update(a,'news:on');await changeEmail(a);await snapshot(a);
  const rows=(await query("SELECT state,source,destination_hash FROM results_email_changes WHERE auth_user_id=$1::uuid AND topic='news' ORDER BY id",[a.user_id])).rows;
  assert.deepEqual(rows.map(x=>[x.state,x.source]),[['on','signup choices'],['off','settings'],['on','settings'],['unanswered','email change']]);
  assert.match(rows[0].destination_hash,/^[a-f0-9]{64}$/);
  // Weekly was off throughout, so the address change records no weekly reset.
  assert.deepEqual((await query("SELECT state,source FROM results_email_changes WHERE auth_user_id=$1::uuid AND topic='weekly' ORDER BY id",[a.user_id])).rows.map(x=>[x.state,x.source]),[['off','signup choices']]);
  await update(a,'news:on');
  await query('SELECT pack1_results_unsubscribe_all($1::uuid)',[a.user_id]);
  const last=(await query("SELECT state,source FROM results_email_changes WHERE auth_user_id=$1::uuid AND topic='news' ORDER BY id DESC LIMIT 1",[a.user_id])).rows[0];
  assert.deepEqual([last.state,last.source],['off','unsubscribe link']);
 });
 await test('a news write after an address change cannot rebind weekly consent to the new address',async()=>{
  await launch();const a=await account();await update(a,'signup:off:on');
  // No snapshot/sync in between: the news write itself must reset the stale weekly consent.
  await changeEmail(a);
  const s=await update(a,'news:on');assert.equal(s.newsEmailState,'on');assert.equal(s.emailState,'unanswered');
  const user=(await query('SELECT email FROM neon_auth."user" WHERE id=$1::uuid',[a.user_id])).rows[0];
  const hash=resultsEmailHash(user.email,env);
  assert.equal((await query('SELECT pack1_results_admit($1::uuid,$2,$3) id',[a.user_id,hash,user.email])).rows[0].id,null);
  assert.ok((await query('SELECT pack1_results_admit_news($1::uuid,$2,$3) id',[a.user_id,hash,user.email])).rows[0].id);
  const b=await account();await update(b,'signup:on:on');await changeEmail(b);
  const t=await update(b,'signup:off:on');assert.equal(t.emailState,'on');assert.equal(t.newsEmailState,'off');
  assert.deepEqual((await query("SELECT topic,state FROM results_email_changes WHERE auth_user_id=$1::uuid AND source='email change' ORDER BY id",[b.user_id])).rows.map(x=>[x.topic,x.state]),[['weekly','unanswered'],['news','unanswered']]);
 });
 await test('existing notice is once only; dismiss is off; its button opts in without a second prompt',async()=>{
  const a=await account({old:true}),b=await account({old:true});assert.equal((await update(a,'present')).presentation,'notice');
  assert.equal((await update(a,'notice:dismiss')).emailState,'off');assert.equal((await update(a,'present')).presentation,null);
  assert.equal((await snapshot(a)).noticeOutcome,'dismissed');await assert.rejects(update(a,'prompt:on'),/already been saved/);
  const shown=await Promise.all([update(b,'present'),update(b,'present')]);assert.equal(shown.filter(x=>x.presentation==='notice').length,1);
  assert.equal((await update(b,'notice:on')).emailState,'on');assert.equal((await update(b,'present')).presentation,null);
  assert.equal((await snapshot(b)).noticeOutcome,'turned on');
 });
 await test('settings cover every choice transition and reject stale-account or injected fields',async()=>{
  const a=await account(),b=await account();
  for(const action of ['settings:off','settings:off','settings:on','settings:on','settings:off','settings:on'])assert.equal((await update(a,action)).emailState,action.split(':')[1]);
  const history=(await query("SELECT state,source,destination_hash FROM results_email_changes WHERE auth_user_id=$1::uuid AND topic='weekly' ORDER BY id",[a.user_id])).rows;
  assert.equal(history.length,6);assert.ok(history.every(x=>x.source==='settings'));assert.match(history[2].destination_hash,/^[a-f0-9]{64}$/);
  const news=(await query("SELECT state FROM results_email_changes WHERE auth_user_id=$1::uuid AND topic='news' ORDER BY id",[a.user_id])).rows;
  assert.deepEqual(news.map(x=>x.state),history.map(x=>x.state));
  await assert.rejects(updateResultsPreferences(query,a,{expectedAccountId:b.user_id,action:'settings:on'},{env}),/Account changed/);
  await assert.rejects(updateResultsPreferences(query,a,{expectedAccountId:a.user_id,action:'settings:on',email:'injected@example.invalid'},{env}),/valid action/);
 });
 await test('address change resets on once, including unverified replacement; off and unsubscribe persist',async()=>{
  const a=await account();await update(a,'settings:on');await changeEmail(a,false);
  assert.equal((await snapshot(a)).emailState,'unanswered');assert.equal((await update(a,'present')).presentation,'prompt');
  await assert.rejects(update(a,'prompt:on'),/Verify/);await assert.rejects(prepare(a),/not permitted/);
  await query('UPDATE neon_auth."user" SET "emailVerified"=true WHERE id=$1::uuid',[a.user_id]);await update(a,'prompt:on');
  assert.equal((await update(a,'present')).presentation,null);await changeEmail(a);assert.equal((await snapshot(a)).emailState,'unanswered');
  await update(a,'settings:off');await changeEmail(a);assert.equal((await snapshot(a)).emailState,'off');assert.equal((await update(a,'present')).presentation,null);
 });
 await test('send gate rejects missing configuration, unverified, off, changed address, both suppression streams and deletion',async()=>{
  const a=await account();await update(a,'settings:on');
  for(const k of ['PACK1_RESULTS_POSTAL_ADDRESS','PACK1_RESULTS_SENDER_NAME','PACK1_RESULTS_SENDER_EMAIL','PACK1_RESULTS_RESEND_WEBHOOK_SECRET'])await assert.rejects(prepare(a,{...env,[k]:''}),/configuration/);
  await query('UPDATE neon_auth."user" SET "emailVerified"=false WHERE id=$1::uuid',[a.user_id]);await assert.rejects(prepare(a),/not permitted/);
  await query('UPDATE neon_auth."user" SET "emailVerified"=true WHERE id=$1::uuid',[a.user_id]);
  const address=(await query('SELECT email FROM neon_auth."user" WHERE id=$1::uuid',[a.user_id])).rows[0].email,hash=resultsEmailHash(address,env);
  await query("INSERT INTO results_email_suppressions(auth_user_id,destination_hash,reason) VALUES($1::uuid,$2,'bounce')",[a.user_id,hash]);await assert.rejects(prepare(a),/not permitted/);await assert.rejects(update(a,'settings:on'),/paused/);
  await query('DELETE FROM results_email_suppressions WHERE auth_user_id=$1::uuid',[a.user_id]);
  await query("INSERT INTO daily_reminder_email_suppressions(auth_user_id,destination_hash,reason,first_event_at,last_event_at) VALUES($1::uuid,$2,'complaint',now(),now())",[a.user_id,hash]);await assert.rejects(prepare(a),/not permitted/);
  await query('DELETE FROM daily_reminder_email_suppressions WHERE auth_user_id=$1::uuid',[a.user_id]);
  await changeEmail(a);await assert.rejects(prepare(a),/not permitted/);assert.equal((await snapshot(a)).emailState,'unanswered');
  await update(a,'settings:off');await assert.rejects(prepare(a),/not permitted/);await update(a,'settings:on');
  await beginDeletion(query,{authUserId:a.user_id});await assert.rejects(prepare(a),/being deleted/);
 });
 await test('consent and publication races cannot reattach an identity or escape the deletion queue',async()=>{
  const a=await account();
  await Promise.allSettled([update(a,'settings:on'),beginDeletion(query,{authUserId:a.user_id})]);
  assert.equal((await query('SELECT 1 FROM results_preferences WHERE auth_user_id=$1::uuid',[a.user_id])).rows.length,0);
  await launch('15 days');const b=await account();const link='https://example.invalid/race/'+b.user_id;
  const [publication]=await Promise.all([recordResultsPublication(query,{authId:b.user_id,channel:'website',link}),beginDeletion(query,{authUserId:b.user_id})]);
  if(publication){
   const row=(await query('SELECT p.auth_user_id,t.id FROM results_publications p JOIN results_removal_tasks t ON t.publication_id=p.id WHERE p.id=$1::uuid',[publication])).rows[0];
   assert.ok(row?.id);assert.equal(row.auth_user_id,null);
  }
  assert.equal(await publishableResultsName(query,b.user_id),'Anonymous player');
 });
 await test('unsubscribe is signed, scanner-safe, one click without login, idempotent and independent of reminders',async()=>{
  const a=await account();await update(a,'settings:on');const envelope=await prepare(a);
  assert.equal(envelope.from,'Pack One <fixture@example.invalid>');assert.match(envelope.text,/Fixture postal address/);assert.match(envelope.html,/<footer>/);
  assert.equal(envelope.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
  const url=envelope.headers['List-Unsubscribe'].slice(1,-1).replace('/growth','');
  assert.equal((await route(new Request(url))).status,200);assert.equal((await snapshot(a)).emailState,'on');
  for(let i=0;i<2;i++)assert.equal((await route(new Request(url,{method:'POST'}))).status,200);
  assert.equal((await snapshot(a)).emailState,'off');await changeEmail(a);assert.equal((await snapshot(a)).emailState,'off');
  assert.equal((await query('SELECT count(*)::int n FROM daily_reminder_settings WHERE auth_user_id=$1::uuid',[a.user_id])).rows[0].n,'0');
  await assert.rejects(route(new Request(url+'bad',{method:'POST'})),/Invalid unsubscribe/);
 });
 await test('signed bounces/complaints suppress only the admitted destination; replay and delayed events cannot recreate deleted records',async()=>{
  const a=await account();await update(a,'settings:on');const first=await prepare(a);
  await route(eventRequest(first));await route(eventRequest(first,'email.complained'));await assert.rejects(prepare(a),/not permitted/);
  await changeEmail(a);await snapshot(a);await update(a,'settings:on');const second=await prepare(a);assert.notEqual(first.to[0],second.to[0]);
  await route(eventRequest(first));await prepare(a);
  const invalid=eventRequest(second);invalid.headers.set('svix-signature','v1,invalid');await assert.rejects(route(invalid),/Invalid email event/);
  await beginDeletion(query,{authUserId:a.user_id});await route(eventRequest(second));
  assert.equal((await query('SELECT count(*)::int n FROM results_email_suppressions WHERE auth_user_id=$1::uuid',[a.user_id])).rows[0].n,'0');
 });
 await test('publishable names reuse owned and unhidden leaderboard rules and exclusion, without individual notice or public profiles',async()=>{
  await launch('15 days');const a=await account({old:true});const name=await publishableResultsName(query,a.user_id);assert.match(name,/^Fixture /);
  assert.equal((await snapshot(a)).noticeShownAt,null);
  assert.equal((await snapshot(a)).emailState,'unanswered');
  assert.equal((await snapshot(a)).newsEmailState,'unanswered');
  assert.ok(await recordResultsPublication(query,{authId:a.user_id,channel:'website',link:'https://example.invalid/old-unnotified'}));
  await update(a,'present');assert.equal(await publishableResultsName(query,a.user_id),name);
  await update(a,'exclude:on');assert.equal(await publishableResultsName(query,a.user_id),'Anonymous player');
  assert.equal(await recordResultsPublication(query,{authId:a.user_id,channel:'website',link:'https://example.invalid/excluded'}),null);await update(a,'exclude:off');
  const player=(await query('SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid',[a.user_id])).rows[0].player_id;
  await query('UPDATE players SET username_owned=false WHERE id=$1::uuid',[player]);assert.equal(await publishableResultsName(query,a.user_id),'Anonymous player');
  await query('UPDATE players SET username_owned=true,public_identity_hidden_at=now() WHERE id=$1::uuid',[player]);assert.equal(await publishableResultsName(query,a.user_id),'Anonymous player');
  await query('UPDATE players SET public_identity_hidden_at=NULL,profile_public=false WHERE id=$1::uuid',[player]);assert.equal(await publishableResultsName(query,a.user_id),name);
  const unlinked=await account({linked:false});assert.equal(await publishableResultsName(query,unlinked.user_id),'Anonymous player');
  const recent=await account();assert.match(await publishableResultsName(query,recent.user_id),/^Fixture /);
 });
 await test('fourteen-day publication guard; deletion immediately creates private 28-day tasks and cleanup preserves them',async()=>{
  await launch();const a=await account({old:true});assert.equal((await snapshot(a)).noticeShownAt,null);
  await assert.rejects(recordResultsPublication(query,{authId:a.user_id,channel:'website',link:'https://example.invalid/results'}));
  await launch('15 days');assert.equal((await snapshot(a)).noticeShownAt,null);
  await recordResultsPublication(query,{authId:a.user_id,channel:'website',link:'https://example.invalid/results'});
  await recordResultsPublication(query,{authId:a.user_id,channel:'patreon',link:'https://example.invalid/feature'});
  const op=await beginDeletion(query,{authUserId:a.user_id});
  const tasks=(await query('SELECT p.auth_user_id,t.due_at=t.requested_at+interval \'28 days\' exact FROM results_removal_tasks t JOIN results_publications p ON p.id=t.publication_id WHERE t.requested_at=$1::timestamptz',[op.created_at])).rows;
  assert.equal(tasks.length,2);assert.ok(tasks.every(t=>t.auth_user_id===null&&t.exact==='t'));
  assert.equal(await publishableResultsName(query,a.user_id),'Anonymous player');
  await cleanupPackOne(query,op);assert.equal((await query('SELECT count(*)::int n FROM results_preferences WHERE auth_user_id=$1::uuid',[a.user_id])).rows[0].n,'0');
  assert.equal((await query('SELECT count(*)::int n FROM results_removal_tasks t JOIN results_publications p ON p.id=t.publication_id WHERE p.link IN ($1,$2)',['https://example.invalid/results','https://example.invalid/feature'])).rows[0].n,'2');
 });
 await test('owner contact flag, aggregates and retained-account removal use the same queue; completing scrubs evidence',async()=>{
  const existingOwner=(await query("SELECT auth_user_id FROM pack1_admins WHERE role='owner'")).rows[0];
  const owner=existingOwner?{user_id:existingOwner.auth_user_id}:await account(),admin=await account(),a=await account();
  if(!existingOwner)await query("INSERT INTO pack1_admins(auth_user_id,role) VALUES($1::uuid,'owner')",[owner.user_id]);
  await query("INSERT INTO pack1_admins(auth_user_id,role) VALUES($1::uuid,'admin')",[admin.user_id]);
  await assert.rejects(resultsAdmin(query,admin.user_id,{action:'contact',target:a.user_id,value:true}),/Owner/);
  assert.ok((await resultsAdmin(query,owner.user_id,{action:'contact',target:a.user_id,value:true})).doNotContactAt);
  assert.equal((await resultsAdmin(query,owner.user_id,{action:'contact',target:a.user_id,value:false})).doNotContactAt,null);
  const publication=await recordResultsPublication(query,{authId:a.user_id,channel:'website',link:'https://example.invalid/removal'});
  const state=await resultsAdmin(query,owner.user_id,{action:'request-removal',target:a.user_id});assert.ok(Object.hasOwn(state.counts,'unanswered'));assert.ok(Number(state.counts.prompt_on)>0);assert.ok(Number(state.counts.prompt_off)>0);
  const task=(await query('SELECT id,due_at FROM results_removal_tasks WHERE publication_id=$1::uuid',[publication])).rows[0];
  await resultsAdmin(query,owner.user_id,{action:'request-removal',target:a.user_id});assert.equal((await query('SELECT due_at FROM results_removal_tasks WHERE id=$1::uuid',[task.id])).rows[0].due_at,task.due_at);
  await resultsAdmin(query,owner.user_id,{action:'complete',task:task.id});assert.equal((await query('SELECT 1 FROM results_publications WHERE id=$1::uuid',[publication])).rows.length,0);
 });
 await test('real gateway, worker and PostgreSQL enforce browser CSRF, current account and native ownership',async()=>{
  const a=await account(),b=await account(),secret='c'.repeat(64),csrf=randomBytes(32).toString('base64url'),session=randomBytes(32).toString('base64url');
  const digest=v=>createHash('sha256').update(v).digest('hex');
  await query("INSERT INTO account_sessions(session_hash,auth_user_id,csrf_hash,expires_at) VALUES($1,$2::uuid,$3,now()+interval '1 day')",[digest(session),a.user_id,digest(csrf)]);
  const previousFetch=globalThis.fetch,changes={...env,DATABASE_URL:SQL_CONNECTION,PACK1_REQUIRE_INGRESS:'1',PACK1_INGRESS_SECRET:secret},old=Object.fromEntries(Object.keys(changes).map(k=>[k,process.env[k]]));
  Object.assign(process.env,changes);globalThis.fetch=postgresTransport(pool);
  const edge={MODE:'preview',NEON_BRANCH_ID:'br-results-fixture',QUOTA_KEY:secret,PREVIEW_KEY:secret,ORIGIN_SECRET:secret,NETWORK_QUOTA:{idFromName:v=>v,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
  try{
   const {default:worker}=await import('../worker/growth-function.js');
   const request=(path,{method='GET',body,proof=csrf,cookie=session}={})=>gateway(new Request('https://api-preview.packone.pro/growth'+path,{method,headers:{origin:'https://packone.pro','x-pack1-preview-key':secret,'cf-connecting-ip':'192.0.2.1','content-type':'application/json',...(cookie?{cookie:'__Host-pack1_account='+cookie}:{}),...(proof?{'x-pack1-csrf':proof}:{})},body:body===undefined?undefined:JSON.stringify(body)}),edge,(url,options)=>worker.fetch(new Request(url,options)));
   assert.equal((await request('/v1/account/results')).status,200);
   assert.equal((await request('/v1/account/results',{cookie:null})).status,401);
   const edit={expectedAccountId:a.user_id,action:'settings:on'};
   assert.equal((await request('/v1/account/results',{method:'PATCH',body:edit,proof:null})).status,403);
   assert.equal((await request('/v1/account/results',{method:'PATCH',body:{...edit,expectedAccountId:b.user_id}})).status,409);
   const saved=await request('/v1/account/results',{method:'PATCH',body:edit});assert.equal(saved.status,200);assert.equal((await saved.json()).emailState,'on');
   const envelope=await prepare(a),url=new URL(envelope.headers['List-Unsubscribe'].slice(1,-1));
   assert.equal((await request(url.pathname.replace('/growth','')+url.search,{method:'POST',cookie:null,proof:null})).status,200);
   assert.equal((await snapshot(a)).emailState,'off');
   assert.equal((await request('/v1/mobile/account/results',{cookie:null})).status,401);
  }finally{globalThis.fetch=previousFetch;for(const k of Object.keys(changes))if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}
 });
 console.log('Passed '+passed+' real PostgreSQL results privacy contracts.');
}finally{
 await query("UPDATE pack1_admins SET role='admin' WHERE auth_user_id=ANY($1::uuid[]) AND role='owner'",[accounts]);
 for(const id of accounts)await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[id]);
 for(const id of players)await query('DELETE FROM players WHERE id=$1::uuid',[id]);
 await query('DELETE FROM results_publications');await query('UPDATE results_launch SET launch_at=NULL');await pool.end();
}
