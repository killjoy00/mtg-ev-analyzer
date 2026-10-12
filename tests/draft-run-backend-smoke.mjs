import {withPracticeAccess} from './practice-access-fixture.mjs';
// Explicit integration gate against an isolated Neon development branch.
// Usage: node tests/draft-run-backend-smoke.mjs /path/to/dev.connection --dev-fixtures
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {digest} from '../worker/account-session.mjs';
if(!process.argv.includes('--dev-fixtures'))throw new Error('Use an isolated development database and --dev-fixtures.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {default:growth,query,gameDateKey}=await import('../worker/growth-function.js');
const {default:runApi}=await import('../worker/draft-run-function.mjs');
const tag=crypto.randomUUID().slice(0,8),timings=[];
const httpPrefix=process.env.PACK1_QA_FUNCTION_PREFIX;
if(httpPrefix&&!/^https:\/\/br-[a-z0-9-]+-$/.test(httpPrefix))throw new Error('Invalid development function prefix');
async function call(service,path,body,token,status=200,extra={}) {
  const started=performance.now();
  const url=httpPrefix?httpPrefix+(service===growth?'pack1growth':'draftrunapi')+'.compute.c-5.us-east-2.aws.neon.tech'+path:'https://packone.pro'+path;
  const request=new Request(url,{method:extra.method||(body===undefined?'GET':'POST'),headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...extra.headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  const r=await withPracticeAccess(request,query,r=>httpPrefix?fetch(r):service.fetch(r));
  const data=await r.json();timings.push({path,ms:Math.round(performance.now()-started)});
  assert.equal(r.status,status,`${path}: ${JSON.stringify(data)}`);return data;
}
const guest=await call(growth,'/v1/session',{displayName:'QA guest '+tag});
const owner=await call(growth,'/v1/session',{displayName:'QA owner '+tag});
console.log('Created isolated guest and owner fixtures',tag);
let original=await call(runApi,'/v1/runs',{daily:true},owner.token);
let duplicate=await call(runApi,'/v1/runs',{daily:true},guest.token);
const practiceKey=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const practiceHeaders={'x-idempotency-key':practiceKey};
let s=await call(runApi,'/v1/runs',{},guest.token,200,{headers:practiceHeaders});
const practiceRetry=await call(runApi,'/v1/runs',{},guest.token,200,{headers:practiceHeaders});
assert.equal(practiceRetry.id,s.id,'A retried practice start must return the original run');
assert.equal((await query('SELECT count(*) n FROM draft_run_sessions WHERE player_id=$1::uuid AND start_idempotency_hash=$2',[guest.playerId,digest(practiceKey)])).rows[0].n,'1');
assert.equal((await query("SELECT count(*) n FROM analytics_events WHERE player_id=$1::uuid AND event_name='game_started' AND event_props->>'run_id'=$2",[guest.playerId,s.id])).rows[0].n,'1');
await call(runApi,'/v1/runs',{environment:'powered-cube'},guest.token,409,{headers:practiceHeaders});
await call(runApi,'/v1/runs',{daily:true},guest.token,400,{headers:{'x-idempotency-key':Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}});

const idemOwner=await call(growth,'/v1/session',{displayName:'QA idempotency '+tag});
const idemAuth=crypto.randomUUID();
await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[
  idemAuth,'QA idempotency',`qa-idempotency-${idemAuth}@example.invalid`,
]);
await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[idemAuth,idemOwner.playerId]);
const concurrentKey=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const concurrentHeaders={'x-idempotency-key':concurrentKey};
const concurrentStarts=await Promise.all([
  call(runApi,'/v1/runs',{},idemOwner.token,200,{headers:concurrentHeaders}),
  call(runApi,'/v1/runs',{},idemOwner.token,200,{headers:concurrentHeaders}),
]);
assert.equal(concurrentStarts[0].id,concurrentStarts[1].id,'Concurrent practice starts must converge on one run');
assert.equal((await query('SELECT count(*) n FROM draft_run_sessions WHERE player_id=$1::uuid AND start_idempotency_hash=$2',[idemOwner.playerId,digest(concurrentKey)])).rows[0].n,'1');
await query('DELETE FROM account_links WHERE auth_user_id=$1::uuid',[idemAuth]);
await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[idemAuth]);

const initial=s.current.puzzle_id;
const req={revision:s.revision,round:0,puzzleId:initial,type:'pack'};
const concurrent=await Promise.all([call(runApi,`/v1/runs/${s.id}/reroll`,req,guest.token).catch(e=>e),call(runApi,`/v1/runs/${s.id}/reroll`,req,guest.token).catch(e=>e)]);
assert.equal(concurrent.filter(r=>!(r instanceof Error)).length,1,'Only one concurrent reroll can commit');
assert.match(concurrent.find(r=>r instanceof Error).message,/409|another tab|already/);
s=await call(runApi,`/v1/runs/${s.id}`,undefined,guest.token);
assert.equal(s.rerolls.pack,0);assert.notEqual(s.current.puzzle_id,initial);
for(let round=0;round<s.run_length;round++) {
  const body={revision:s.revision,round,puzzleId:s.current.puzzle_id,cardId:s.current.candidates[0].id};
  const other=s.current.candidates[1].id;
  s=await call(runApi,`/v1/runs/${s.id}/pick`,body,guest.token);
  assert.equal((await call(runApi,`/v1/runs/${s.id}/pick`,body,guest.token)).revision,s.revision);
  await call(runApi,`/v1/runs/${s.id}/pick`,{...body,cardId:other},guest.token,409);
  console.log('Locked decision and retries verified',round+1);
}
assert.equal(s.complete,true);
const firstAnswer=s.answers[0];
await call(runApi,`/v1/runs/${s.id}/report`,{
  round:0,
  puzzleId:firstAnswer.puzzle.puzzle_id,
  reason:'score_recommendation',
  comment:'QA decision report',
  client:{platform:'web',version:null,build:'qa-smoke'},
},guest.token);
await call(runApi,`/v1/runs/${s.id}/report`,{
  round:0,
  puzzleId:'wrong-puzzle',
  reason:'score_recommendation',
  comment:'must not persist',
  client:{platform:'web',version:null,build:'qa-smoke'},
},guest.token,409);
const decisionReports=await query(`SELECT
    player_id,puzzle_id,selected_card_id,recommended_card_id,reason,comment,
    environment,corpus_version,scoring_version,client_platform,client_build
  FROM draft_run_decision_reports WHERE run_id=$1::uuid ORDER BY created_at,id`,[s.id]);
assert.equal(decisionReports.rows.length,1,'Only the valid revealed decision report should persist');
const decisionReport=decisionReports.rows[0];
assert.equal(decisionReport.player_id,guest.playerId);
assert.equal(decisionReport.puzzle_id,firstAnswer.puzzle.puzzle_id);
assert.equal(decisionReport.selected_card_id,firstAnswer.selectedId);
assert.equal(decisionReport.recommended_card_id,firstAnswer.ranking[0].id);
assert.equal(decisionReport.reason,'score_recommendation');
assert.equal(decisionReport.comment,'QA decision report');
assert.equal(decisionReport.environment,s.environment);
assert.equal(decisionReport.corpus_version,s.corpus_version);
assert.equal(decisionReport.scoring_version,s.scoring_version);
assert.equal(decisionReport.client_platform,'web');
assert.equal(decisionReport.client_build,'qa-smoke');
console.log('Decision-quality report persistence and server-owned metadata verified');
const completedBefore=(await query('SELECT result_persisted_at FROM draft_run_sessions WHERE id=$1::uuid',[s.id])).rows[0].result_persisted_at;
assert.ok(completedBefore);
await call(runApi,`/v1/runs/${s.id}`,undefined,guest.token);
assert.equal((await query('SELECT result_persisted_at FROM draft_run_sessions WHERE id=$1::uuid',[s.id])).rows[0].result_persisted_at,completedBefore,'Completed GET must not repeat persistence');
await query('UPDATE draft_run_sessions SET result_persisted_at=NULL WHERE id=$1::uuid',[s.id]);
await call(runApi,`/v1/runs/${s.id}`,undefined,guest.token);
assert.ok((await query('SELECT result_persisted_at FROM draft_run_sessions WHERE id=$1::uuid',[s.id])).rows[0].result_persisted_at,'Unacknowledged completion is recoverable');
assert.equal((await query('SELECT count(*) n FROM game_results WHERE player_id=$1::uuid AND client_result_id=$2',[guest.playerId,`draft-run:${s.id}`])).rows[0].n,'1');

const shared=await call(runApi,`/v1/runs/${s.id}/share`,{},guest.token);
assert.match(shared.id,/^[a-f0-9]{24}$/);
const creatorReopen=await call(runApi,'/v1/runs',{challenge:shared.id},guest.token);
assert.equal(creatorReopen.id,s.id,'The creator reopening a share must recover the original completed run');
assert.equal(
  Number((await query(
    'SELECT count(*) n FROM draft_run_sessions WHERE player_id=$1::uuid AND challenge_id=$2',
    [guest.playerId,shared.id],
  )).rows[0].n),
  0,
  'The creator reopening a share must not create a self-challenge row',
);
const challengeAuth=crypto.randomUUID();
await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[
  challengeAuth,'QA challenge retry',`qa-challenge-${challengeAuth}@example.invalid`,
]);
await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[challengeAuth,owner.playerId]);
const [challenged,challengeRetry]=await Promise.all([
  call(runApi,'/v1/runs',{challenge:shared.id},owner.token),
  call(runApi,'/v1/runs',{challenge:shared.id},owner.token),
]);
assert.equal(challengeRetry.id,challenged.id,'Concurrent shared starts must recover the same server run');
const challengeRows=await query(
  'SELECT id,start_idempotency_hash FROM draft_run_sessions WHERE player_id=$1::uuid AND challenge_id=$2 ORDER BY created_at,id',
  [owner.playerId,shared.id],
);
assert.equal(challengeRows.rows.length,1,'Concurrent shared starts must create one challenge session');
assert.equal(challengeRows.rows[0].start_idempotency_hash,digest(`shared:${shared.id}`));
assert.equal(
  Number((await query(
    "SELECT count(*) n FROM analytics_events WHERE player_id=$1::uuid AND event_name='game_started' AND event_props->>'run_id'=$2",
    [owner.playerId,challenged.id],
  )).rows[0].n),
  1,
  'Recovered shared starts must not emit a second game_started event',
);
await query('DELETE FROM account_links WHERE auth_user_id=$1::uuid',[challengeAuth]);
await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[challengeAuth]);

await call(growth,'/v1/results',{mode:'draft_run',score:100,clientResultId:'forged-'+tag},guest.token,403);
const privateProfile=await call(growth,'/v1/profile/me',undefined,guest.token);
assert.equal(privateProfile.player.profile_public,false);
await call(growth,'/v1/profile/'+privateProfile.player.profile_key,undefined,undefined,404);
await call(growth,'/v1/profile',{profilePublic:true},guest.token,403,{method:'PATCH'});

// Controlled auth fixtures exercise the real session/link/merge path without email delivery.
const authId=crypto.randomUUID(),authToken=crypto.randomUUID()+crypto.randomUUID();
await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[authId,'QA owner '+tag,`qa-${tag}@example.invalid`]);
await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()+interval \'1 hour\',now())',[authToken,authId]);
const authHeaders={'x-pack1-auth-session':authToken};

// Even an unfinished established Daily takes priority over a guest's finished score.
await query("INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json) VALUES($1::uuid,$2::date,'mixed','draft_run',100,'A','[]'::jsonb)",[guest.playerId,gameDateKey()]);
await call(growth,'/v1/account/link',{},owner.token,200,{headers:authHeaders});
const linked=await call(growth,'/v1/account/link',{},guest.token,200,{headers:authHeaders});
assert.equal(linked.token,owner.token);
const resumed=await call(runApi,'/v1/runs',{daily:true},owner.token);assert.equal(resumed.id,original.id);
assert.equal((await query("SELECT count(*) n FROM scores WHERE player_id=$1::uuid AND challenge_date=$2::date AND mode='draft_run'",[owner.playerId,gameDateKey()])).rows[0].n,'0');
const transferred=await call(runApi,`/v1/runs/${duplicate.id}`,undefined,owner.token);assert.equal(transferred.day,null);
assert.equal((await call(runApi,`/v1/runs/${s.id}`,undefined,owner.token)).complete,true);
await call(runApi,`/v1/runs/${s.id}`,undefined,guest.token,404);
const history=await call(growth,'/v1/profile/me',undefined,owner.token);
assert.equal(history.summary.games,1);assert.ok(history.by_set.length>=s.run_length-1);
assert.equal(history.player.profile_key,(await call(growth,'/v1/profile/me',undefined,owner.token)).player.profile_key);
const leaderboardName='AA Drafter '+tag;
await call(growth,'/v1/profile',{displayName:leaderboardName},owner.token,401,{method:'PATCH'});
let renamed=await call(growth,'/v1/profile',{displayName:leaderboardName},owner.token,200,{method:'PATCH',headers:authHeaders});
assert.equal(renamed.player.display_name,leaderboardName);
renamed=await call(growth,'/v1/profile',{displayName:leaderboardName},owner.token,200,{method:'PATCH',headers:authHeaders});
assert.equal(renamed.player.display_name,leaderboardName);
renamed=await call(growth,'/v1/profile',{showcaseAchievement:'first'},owner.token,200,{method:'PATCH',headers:authHeaders});
assert.equal(renamed.player.showcase_achievement,'first');

// Isolated-Postgres Insights access gate: only synthetic fixtures, never
// production history or account identifiers, are used or printed here.
async function privateInsights(path,token,headers={},expected=200) {
  const url=httpPrefix?httpPrefix+'pack1growth.compute.c-5.us-east-2.aws.neon.tech'+path:'https://packone.pro'+path;
  const request=new Request(url,{headers:{...(token?{authorization:'Bearer '+token}:{}),...headers},
    signal:AbortSignal.timeout(45000)});
  const response=await withPracticeAccess(request,query,r=>httpPrefix?fetch(r):growth.fetch(r));
  assert.equal(response.status,expected,'Private Insights must honor expected access status');
  return response.json();
}
const artificialPuzzle='synthetic-insight-'+tag;
const alternate=firstAnswer.puzzle.candidates.find(c=>c.id!==firstAnswer.historicalId);
assert.ok(alternate,'Isolated saved-pack fixture requires two different candidates');
const artificialAnswer={...firstAnswer,selectedId:alternate.id,selectedName:alternate.name,
  historicalMatch:false,score:90,puzzle:{...firstAnswer.puzzle,puzzle_id:artificialPuzzle}};
async function insertSavedInsightsFixture() {
  // Source metadata is borrowed from this isolated fixture run; no existing
  // saved answer is updated. A new explicitly synthetic decision is inserted.
  const inserted=await query(`INSERT INTO draft_run_sessions
    (player_id,seed,corpus_version,scoring_version,puzzle_ids,seen_sources,
     environment,rerolls,difficulty_version,difficulty_anchors,
     selection_version,measurement_qa,answers)
    SELECT player_id,seed,corpus_version,scoring_version,
      jsonb_set(puzzle_ids,'{0}',to_jsonb($2::text)),seen_sources,
      environment,rerolls,difficulty_version,difficulty_anchors,
      selection_version,false,jsonb_build_array($3::jsonb)
    FROM draft_run_sessions WHERE id=$1::uuid RETURNING id`,
  [s.id,artificialPuzzle,JSON.stringify(artificialAnswer)]);
  assert.equal(inserted.rows.length,1);
  const newId=inserted.rows[0].id;
  await query(`INSERT INTO draft_run_decision_observations
    (session_id,revision,round,puzzle_id,outcome,answered_at,selected_id,score,trophy_match)
    VALUES($1::uuid,0,1,$2,'pick',clock_timestamp(),$3,90,false)`,
  [newId,artificialPuzzle,alternate.id]);
  return newId;
}
const artificialSession=await insertSavedInsightsFixture();
const firstReview='/v1/profile/insights/decision?session_id='+artificialSession+
  '&round=1&puzzle_id='+encodeURIComponent(artificialPuzzle);
const reviewed=await privateInsights(firstReview,owner.token,authHeaders);
assert.equal(reviewed.selected.id,alternate.id);
assert.equal(reviewed.trophy.id,firstAnswer.historicalId);
assert.equal(reviewed.candidates.length,firstAnswer.puzzle.candidates.length);
assert.equal(reviewed.score,90);
const accountA=await privateInsights('/v1/profile/insights?environment=mixed&period=all',
  owner.token,authHeaders);
const ownHighlights=[...accountA.highlights.best,...accountA.highlights.misses].map(v=>v.puzzle_id);
assert.ok(ownHighlights.includes(artificialPuzzle),'Synthetic owner A decision appears in owner A shortlist');
assert.equal((await privateInsights('/v1/profile/insights?page=2',owner.token,authHeaders)).highlights.page,2);
await privateInsights('/v1/profile/insights?page=3',owner.token,authHeaders,400);

// A second linked account is not allowed to read A's saved decision or summaries.
const otherGuest=await call(growth,'/v1/session',{displayName:'Fixture peer '+tag});
const otherAuth=crypto.randomUUID(),otherToken=crypto.randomUUID()+crypto.randomUUID();
await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',
  [otherAuth,'Fixture peer',`qa-peer-${otherAuth}@example.invalid`]);
await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()+interval \'1 hour\',now())',
  [otherToken,otherAuth]);
await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',
  [otherAuth,otherGuest.playerId]);
const otherHeaders={'x-pack1-auth-session':otherToken};
await privateInsights(firstReview,otherGuest.token,otherHeaders,404);
await privateInsights(firstReview,otherGuest.token,{},401);
await privateInsights(firstReview,owner.token,{},401);
const expiredToken=crypto.randomUUID()+crypto.randomUUID();
await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()-interval \'1 minute\',now())',
  [expiredToken,authId]);
await privateInsights(firstReview,owner.token,{'x-pack1-auth-session':expiredToken},401);
await privateInsights(firstReview.replace('round=1','round=8'),owner.token,authHeaders,404);
await privateInsights(firstReview.replace(artificialPuzzle,'synthetic-wrong-puzzle'),
  owner.token,authHeaders,404);
const otherInsights=await privateInsights('/v1/profile/insights?environment=mixed&period=all',
  otherGuest.token,otherHeaders);
const otherHighlights=[...otherInsights.highlights.best,...otherInsights.highlights.misses].map(v=>v.puzzle_id);
assert.ok(ownHighlights.every(id=>!otherHighlights.includes(id)),
  'Account B can never receive account A saved decision highlights');

// A later encounter to the same synthetic puzzle remains excluded, even
// though it is still a valid, owner-owned saved answer in a recent session.
const repeatedSession=await insertSavedInsightsFixture();
const repeated='/v1/profile/insights/decision?session_id='+repeatedSession+
  '&round=1&puzzle_id='+encodeURIComponent(artificialPuzzle);
await privateInsights(repeated,owner.token,authHeaders,404);

// Native reads use the separate, real mobile-account session source.
const mobileOpaque=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const mobileOwner=mobileOpaque(),mobileOther=mobileOpaque(),mobileExpired=mobileOpaque();
for(const [token,auth,life] of [
  [mobileOwner,authId,'1 hour'],[mobileOther,otherAuth,'1 hour'],[mobileExpired,authId,'-1 hour']]){
  await query(`INSERT INTO account_sessions(session_hash,auth_user_id,csrf_hash,expires_at)
    VALUES($1,$2::uuid,$3,now()+$4::interval)`,
    [digest(token),auth,digest(mobileOpaque()),life]);
}
const nativePath=firstReview.replace('/v1/profile/','/v1/mobile/profile/');
assert.equal((await privateInsights(nativePath,owner.token,{'x-pack1-mobile-account':mobileOwner})).selected.id,alternate.id);
await privateInsights(nativePath,otherGuest.token,{'x-pack1-mobile-account':mobileOther},404);
await privateInsights(nativePath,owner.token,{'x-pack1-mobile-account':mobileExpired},401);
await privateInsights(nativePath,owner.token,{},401);
await privateInsights(nativePath.replace('round=1','round=7'),
  owner.token,{'x-pack1-mobile-account':mobileOwner},404);
await privateInsights(nativePath.replace(artificialPuzzle,'synthetic-wrong-puzzle'),
  owner.token,{'x-pack1-mobile-account':mobileOwner},404);
await privateInsights(repeated.replace('/v1/profile/','/v1/mobile/profile/'),
  owner.token,{'x-pack1-mobile-account':mobileOwner},404);

// Remove only synthetic, isolated fixtures created by this coverage.
await query('DELETE FROM draft_run_decision_observations WHERE session_id=ANY($1::uuid[])',
  ['{'+[artificialSession,repeatedSession].join(',')+'}']);
await query('DELETE FROM draft_run_sessions WHERE id=ANY($1::uuid[])',
  ['{'+[artificialSession,repeatedSession].join(',')+'}']);
await query('DELETE FROM account_sessions WHERE session_hash=ANY($1::text[])',
  ['{'+[mobileOwner,mobileOther,mobileExpired].map(digest).join(',')+'}']);
await query('DELETE FROM account_links WHERE auth_user_id=$1::uuid',[otherAuth]);
await query('DELETE FROM neon_auth.session WHERE "userId"=$1::uuid',[otherAuth]);
await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[otherAuth]);
await query('DELETE FROM neon_auth.session WHERE token=$1',[expiredToken]);
console.log('Isolated Insights detail: owner web/native access, crossed owners, guest, expired, wrong puzzle/round, reruns and private summary isolation passed.');

await query("INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json,details_json) VALUES($1::uuid,$2::date,'mixed','draft_run',100,'A','[]'::jsonb,jsonb_build_object('corpus_version',$3::text)) ON CONFLICT DO NOTHING",[owner.playerId,gameDateKey(),DRAFT_RUN_CORPUS_VERSION]);
const namedBoard=await call(runApi,'/v1/leaderboard?period=daily&environment=mixed');
const namedRow=namedBoard.rows.find(row=>row.display_name===leaderboardName);
assert.equal(namedRow?.display_name,leaderboardName);
assert.equal(namedRow?.showcase_achievement,'first');
await call(growth,'/v1/profile',{profilePublic:true},owner.token,200,{method:'PATCH',headers:authHeaders});
const publicProfile=await call(growth,'/v1/profile/'+history.player.profile_key);
const profileLookup=await call(growth,'/v1/profile-lookup',{names:[leaderboardName]});
assert.equal(profileLookup.profiles[leaderboardName.toLowerCase()]?.showcase_achievement,'first');
assert.doesNotMatch(JSON.stringify(publicProfile),/auth_user_id|player_id|@example|token|email|claimed/);
await call(growth,'/v1/profile',{profilePublic:false},owner.token,200,{method:'PATCH',headers:authHeaders});
await call(growth,'/v1/profile/'+history.player.profile_key,undefined,undefined,404);
console.log('Account merge, Daily priority and public profile privacy verified');

// Ties count people, and old qualifying results still earn milestones beyond the UI's 120 rows.
const board='qa-'+tag,peers=[];
for(let i=0;i<9;i++)peers.push(crypto.randomUUID());
await query('INSERT INTO players(id,display_name) SELECT value::uuid,$2 FROM jsonb_array_elements_text($1::jsonb)',[JSON.stringify(peers),'QA tie '+tag]);
await query("INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json) SELECT p.id::uuid,$2::date-1,$3,'top3',p.score,'B','[]'::jsonb FROM jsonb_to_recordset($1::jsonb)p(id text,score int)",[JSON.stringify([owner.playerId,...peers].map((id,i)=>({id,score:[90,95,95,90,90,90,10,10,10,10][i]}))),gameDateKey(),board]);
let p=await call(growth,'/v1/profile/me',undefined,owner.token),finish=p.daily_history.find(r=>r.set_id===board);
assert.equal(finish.rank,3);assert.equal(finish.percentile,60);assert.equal(finish.final,true);
const old=board+'old';
await query("INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json) SELECT p.id::uuid,$2::date-500,$3,'top3',p.score,'B','[]'::jsonb FROM jsonb_to_recordset($1::jsonb)p(id text,score int)",[JSON.stringify([owner.playerId,...peers].map((id,i)=>({id,score:i?50:90}))),gameDateKey(),old]);
for(const [offset,suffix] of [[501,'repeat-a'],[502,'repeat-b']]) {
  await query("INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json) SELECT p.id::uuid,$2::date - $4::int,$3,'top3',p.score,'B','[]'::jsonb FROM jsonb_to_recordset($1::jsonb)p(id text,score int)",[JSON.stringify([owner.playerId,...peers].map((id,i)=>({id,score:i?50:90}))),gameDateKey(),board+suffix,offset]);
}
await query("INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json) SELECT $1::uuid,$2::date-n,$3,'full',40,'D','[]'::jsonb FROM generate_series(2,125) n",[owner.playerId,gameDateKey(),board]);
p=await call(growth,'/v1/profile/me',undefined,owner.token);assert.equal(p.daily_history.length,120);assert.equal(p.best_final_percentile,10);assert.ok(p.achievements.find(a=>a.id==='top10').unlocked);assert.ok(p.achievements.find(a=>a.id==='top10_repeat').unlocked);
const achievementsBefore=(await query("SELECT count(*) n FROM analytics_events WHERE player_id=$1::uuid AND event_name='achievement_unlocked'",[owner.playerId])).rows[0].n;
await call(growth,'/v1/profile/me',undefined,owner.token);
assert.equal((await query("SELECT count(*) n FROM analytics_events WHERE player_id=$1::uuid AND event_name='achievement_unlocked'",[owner.playerId])).rows[0].n,achievementsBefore);
const analytics=(await query("SELECT event_name,count(*) n FROM analytics_events WHERE player_id=$1::uuid AND event_name IN('account_claimed','public_profile_enabled','leaderboard_name_changed') GROUP BY event_name",[owner.playerId])).rows;
assert.ok(analytics.every(r=>Number(r.n)===1));assert.equal(analytics.length,3);
await query('SELECT * FROM analytics_retention_cohorts LIMIT 1');await query('SELECT * FROM analytics_daily_next_day_retention LIMIT 1');
fs.mkdirSync('generated/review',{recursive:true});fs.writeFileSync('generated/review/backend-timings.json',JSON.stringify(timings,null,2));
console.log('Run request timings (isolated database, ms):',JSON.stringify(timings.filter(t=>t.path==='/v1/runs')));
console.log('Passed real database: idempotent practice creation, concurrent writes, versioned locked picks, retries, forged score rejection, guest privacy, account claim, merge, Daily conflicts, environment transfer, public opt-in, percentile ties, old milestones, event idempotency and funnel queries.');
