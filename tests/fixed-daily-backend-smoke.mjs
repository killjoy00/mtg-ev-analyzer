import fs from 'node:fs';
import assert from 'node:assert/strict';
if(!process.argv.includes('--dev-fixtures'))throw Error('Use a disposable branch.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const originalFetch=globalThis.fetch;globalThis.fetch=(url,options={})=>originalFetch(url,{...options,signal:AbortSignal.timeout(30000)});
const RealDate=Date,instant=RealDate.parse('2040-01-10T16:00:00Z');
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return instant;}};
const growthModule=await import('../worker/growth-function.js');
const {query}=growthModule, growth=growthModule.default;
const {default:api}=await import('../worker/draft-run-function.mjs');
const {DRAFT_RUN_CORPUS_VERSION}=await import('../draft-run.mjs');
const {selectDatabaseRun}=await import('../worker/draft-run-selection.mjs');
const tag=crypto.randomUUID().slice(0,8),day='2040-01-10';
const parse=v=>typeof v==='string'?JSON.parse(v):v;
async function callWith(target,path,body,token,auth,status=200){
 const r=await target.fetch(new Request('https://packone.pro'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...(auth?{'x-pack1-auth-session':auth}:{})},body:body===undefined?undefined:JSON.stringify(body)}));
 console.log('Checked',path,r.status);const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;
}
const call=(path,body,token,auth,status=200)=>callWith(api,path,body,token,auth,status);
const callGrowth=(path,body,token,auth,status=200)=>callWith(growth,path,body,token,auth,status);
const guest=await call('/v1/session',{displayName:'QA fixed '+tag});
const before=(await query('SELECT count(*) n FROM draft_run_schedules WHERE day=$1::date',[day])).rows[0].n;
assert.equal((await call('/v1/daily-status',undefined,guest.token)).daily_history.length,0);
assert.equal((await query('SELECT count(*) n FROM draft_run_schedules WHERE day=$1::date',[day])).rows[0].n,before);
let run=await call('/v1/runs',{daily:true},guest.token);
const schedule=parse((await query("SELECT puzzle_ids FROM draft_run_schedules WHERE day=$1::date AND environment='mixed'",[day])).rows[0].puzzle_ids);
const rows=(await query('SELECT set_id,source_draft_hash FROM draft_run_verified_puzzles WHERE puzzle_id=ANY($1::text[])',['{'+schedule.join(',')+'}'])).rows;
assert.equal(rows.length,8);assert.equal(new Set(rows.map(p=>p.source_draft_hash)).size,8);
assert.ok(rows.filter(p=>p.set_id==='hob').length>=2);assert.ok(rows.filter(p=>['msh','sos','tmt'].includes(p.set_id)).length>=4);
assert.deepEqual(run.rerolls,{set:0,pack:0});
await call(`/v1/runs/${run.id}/reroll`,{revision:run.revision,round:0,puzzleId:run.current.puzzle_id,type:'pack'},guest.token,null,409);
async function finish(s,token,auth){
 while(!s.complete){const p=parse((await query('SELECT payload FROM draft_run_verified_puzzles WHERE puzzle_id=$1',[s.current.puzzle_id])).rows[0].payload);
  s=await call(`/v1/runs/${s.id}/pick`,{revision:s.revision,round:s.round-1,puzzleId:s.current.puzzle_id,cardId:p.historical_pick_id},token,auth);
 }return s;
}
run=await finish(run,guest.token);assert.equal(run.score,100);assert.equal(run.standing,null);
assert.equal((await query('SELECT count(*) n FROM scores WHERE player_id=$1::uuid',[guest.playerId])).rows[0].n,'0');
assert.equal((await call('/v1/daily-status',undefined,guest.token)).daily_history.length,1);
const shared=await call(`/v1/runs/${run.id}/share`,{},guest.token);assert.equal(shared.daily,true);assert.match(shared.url,/daily=1/);assert.equal(shared.id,undefined);
assert.equal((await query('SELECT count(*) n FROM draft_run_shares WHERE session_id=$1::uuid',[run.id])).rows[0].n,'0');
const owner=await call('/v1/session',{displayName:'QA ranked '+tag});
const authId=crypto.randomUUID(),auth=crypto.randomUUID()+crypto.randomUUID();
await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[authId,'QA fixed account',`qa-fixed-${tag}@example.invalid`]);
await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()+interval \'1 hour\',now())',[auth,authId]);
await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[authId,owner.playerId]);
// A Supporter holds no paid capability, so the homepage cannot tell one from a
// free account on capabilities alone and would offer to make them a member.
assert.deepEqual((await call('/v1/daily-status',undefined,guest.token)).membership,{connected:false},'a guest is never connected');
assert.deepEqual((await call('/v1/daily-status',undefined,owner.token,auth)).membership,{connected:false},'an account with no provider link is not connected');
await query("INSERT INTO provider_accounts(auth_user_id,provider,provider_user_id) VALUES($1::uuid,'patreon',$2)",[authId,'qa-provider-'+tag]);
const connectedStatus=await call('/v1/daily-status',undefined,owner.token,auth);
assert.deepEqual(connectedStatus.membership,{connected:true},'a linked provider account reports connected');
assert.deepEqual(connectedStatus.capabilities,['account','unlimited_regular_practice'],'linkage alone grants nothing');
await query("DELETE FROM provider_accounts WHERE auth_user_id=$1::uuid",[authId]);
assert.deepEqual((await call('/v1/daily-status',undefined,owner.token,auth)).membership,{connected:false},'disconnecting is reflected');
let accountRun=await call('/v1/runs',{daily:true},owner.token);
assert.equal(accountRun.ranked_name,'QA ranked '+tag);
assert.equal(accountRun.current.puzzle_id,schedule[0]);assert.equal(accountRun.leaderboard_eligible,true);
assert.equal((await call('/v1/runs',{daily:true},owner.token,auth)).id,accountRun.id);
accountRun=await finish(accountRun,owner.token);assert.ok(accountRun.standing);
assert.equal((await query('SELECT count(*) n FROM scores WHERE player_id=$1::uuid AND challenge_date=$2::date',[owner.playerId,day])).rows[0].n,'1');
// A completed guest Daily can be validated by the explicit sign-in/link action.
const guestAuthId=crypto.randomUUID(),guestAuth=crypto.randomUUID()+crypto.randomUUID();
await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[guestAuthId,'QA late link',`qa-late-${tag}@example.invalid`]);
await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()+interval \'1 hour\',now())',[guestAuth,guestAuthId]);
const validated=await callGrowth('/v1/account/link',{validateDailyRunId:run.id},guest.token,guestAuth);
assert.equal(validated.validatedDailyScore,true);
const lateResume=await call('/v1/runs',{daily:true},guest.token);
assert.equal(lateResume.id,run.id);assert.equal(lateResume.leaderboard_eligible,true);assert.ok(lateResume.standing);
assert.equal((await query('SELECT count(*) n FROM scores WHERE player_id=$1::uuid',[guest.playerId])).rows[0].n,'1');
// Linked player with no Auth header still cannot use paid or free account practice.
await call('/v1/runs',{},owner.token,null,403);
let latest=await call('/v1/runs',{daily:true,environment:'latest'},owner.token);
assert.equal(latest.leaderboard_eligible,true);assert.deepEqual(latest.daily_featured_sets,['hob']);
assert.deepEqual(latest.rerolls,{set:0,pack:0});
latest=await finish(latest,owner.token);
assert.ok(latest.answers.every(a=>a.puzzle.set_id==='hob'));
assert.deepEqual(latest.answers.map(a=>a.puzzle.pick_number),[1,2,3,4,5,6,7,8]);
assert.equal((await call('/v1/runs',{daily:true,environment:'latest'},owner.token)).id,latest.id);
assert.match((await call(`/v1/runs/${latest.id}/share`,{},owner.token)).url,/set=latest/);
assert.ok((await call('/v1/leaderboard?environment=latest')).rows.some(r=>r.display_name==='QA ranked '+tag));
await call('/v1/runs',{environment:'latest'},owner.token,auth,400);
// Newly paused data must not invalidate today's already-published schedule.
await query("UPDATE draft_run_environment_policy SET status='Paused' WHERE set_id='hob'");
const later=await call('/v1/session',{displayName:'QA fixed later '+tag});
assert.equal((await call('/v1/runs',{daily:true},later.token)).current.puzzle_id,schedule[0]);
await query("UPDATE draft_run_environment_policy SET status='Live' WHERE set_id='hob'");
// A different corpus revision cannot replace an already-published Daily.
const retainedVersion=(await query("SELECT corpus_version FROM draft_run_verified_puzzles WHERE set_id='powered-cube' AND corpus_version<>$1 ORDER BY corpus_version LIMIT 1",[DRAFT_RUN_CORPUS_VERSION])).rows[0]?.corpus_version;
assert.ok(retainedVersion,'A retained older corpus is required.');
const older=await selectDatabaseRun(query,retainedVersion,'fixed-old-cube','powered-cube',{selectionVersion:'eight-pick-v3'});
await query(`INSERT INTO draft_run_schedules(day,environment,corpus_version,puzzle_ids,selection_version,difficulty_version) VALUES($1::date,'powered-cube',$3,$2::jsonb,'eight-pick-v3','support-ratio-v1') ON CONFLICT DO NOTHING`,[day,JSON.stringify(older.map(p=>p.puzzle_id)),retainedVersion]);
const cube=await call('/v1/runs',{daily:true,environment:'powered-cube'},later.token);
assert.equal(cube.current.puzzle_id,older[0].puzzle_id);
assert.equal((await query('SELECT corpus_version FROM draft_run_sessions WHERE id=$1::uuid',[cube.id])).rows[0].corpus_version,retainedVersion);
console.log(JSON.stringify({fixedDaily:'passed',anonymousScoresUnranked:true,guestScoreValidatesAfterSignIn:true,accountDailyUnique:true,noRerolls:true,quotas:true,sourceUnique:true,dailyShareDoesNotCreateRun:true,statusAndCorpusChangesPreserveSchedule:true,currentCorpus:DRAFT_RUN_CORPUS_VERSION}));
