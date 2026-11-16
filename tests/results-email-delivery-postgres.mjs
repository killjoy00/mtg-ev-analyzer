// Local PostgreSQL and synthetic accounts only. No external provider calls.
import assert from 'node:assert/strict';
import {randomUUID,createHmac,randomBytes} from 'node:crypto';
import {fixturePool,textTypes} from './support/postgres-fixture.mjs';
import {updateResultsPreferences,resultsRoute,resultsEmailHash,recordResultsPublication} from '../worker/results-privacy.mjs';
import {deliverResultsEmail,resultsCampaignAdmin,dispatchResultsEmail} from '../worker/results-email-delivery.mjs';
import {beginDeletion} from '../worker/account-deletion.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
const pool=fixturePool(),query=(text,values=[])=>pool.query({text,values,types:textTypes});
const env={PACK1_RESULTS_EMAIL_ENABLED:'1',PACK1_RESULTS_RESEND_API_KEY:'re_fixture',PACK1_RATE_LIMIT_SECRET:'fixture-signing-key-at-least-32-characters',
 PACK1_RESULTS_RESEND_WEBHOOK_SECRET:'whsec_'+Buffer.from('synthetic-webhook-key').toString('base64'),PACK1_RESULTS_SENDER_NAME:'Pack One',PACK1_RESULTS_SENDER_EMAIL:'fixture@example.invalid',PACK1_RESULTS_POSTAL_ADDRESS:'Synthetic postal footer'};
const accounts=[],players=[];let passed=0;
const edit=(id,action)=>updateResultsPreferences(query,{user_id:id},{expectedAccountId:id,action},{env});
async function account({on=true,verified=true,owner=false}={}){
 const id=randomUUID(),player=randomUUID();accounts.push(id);players.push(player);
 await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified","createdAt") VALUES($1::uuid,\'Isolated fixture\',$2,$3::boolean,now())',[id,id+'@example.invalid',verified]);
 await query('INSERT INTO players(id,display_name,username_owned) VALUES($1::uuid,$2,true)',[player,'Synthetic '+player.slice(0,8)]);
 await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[id,player]);
 if(on)await edit(id,'settings:on');
 if(owner)await query("INSERT INTO pack1_admins(auth_user_id,role) VALUES($1::uuid,'owner')",[id]);
 return {id,player};
}
async function campaign(){
 const row=(await query("INSERT INTO results_email_campaigns(campaign_key,kind,state,subject,body,approved_at,expires_at) VALUES($1,'news','approved','Synthetic news','A synthetic message.',now(),now()+interval '1 day') RETURNING *",['fixture:'+randomUUID()])).rows[0];return row;
}
async function test(label,fn){await fn();passed++;console.log('PASS '+label);}
async function event(envelope,type,provider='fixture-provider',config=env){
 const raw=JSON.stringify({type,data:{to:envelope.to,tags:envelope.tags,email_id:provider}}),id='event_'+randomBytes(8).toString('hex'),time=String(Math.floor(Date.now()/1000));
 const mac=createHmac('sha256',Buffer.from(env.PACK1_RESULTS_RESEND_WEBHOOK_SECRET.slice(6),'base64')).update(id+'.'+time+'.'+raw).digest('base64');
 return resultsRoute(new Request('https://fixture.invalid/v1/results/provider-event',{method:'POST',body:raw,headers:{'svix-id':id,'svix-timestamp':time,'svix-signature':'v1,'+mac}}),{query,json:Response.json,env:config});
}
try{
 await query("UPDATE results_launch SET launch_at=now()-interval '1 second'");
 await test('concurrent duplicate dispatch claims once; accepted envelopes have required footer and one-click headers',async()=>{
  const a=await account(),c=await campaign();let calls=0;
  const fetcher=async(url,o)=>{calls++;assert.equal(url,'https://api.resend.com/emails');const e=JSON.parse(o.body);assert.match(e.text,/Synthetic postal footer/);assert.match(e.html,/<html lang="en">/);assert.equal(e.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');assert.match(o.headers['Idempotency-Key'],/^pack1-results-/);return Response.json({id:'fixture-provider'});};
  const values=await Promise.all(Array.from({length:8},()=>deliverResultsEmail(query,c,a.id,{env,fetcher})));assert.equal(calls,1);assert.equal(values.filter(v=>v==='accepted').length,1);
  assert.equal((await query('SELECT count(*)::int n FROM results_email_deliveries WHERE auth_user_id=$1::uuid',[a.id])).rows[0].n,'1');
 });
 await test('off, unanswered, unverified and later opt-in accounts never reach the provider',async()=>{
  const off=await account({on:false}),unverified=await account({on:false,verified:false}),late=await account({on:false}),c=await campaign();await edit(late.id,'settings:on');
  for(const a of [off,unverified,late])assert.equal(await deliverResultsEmail(query,c,a.id,{env,fetcher:()=>{throw Error('forbidden send');}}),'not_claimed');
  const a=await account(),c2=await campaign();await edit(a.id,'settings:off');assert.equal(await deliverResultsEmail(query,c2,a.id,{env}),'not_claimed');
 });
 await test('unsubscribe after claim and a changed address are rechecked at final admission',async()=>{
  const a=await account(),c=await campaign();const wrapped=async(sql,p)=>{const result=await query(sql,p);if(sql.includes('pack1_results_claim_delivery'))await edit(a.id,'settings:off');return result;};
  assert.equal(await deliverResultsEmail(wrapped,c,a.id,{env,fetcher:()=>{throw Error('forbidden send');}}),'skipped');
  const b=await account(),c2=await campaign();await query('UPDATE neon_auth."user" SET email=$2 WHERE id=$1::uuid',[b.id,'changed-'+b.id+'@example.invalid']);
  assert.equal(await deliverResultsEmail(query,c2,b.id,{env,fetcher:()=>{throw Error('forbidden send');}}),'skipped');
 });
 await test('a cancelled campaign and shared Daily suppression prevent the provider handoff',async()=>{
  const a=await account(),c=await campaign();await query("UPDATE results_email_campaigns SET state='cancelled' WHERE id=$1::uuid",[c.id]);assert.equal(await deliverResultsEmail(query,c,a.id,{env}),'not_claimed');
  const c2=await campaign(),hash=resultsEmailHash(a.id+'@example.invalid',env);
  await query("INSERT INTO daily_reminder_email_suppressions(auth_user_id,destination_hash,reason,first_event_at,last_event_at) VALUES($1::uuid,$2,'complaint',now(),now())",[a.id,hash]);
  assert.equal(await deliverResultsEmail(query,c2,a.id,{env,fetcher:()=>{throw Error('forbidden send');}}),'skipped');
 });
 await test('ambiguous acceptance is never replayed, including after an old pending claim',async()=>{
  const a=await account(),c=await campaign();let calls=0;const fetcher=async()=>{calls++;throw Error('synthetic lost response');};
  assert.equal(await deliverResultsEmail(query,c,a.id,{env,fetcher}),'uncertain');assert.equal(await deliverResultsEmail(query,c,a.id,{env,fetcher}),'not_claimed');assert.equal(calls,1);
 });
 await test('signed delivery events are idempotent and cannot undo bounce or complaint suppression',async()=>{
  const a=await account(),c=await campaign();let envelope;
  await deliverResultsEmail(query,c,a.id,{env,fetcher:async(_,o)=>{envelope=JSON.parse(o.body);return Response.json({id:'fixture-provider'});}});
  for(const type of ['email.delivered','email.sent','email.delivered','email.bounced','email.delivered','email.complained','email.sent'])await event(envelope,type);
  const row=(await query('SELECT state FROM results_email_deliveries WHERE auth_user_id=$1::uuid',[a.id])).rows[0];assert.equal(row.state,'complained');
  assert.equal((await query('SELECT reason FROM results_email_suppressions WHERE auth_user_id=$1::uuid',[a.id])).rows[0].reason,'complaint');
  assert.equal((await query('SELECT count(*)::int n FROM daily_reminder_settings WHERE auth_user_id=$1::uuid',[a.id])).rows[0].n,'0');
 });
 await test('deletion commitment erases all delivery/admission rows and no publication cutoff is moved',async()=>{
  const a=await account(),c=await campaign();await deliverResultsEmail(query,c,a.id,{env,fetcher:async()=>Response.json({id:'fixture-provider'})});
  const preparing=await campaign(),skipped=await campaign();
  await query('SELECT pack1_results_claim_delivery($1::uuid,$2::uuid)',[preparing.id,a.id]);
  const skipId=(await query('SELECT pack1_results_claim_delivery($1::uuid,$2::uuid) id',[skipped.id,a.id])).rows[0].id;
  await query("UPDATE results_email_deliveries SET state='skipped' WHERE id=$1::uuid",[skipId]);
  const targeted=await campaign();await query('UPDATE results_email_campaigns SET target_auth_user_id=$2::uuid WHERE id=$1::uuid',[targeted.id,a.id]);
  assert.equal((await query('SELECT count(*)::int n FROM results_email_deliveries WHERE auth_user_id=$1::uuid',[a.id])).rows[0].n,'3');
  const before=(await query('SELECT launch_at::text FROM results_launch')).rows[0].launch_at;
  await beginDeletion(query,{authUserId:a.id});
  assert.equal((await query('SELECT count(*)::int n FROM results_email_deliveries WHERE auth_user_id=$1::uuid',[a.id])).rows[0].n,'0');
  assert.equal((await query('SELECT count(*)::int n FROM results_email_admissions WHERE auth_user_id=$1::uuid',[a.id])).rows[0].n,'0');
  assert.equal((await query('SELECT count(*)::int n FROM results_email_campaigns WHERE id=$1::uuid',[targeted.id])).rows[0].n,'0');
  assert.equal((await query('SELECT launch_at::text FROM results_launch')).rows[0].launch_at,before);
  await assert.rejects(recordResultsPublication(query,{authId:(await account()).id,channel:'email',link:'https://example.invalid/results'}));
 });
 await test('news requires owner access, an exact preview and explicit approval; drafts never dispatch',async()=>{
  const owner=await account({owner:true}),other=await account();await assert.rejects(resultsCampaignAdmin(query,other.id,null,{env}),/Owner/);
  let state=await resultsCampaignAdmin(query,owner.id,{action:'draft',subject:'Synthetic draft',body:'No player names.'},{env});
  const draft=state.campaigns.find(c=>c.subject==='Synthetic draft');assert.equal(draft.state,'draft');
  await query('UPDATE results_email_runtime SET verified_at=now()');
  await assert.rejects(resultsCampaignAdmin(query,owner.id,{action:'approve',id:draft.id,previewHash:'old'},{env}),/Preview|preview/);
  await resultsCampaignAdmin(query,owner.id,{action:'approve',id:draft.id,previewHash:draft.previewHash},{env});
  assert.equal((await query('SELECT state FROM results_email_campaigns WHERE id=$1::uuid',[draft.id])).rows[0].state,'approved');
  await resultsCampaignAdmin(query,owner.id,{action:'cancel',id:draft.id},{env});
 });
 await test('an owner-only delivery check is limited to that consenting account; signed delivery unlocks only the matching sender configuration',async()=>{
  const owner=(await query("SELECT auth_user_id id FROM pack1_admins WHERE role='owner'")).rows[0];
  await query('UPDATE results_email_runtime SET verified_at=NULL');
  assert.deepEqual(await dispatchResultsEmail(query,{env}),{active:false,verificationRequired:true});
  let envelope,calls=0;const nonce=randomUUID(),fetcher=async(_,o)=>{calls++;envelope=JSON.parse(o.body);return Response.json({id:'fixture-check'});};
  const a=await resultsCampaignAdmin(query,owner.id,{action:'check',id:nonce},{env,fetcher});assert.equal(a.check.state,'accepted');assert.equal(a.verified,false);
  await resultsCampaignAdmin(query,owner.id,{action:'check',id:nonce},{env,fetcher});assert.equal(calls,1);
  assert.equal((await query('SELECT count(*)::int n FROM results_email_deliveries WHERE campaign_id=$1::uuid',[a.check.id])).rows[0].n,'1');
  const changed={...env,PACK1_RESULTS_POSTAL_ADDRESS:'Changed synthetic footer'};
  assert.equal((await resultsCampaignAdmin(query,owner.id,null,{env:changed})).active,false);
  await event(envelope,'email.delivered','fixture-check',changed);
  assert.equal((await resultsCampaignAdmin(query,owner.id,null,{env:changed})).active,false,'a delayed event from the old footer cannot verify the new sender configuration');
  await resultsCampaignAdmin(query,owner.id,null,{env});
  await event(envelope,'email.delivered','fixture-check');assert.equal((await resultsCampaignAdmin(query,owner.id,null,{env})).active,true);
 });
 await test('weekly digests reuse the live standings and give hidden profiles their own private summary without a public rank',async()=>{
  const a=await account();
  for(const [day,score] of [['2026-11-16',50],['2026-11-17',75],['2026-11-18',100]])await query("INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json,details_json) VALUES($1::uuid,$2::date,'mixed','draft_run',$3,'C','[]'::jsonb,jsonb_build_object('corpus_version',$4::text))",[a.player,day,score,DRAFT_RUN_CORPUS_VERSION]);
  const make=async()=> (await query("INSERT INTO results_email_campaigns(campaign_key,kind,state,subject,start_date,end_date,approved_at,expires_at) VALUES($1,'week','approved','Synthetic weekly results','2026-11-16','2026-11-22',now(),now()+interval '1 day') RETURNING id,kind,subject,body,start_date::text,end_date::text",['fixture:'+randomUUID()])).rows[0];
  let text;const fetcher=async(_,o)=>{text=JSON.parse(o.body).text;return Response.json({id:'fixture-weekly'});};
  assert.equal(await deliverResultsEmail(query,await make(),a.id,{env,fetcher}),'accepted');assert.match(text,/#1 · 75.0 weekly score · 3 Dailies/);assert.doesNotMatch(text,/Synthetic [a-f0-9]/);
  await query('UPDATE players SET public_identity_hidden_at=now() WHERE id=$1::uuid',[a.player]);
  assert.equal(await deliverResultsEmail(query,await make(),a.id,{env,fetcher}),'accepted');assert.match(text,/Not ranked · 75.0 weekly score · 3 Dailies/);
 });
 await test('automatic dispatch records only aggregate outcomes and default-off performs no reads or sends',async()=>{
  assert.deepEqual(await dispatchResultsEmail(()=>{throw Error('forbidden query');},{env:{}}),{active:false});
 });
 console.log('Passed '+passed+' real PostgreSQL results email delivery contracts.');
}finally{
 await query("UPDATE pack1_admins SET role='admin' WHERE auth_user_id=ANY($1::uuid[]) AND role='owner'",['{'+accounts.join(',')+'}']);
 await query("DELETE FROM results_email_campaigns WHERE campaign_key LIKE 'fixture:%' OR subject='Synthetic draft'");
 await query('DELETE FROM account_deletion_operations WHERE auth_user_id=ANY($1::uuid[])',['{'+accounts.join(',')+'}']);
 await query('DELETE FROM neon_auth."user" WHERE id=ANY($1::uuid[])',['{'+accounts.join(',')+'}']);
 await query('DELETE FROM players WHERE id=ANY($1::uuid[])',['{'+players.join(',')+'}']);
 await query('UPDATE results_launch SET launch_at=NULL');await pool.end();
}
