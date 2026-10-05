// Protected production canary for Issue #984.
// Uses only freshly created identities plus one retained QA Daily source owned by release acceptance.
// Never selects or mutates customer rows.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {corpusDatabase} from '../scripts/neon-corpus-db.mjs';

const [commit,connectionFile]=process.argv.slice(2);
assert.match(commit||'',/^[a-f0-9]{40}$/);
assert.ok(connectionFile);
const query=corpusDatabase(connectionFile);
const base='https://api.packone.pro';
const origin='https://packone.pro';
const tag=randomUUID().replaceAll('-','').slice(0,8);
const directory='artifacts/creator-canary';
fs.mkdirSync(directory,{recursive:true});
const report={commit,tag,passed:false,checks:[],practice:null,daily:null,cleanup:{passed:false}};
const writeReport=()=>fs.writeFileSync(directory+'/report.json',JSON.stringify(report,null,2)+'\n');
const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const parse=value=>typeof value==='string'?JSON.parse(value):value;

const owned={auth:[],players:new Set(),challenges:new Set(),challengers:new Set(),dailyFixture:null,adminToken:null};

async function call(path,{body,method,playerToken,accountToken,adminToken,status=[200]}={}) {
  const headers={origin};
  if(body!==undefined)headers['content-type']='application/json';
  if(playerToken)headers.authorization='Bearer '+playerToken;
  if(accountToken)headers['x-pack1-mobile-account']=accountToken;
  if(adminToken) {
    headers.cookie='__Host-pack1_account='+adminToken.session+'; __Secure-pack1_csrf='+adminToken.csrf;
    if((method||(body===undefined?'GET':'POST'))!=='GET')headers['x-pack1-csrf']=adminToken.csrf;
  }
  const response=await fetch(base+path,{
    method:method||(body===undefined?'GET':'POST'),
    headers,
    body:body===undefined?undefined:JSON.stringify(body),
    redirect:'error',
    signal:AbortSignal.timeout(90000),
  });
  const data=await response.json().catch(()=>({}));
  assert.ok(status.includes(response.status),path+': HTTP '+response.status+'; '+JSON.stringify(data));
  return {response,data};
}

async function staticFetch(url) {
  return fetch(url,{headers:{'cache-control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(30000)});
}

async function createPlayer(label) {
  const {data}=await call('/growth/v1/player/session',{
    body:{displayName:'Creator Canary '+label+' '+tag},
    status:[200,201],
  });
  assert.match(data.playerId||'',/^[a-f0-9-]{36}$/i);
  assert.match(data.token||'',/^p1_/);
  owned.players.add(data.playerId);
  return {playerId:data.playerId,playerToken:data.token};
}

async function createAuth(label,{playerId=null,admin=false}={}) {
  const authId=randomUUID();
  const session=randomBytes(32).toString('base64url');
  const csrf=randomBytes(32).toString('base64url');
  const email='delivered+creator-canary-'+tag+'-'+label+'@resend.dev';
  const name='Creator Canary '+label+' '+tag;
  await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,true)',[authId,name,email]);
  await query("INSERT INTO account_sessions(session_hash,auth_user_id,csrf_hash,expires_at) VALUES($1,$2::uuid,$3,now()+interval '60 minutes')",[digest(session),authId,digest(csrf)]);
  if(playerId)await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[authId,playerId]);
  if(admin)await query('INSERT INTO pack1_admins(auth_user_id) VALUES($1::uuid)',[authId]);
  owned.auth.push({authId,email,name,playerId,admin});
  return {authId,session,csrf,email,name};
}

async function markPublic(playerId) {
  await query("UPDATE players SET profile_public=true,username_owned=true,updated_at=now() WHERE id=$1::uuid",[playerId]);
  const row=(await query('SELECT profile_public,username_owned,public_identity_hidden_at FROM players WHERE id=$1::uuid',[playerId])).rows[0];
  assert.equal(row?.profile_public,true);
  assert.equal(row?.username_owned,true);
  assert.equal(row?.public_identity_hidden_at,null);
}

async function grantPractice(authId) {
  const ref='creator-canary-'+tag;
  await query("INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference) VALUES($1::uuid,'unlimited_cube_practice','test',$2),($1::uuid,'custom_corpus','test',$2) ON CONFLICT DO NOTHING",[authId,ref]);
}

async function finishOrdinary(run,actor) {
  while(!run.complete) {
    const round=run.answers.length;
    assert.ok(run.current);
    const pick={
      revision:run.revision,
      round,
      puzzleId:run.current.puzzle_id,
      cardId:run.current.candidates[0].id,
    };
    ({data:run}=await call('/draft/v1/runs/'+run.id+'/pick',{body:pick,playerToken:actor.playerToken,accountToken:actor.accountToken}));
  }
  assert.equal(run.answers.length,8);
  return run;
}

function noCreatorReveal(run) {
  for(const answer of run.answers||[]) {
    assert.equal(Object.hasOwn(answer,'creatorId'),false);
    assert.equal(Object.hasOwn(answer,'creatorName'),false);
    assert.equal(Object.hasOwn(answer,'creatorMatch'),false);
  }
}

async function finishCreator(run,actor,sourceAnswers,sourceScore) {
  assert.equal(run.answers.length,0);
  assert.equal(run.score,null);
  for(let round=0;round<8;round++) {
    assert.equal(run.answers.length,round);
    for(let i=round;i<8;i++)assert.ok(sourceAnswers[i]?.selectedId);
    const pick={
      revision:run.revision,
      round,
      puzzleId:run.current.puzzle_id,
      cardId:run.current.candidates[0].id,
    };
    ({data:run}=await call('/draft/v1/runs/'+run.id+'/pick',{body:pick,playerToken:actor.playerToken,accountToken:actor.accountToken}));
    assert.equal(run.answers.length,round+1);
    assert.equal(run.answers[round].creatorId,sourceAnswers[round].selectedId);
    assert.equal(run.answers[round].creatorName,sourceAnswers[round].selectedName);
    for(let i=round+1;i<run.answers.length;i++)assert.fail('future creator answer leaked');
  }
  assert.equal(run.complete,true);
  assert.equal(run.comparison?.kind,'creator');
  assert.equal(Number(run.comparison?.score),Number(sourceScore));
  const creatorMatches=run.answers.filter(a=>a.creatorMatch).length;
  const trophyMatches=run.answers.filter(a=>a.historicalMatch).length;
  assert.equal(run.comparison.creator_matches,creatorMatches);
  assert.equal(run.comparison.trophy_matches,trophyMatches);
  const expected=run.score>sourceScore?'win':run.score<sourceScore?'loss':'tie';
  assert.equal(run.comparison.outcome,expected);
  return run;
}

async function adminResolve(adminToken,payload) {
  return (await call('/growth/v1/admin/creator-challenges/resolve',{adminToken,body:payload})).data.source;
}

async function adminCreate(adminToken,payload) {
  const {data}=await call('/growth/v1/admin/creator-challenges',{adminToken,body:payload});
  assert.match(data.challenge?.id||'',/^[a-f0-9-]{36}$/i);
  owned.challenges.add(data.challenge.id);
  return data.challenge;
}

async function publication(adminToken,id,action) {
  const {data}=await call('/growth/v1/admin/creator-challenges/'+id+'/publication',{
    adminToken,body:{action},status:[200,202],
  });
  assert.equal(data.ok,true);
  return data;
}

async function waitPublication(adminToken,id,expected,{minutes=18}={}) {
  const deadline=Date.now()+minutes*60_000;
  let last=null;
  while(Date.now()<deadline) {
    const result=await call('/growth/v1/admin/creator-challenges/'+id+'/publication',{adminToken});
    last=result.data;
    if(last.challenge?.status===expected&&last.live_verified===true)return last.challenge;
    if(last.dispatch?.state==='rejected')throw Error('creator publication rejected: '+JSON.stringify(last));
    await sleep(10_000);
  }
  throw Error('creator publication did not reach '+expected+': '+JSON.stringify(last));
}

async function verifyPublishedRoute(challenge,sourceAnswers) {
  const url='https://packone.pro/creator/'+challenge.slug+'/';
  const htmlResponse=await staticFetch(url);
  assert.equal(htmlResponse.status,200);
  const html=await htmlResponse.text();
  assert.ok(html.includes('data-creator-challenge-id="'+challenge.id+'"'));
  assert.ok(html.includes('data-creator-challenge-status="published"'));
  assert.ok(html.includes('Creator Canary'));
  for(const answer of sourceAnswers)assert.equal(html.includes(String(answer.selectedId)),false,'static page must not contain creator answers');
  const image=await staticFetch(url+'creator-card.png');
  assert.equal(image.status,200);
  assert.match(String(image.headers.get('content-type')||''),/^image\//i);
}

async function verifyRetiredRoute(challenge) {
  const url='https://packone.pro/creator/'+challenge.slug+'/';
  const htmlResponse=await staticFetch(url);
  assert.equal(htmlResponse.status,200);
  const html=await htmlResponse.text();
  assert.ok(html.includes('data-creator-challenge-id="'+challenge.id+'"'));
  assert.ok(html.includes('data-creator-challenge-status="retired"'));
  assert.equal(html.includes(challenge.creator_public_name),false);
  const image=await staticFetch(url+'creator-card.png');
  assert.ok([404,410].includes(image.status),'retired creator card must be unavailable');
  await call('/draft/v1/creator-challenges/'+challenge.slug,{status:[404,410]});
}

async function publicInfo(actor,challenge) {
  const first=(await call('/draft/v1/creator-challenges/'+challenge.slug,{playerToken:actor.playerToken,accountToken:actor.accountToken})).data;
  const second=(await call('/draft/v1/creator-challenges/'+challenge.slug,{playerToken:actor.playerToken,accountToken:actor.accountToken})).data;
  assert.equal(first.id,challenge.id);
  assert.equal(second.id,challenge.id);
  return first;
}

async function startCreator(actor,challenge) {
  const first=(await call('/draft/v1/runs',{body:{creatorChallenge:challenge.id},playerToken:actor.playerToken,accountToken:actor.accountToken})).data;
  const retry=(await call('/draft/v1/runs',{body:{creatorChallenge:challenge.id},playerToken:actor.playerToken,accountToken:actor.accountToken})).data;
  assert.equal(retry.id,first.id,'creator start retry must reuse the participant run');
  assert.equal(first.creator_challenge_id,challenge.id);
  assert.equal(first.day,null);
  noCreatorReveal(first);
  return first;
}

async function challengeDetail(adminToken,id) {
  return (await call('/growth/v1/admin/creator-challenges/'+id,{adminToken})).data.challenge;
}

async function verifyEventDedupe(playerId,challengeId) {
  const rows=(await query("SELECT event_name,count(*)::int n FROM analytics_events WHERE player_id=$1::uuid AND event_name IN ('creator_challenge_open','creator_challenge_started','acquisition_touch') AND (event_props->>'creator_challenge_id'=$2 OR event_name='acquisition_touch') GROUP BY event_name",[playerId,challengeId])).rows;
  const counts=Object.fromEntries(rows.map(r=>[r.event_name,Number(r.n)]));
  assert.equal(counts.creator_challenge_open,1,'creator open must dedupe');
  assert.equal(counts.creator_challenge_started,1,'creator start must dedupe');
  assert.equal(counts.acquisition_touch,1,'creator acquisition touch must dedupe');
}

async function retireAdmin(adminToken,challenge) {
  await publication(adminToken,challenge.id,'retire');
  const retired=await waitPublication(adminToken,challenge.id,'retired');
  await verifyRetiredRoute(challenge);
  return retired;
}

async function deletePracticeOwner(adminToken,ownerAuth,challenge) {
  const path='/growth/v1/admin/users/'+ownerAuth.authId+'/delete';
  const body={confirm:'DELETE',reason:'Issue #984 creator production canary '+tag,notifyUser:false};
  let result=(await call(path,{adminToken,body,status:[200,202]})).data;
  const operationId=result.operationId;
  assert.match(operationId||'',/^[a-f0-9-]{36}$/i);
  const deadline=Date.now()+18*60_000;
  while(Date.now()<deadline) {
    const state=(await call('/growth/v1/admin/users/'+ownerAuth.authId+'/deletion',{adminToken,status:[200,404]})).data;
    if(state.deletion?.state==='complete') {
      await verifyRetiredRoute(challenge);
      return state.deletion;
    }
    await sleep(10_000);
    result=(await call(path,{adminToken,body,status:[200,202]})).data;
    assert.equal(result.operationId,operationId);
  }
  throw Error('practice owner deletion did not complete after creator privacy retirement');
}

async function cleanupOwned() {
  // Retire any route that escaped the main flow before removing its database row.
  // A failed retirement remains a hard canary failure rather than leaving a live test route.
  const challengeIds=[...owned.challenges];
  if(owned.adminToken) {
    for(const id of challengeIds) {
      const row=(await query('SELECT id,slug,status,creator_public_name,publication_detail FROM creator_challenges WHERE id=$1::uuid',[id])).rows[0];
      if(!row)continue;
      const detail=parse(row.publication_detail||{});
      if(row.status!=='retired'||detail?.live_verified!==true) {
        const challenge={...row,creator_public_name:row.creator_public_name};
        await publication(owned.adminToken,id,'retire');
        await waitPublication(owned.adminToken,id,'retired');
        await verifyRetiredRoute(challenge);
      }
    }
  }
  // Retired static routes are intentionally retained as neutral tombstones.
  // Remove only rows created by this canary and restore the borrowed Daily fixture.
  if(challengeIds.length) {
    await query("DELETE FROM analytics_events WHERE event_props->>'creator_challenge_id'=ANY($1::text[])",[challengeIds]);
    await query('DELETE FROM game_results WHERE creator_challenge_id=ANY($1::uuid[])',[challengeIds]);
    await query('DELETE FROM draft_run_sessions WHERE creator_challenge_id=ANY($1::uuid[])',[challengeIds]);
    await query('DELETE FROM creator_challenge_audit WHERE creator_challenge_id=ANY($1::uuid[])',[challengeIds]);
    await query('DELETE FROM creator_challenges WHERE id=ANY($1::uuid[])',[challengeIds]);
  }
  const playerIds=[...owned.challengers];
  if(playerIds.length) {
    await query('DELETE FROM draft_run_shares WHERE session_id IN (SELECT id FROM draft_run_sessions WHERE player_id=ANY($1::uuid[]))',[playerIds]);
    await query('DELETE FROM game_results WHERE player_id=ANY($1::uuid[])',[playerIds]);
    await query('DELETE FROM analytics_events WHERE player_id=ANY($1::uuid[])',[playerIds]);
    await query('DELETE FROM draft_run_sessions WHERE player_id=ANY($1::uuid[])',[playerIds]);
    await query('DELETE FROM players WHERE id=ANY($1::uuid[])',[playerIds]);
  }
  if(owned.dailyFixture) {
    const f=owned.dailyFixture;
    await query('UPDATE draft_run_sessions SET measurement_qa=$2::boolean WHERE id=$1::uuid',[f.sessionId,f.measurementQa]);
    await query('UPDATE players SET profile_public=$2::boolean,username_owned=$3::boolean,updated_at=now() WHERE id=$1::uuid',[f.playerId,f.profilePublic,f.usernameOwned]);
  }
  for(const f of [...owned.auth].reverse()) {
    await query('DELETE FROM entitlement_grants WHERE auth_user_id=$1::uuid AND provider=$2',[f.authId,'test']).catch(()=>{});
    await query('DELETE FROM pack1_admins WHERE auth_user_id=$1::uuid',[f.authId]).catch(()=>{});
    await query('DELETE FROM account_sessions WHERE auth_user_id=$1::uuid',[f.authId]).catch(()=>{});
    await query('DELETE FROM neon_auth.session WHERE "userId"=$1::uuid',[f.authId]).catch(()=>{});
    await query('DELETE FROM account_links WHERE auth_user_id=$1::uuid',[f.authId]).catch(()=>{});
    await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid AND email=$2',[f.authId,f.email]).catch(()=>{});
  }
  for(const playerId of owned.players) {
    if(owned.dailyFixture?.playerId===playerId)continue;
    await query('DELETE FROM draft_run_shares WHERE session_id IN (SELECT id FROM draft_run_sessions WHERE player_id=$1::uuid)',[playerId]).catch(()=>{});
    await query('DELETE FROM game_results WHERE player_id=$1::uuid',[playerId]).catch(()=>{});
    await query('DELETE FROM analytics_events WHERE player_id=$1::uuid',[playerId]).catch(()=>{});
    await query('DELETE FROM draft_run_sessions WHERE player_id=$1::uuid',[playerId]).catch(()=>{});
    await query('DELETE FROM players WHERE id=$1::uuid AND display_name LIKE $2',[playerId,'Creator Canary %']).catch(()=>{});
  }
}

async function selectClosedDailyFixture() {
  const row=(await query("SELECT s.id session_id,s.player_id,s.day::text day,s.environment,s.score,s.answers,s.measurement_qa,p.profile_public,p.username_owned,p.public_identity_hidden_at,p.display_name FROM draft_run_sessions s JOIN players p ON p.id=s.player_id WHERE s.day IS NOT NULL AND s.day < (now() AT TIME ZONE 'America/Los_Angeles')::date AND s.measurement_qa=true AND p.display_name LIKE 'QA release %' AND s.score IS NOT NULL AND jsonb_array_length(s.answers)=8 AND jsonb_array_length(s.puzzle_ids)=8 AND NOT EXISTS (SELECT 1 FROM account_links a WHERE a.player_id=s.player_id) ORDER BY s.day DESC,s.updated_at DESC LIMIT 1")).rows[0];
  assert.ok(row,'A retained closed QA release Daily is required; never fall back to customer data.');
  assert.equal(row.public_identity_hidden_at,null);
  const f={
    sessionId:row.session_id,
    playerId:row.player_id,
    day:row.day,
    environment:row.environment,
    score:Number(row.score),
    answers:parse(row.answers),
    measurementQa:row.measurement_qa===true||row.measurement_qa==='t',
    profilePublic:row.profile_public===true||row.profile_public==='t',
    usernameOwned:row.username_owned===true||row.username_owned==='t',
    displayName:row.display_name,
  };
  assert.equal(f.measurementQa,true);
  owned.dailyFixture=f;
  owned.players.add(f.playerId);
  await query('UPDATE draft_run_sessions SET measurement_qa=false WHERE id=$1::uuid',[f.sessionId]);
  await query('UPDATE players SET profile_public=true,username_owned=true,updated_at=now() WHERE id=$1::uuid',[f.playerId]);
  return f;
}

async function run() {
  const health=(await call('/draft/health?quick=1')).data;
  assert.equal(health.release_commit,commit,'canary must target the corrected released revision');
  report.checks.push('exact corrected production Draft Run revision');

  const admin=await createAuth('admin',{admin:true});
  owned.adminToken=admin;

  // Practice source: create and complete a real non-QA production Practice run.
  const practicePlayer=await createPlayer('Practice');
  const practiceOwnerAuth=await createAuth('practice-owner',{playerId:practicePlayer.playerId});
  await markPublic(practicePlayer.playerId);
  await grantPractice(practiceOwnerAuth.authId);
  const practiceActor={...practicePlayer,accountToken:practiceOwnerAuth.session};
  let practice=(await call('/draft/v1/runs',{
    body:{daily:false,environment:'mixed'},
    playerToken:practiceActor.playerToken,
    accountToken:practiceActor.accountToken,
  })).data;
  practice=await finishOrdinary(practice,practiceActor);
  const practiceSource=(await query('SELECT score,answers,measurement_qa FROM draft_run_sessions WHERE id=$1::uuid',[practice.id])).rows[0];
  assert.equal(practiceSource.measurement_qa,false);
  const practiceAnswers=parse(practiceSource.answers);
  const share=(await call('/draft/v1/runs/'+practice.id+'/share',{body:{},playerToken:practiceActor.playerToken,accountToken:practiceActor.accountToken})).data;
  assert.match(share.id||'',/^[a-f0-9]{24}$/);
  const resolvedPractice=await adminResolve(admin,{source_type:'practice',share:share.id});
  assert.equal(resolvedPractice.source_session_id,practice.id);
  const practiceChallenge=await adminCreate(admin,{
    source_type:'practice',
    share:share.id,
    slug:'creator-canary-practice-'+tag,
    creator_public_name:'Creator Canary',
    headline:'Can you beat Creator Canary?',
    acquisition_source:'creator',
    acquisition_campaign:'creator-canary-'+tag,
    acquisition_medium:'creator',
  });
  await publication(admin,practiceChallenge.id,'publish');
  const publishedPractice=await waitPublication(admin,practiceChallenge.id,'published');
  await verifyPublishedRoute(publishedPractice,practiceAnswers);

  // Source-owner self-open returns the original authoritative run.
  const self=(await call('/draft/v1/runs',{body:{creatorChallenge:practiceChallenge.id},playerToken:practiceActor.playerToken,accountToken:practiceActor.accountToken})).data;
  assert.equal(self.id,practice.id);
  assert.equal(self.creator_source_owner?.challenge_id,practiceChallenge.id);

  const practiceChallenger=await createPlayer('Practice Challenger');
  owned.challengers.add(practiceChallenger.playerId);
  await publicInfo(practiceChallenger,practiceChallenge);
  let practiceReplay=await startCreator(practiceChallenger,practiceChallenge);
  practiceReplay=await finishCreator(practiceReplay,practiceChallenger,practiceAnswers,Number(practiceSource.score));
  await verifyEventDedupe(practiceChallenger.playerId,practiceChallenge.id);
  let practiceStats=await challengeDetail(admin,practiceChallenge.id);
  assert.equal(Number(practiceStats.attempts),1);
  assert.equal(Number(practiceStats.wins)+Number(practiceStats.ties)+Number(practiceStats.losses),1);
  const practiceDeletion=await deletePracticeOwner(admin,practiceOwnerAuth,practiceChallenge);
  assert.equal(practiceDeletion.state,'complete');
  report.practice={
    challenge_id:practiceChallenge.id,
    slug:practiceChallenge.slug,
    source_session_id:practice.id,
    source_score:Number(practiceSource.score),
    challenger_score:Number(practiceReplay.score),
    outcome:practiceReplay.comparison.outcome,
    privacy_retirement:'verified',
  };
  report.checks.push('Practice publish/play/spoiler/result/stats/self-open/privacy retirement');

  // Daily source: temporarily promote only a retained QA release fixture, never customer data.
  const dailySource=await selectClosedDailyFixture();
  const dailyOwnerAuth=await createAuth('daily-owner',{playerId:dailySource.playerId,admin:true});
  const resolvedDaily=await adminResolve(admin,{
    source_type:'daily',
    creator_player_id:dailySource.playerId,
    source_session_id:dailySource.sessionId,
  });
  assert.equal(resolvedDaily.source_session_id,dailySource.sessionId);
  assert.equal(resolvedDaily.day,dailySource.day);
  const dailyChallenge=await adminCreate(admin,{
    source_type:'daily',
    creator_player_id:dailySource.playerId,
    source_session_id:dailySource.sessionId,
    slug:'creator-canary-daily-'+tag,
    creator_public_name:'Creator Canary',
    headline:'Can you beat Creator Canary?',
    acquisition_source:'creator',
    acquisition_campaign:'creator-canary-'+tag,
    acquisition_medium:'creator',
  });
  await publication(admin,dailyChallenge.id,'publish');
  const publishedDaily=await waitPublication(admin,dailyChallenge.id,'published');
  await verifyPublishedRoute(publishedDaily,dailySource.answers);

  // Direction 1: creator replay first, then the real current Daily remains available.
  const challengerA=await createPlayer('Daily Challenger A');
  owned.challengers.add(challengerA.playerId);
  await publicInfo(challengerA,dailyChallenge);
  let replayA=await startCreator(challengerA,dailyChallenge);
  replayA=await finishCreator(replayA,challengerA,dailySource.answers,dailySource.score);
  const realAfter=(await call('/draft/v1/runs',{body:{daily:true,environment:'mixed'},playerToken:challengerA.playerToken})).data;
  assert.ok(realAfter.day);
  assert.notEqual(realAfter.id,replayA.id);
  assert.equal(realAfter.creator_challenge_id,null);

  // Direction 2: a real Daily started first remains the same attempt after the creator replay.
  const challengerB=await createPlayer('Daily Challenger B');
  owned.challengers.add(challengerB.playerId);
  const realBefore=(await call('/draft/v1/runs',{body:{daily:true,environment:'mixed'},playerToken:challengerB.playerToken})).data;
  await publicInfo(challengerB,dailyChallenge);
  let replayB=await startCreator(challengerB,dailyChallenge);
  replayB=await finishCreator(replayB,challengerB,dailySource.answers,dailySource.score);
  const realResumed=(await call('/draft/v1/runs',{body:{daily:true,environment:'mixed'},playerToken:challengerB.playerToken})).data;
  assert.equal(realResumed.id,realBefore.id);
  assert.notEqual(replayB.id,realBefore.id);
  await verifyEventDedupe(challengerA.playerId,dailyChallenge.id);
  await verifyEventDedupe(challengerB.playerId,dailyChallenge.id);
  const dailyStats=await challengeDetail(admin,dailyChallenge.id);
  assert.equal(Number(dailyStats.attempts),2);
  assert.equal(Number(dailyStats.wins)+Number(dailyStats.ties)+Number(dailyStats.losses),2);
  await retireAdmin(admin,dailyChallenge);
  report.daily={
    challenge_id:dailyChallenge.id,
    slug:dailyChallenge.slug,
    source_session_id:dailySource.sessionId,
    source_day:dailySource.day,
    source_environment:dailySource.environment,
    source_score:dailySource.score,
    challenger_scores:[Number(replayA.score),Number(replayB.score)],
    daily_isolation:'both directions verified',
    admin_retirement:'verified',
  };
  report.checks.push('closed Daily publish/play/spoiler/result/stats/acquisition/Daily isolation/Admin retirement');

  report.passed=true;
  writeReport();
}

let originalError=null;
try {
  await run();
} catch(error) {
  originalError=error;
  report.error=String(error?.message||error);
  writeReport();
} finally {
  try {
    await cleanupOwned();
    report.cleanup={passed:true,borrowed_daily_restored:Boolean(owned.dailyFixture)};
  } catch(error) {
    report.cleanup={passed:false,error:String(error?.message||error)};
    if(!originalError)originalError=error;
  }
  writeReport();
}
if(originalError)throw originalError;
console.log(JSON.stringify(report,null,2));
