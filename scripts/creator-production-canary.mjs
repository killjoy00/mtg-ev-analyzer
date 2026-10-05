import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {corpusDatabase} from './neon-corpus-db.mjs';
import {gameDateKey} from '../game-date.mjs';
import {requestCreatorPrivacyRetirement} from '../worker/creator-challenge-publish.mjs';

const [connectionFile,expectedRelease]=process.argv.slice(2);
assert.ok(connectionFile);
assert.match(expectedRelease||'',/^[a-f0-9]{40}$/);
assert.equal(process.env.PACK1_CREATOR_CANARY,'1','Explicit creator production-canary acknowledgement required.');
assert.match(String(process.env.PACK1_LAUNCH_WATCHER_GITHUB_TOKEN||''),/^github_pat_[A-Za-z0-9_]{20,}$/);

const query=corpusDatabase(connectionFile);
const api='https://api.packone.pro',origin='https://packone.pro';
const artifactDir='artifacts/creator-production-canary';
fs.mkdirSync(artifactDir,{recursive:true});
const report={expected_release:expectedRelease,passed:false,checks:[],challenges:[],cleanup:{},started_at:new Date().toISOString()};
const createdChallenges=[];
const borrowedSources=[];
let admin=null,guest=null,practiceFixture=null;

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const parseJson=value=>typeof value==='string'?JSON.parse(value):value;
const count=async(sql,params=[])=>Number((await query(sql,params)).rows[0]?.n||0);
const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const mask=value=>value&&console.log('::add-mask::'+value);

async function call(path,{method,body,token,player,status=[200]}={}) {
  const headers={origin};
  if(body!==undefined)headers['content-type']='application/json';
  if(token){
    headers.cookie='__Host-pack1_account='+token.session+'; __Secure-pack1_csrf='+token.csrf;
    if((method||'POST')!=='GET')headers['x-pack1-csrf']=token.csrf;
  }
  if(player)headers['x-pack1-mobile-session']=player;
  const response=await fetch(api+path,{
    method:method||(body===undefined?'GET':'POST'),
    headers,
    body:body===undefined?undefined:JSON.stringify(body),
    redirect:'error',
    signal:AbortSignal.timeout(90000),
  });
  const text=await response.text();
  let data={};
  try{data=text?JSON.parse(text):{};}catch{}
  assert.ok(status.includes(response.status),path+': HTTP '+response.status+' code '+String(data?.code||'none'));
  return {response,data,text};
}

async function markerCheck() {
  for(const service of ['legacy','growth','draft']){
    const {data}=await call('/'+service+'/health?quick=1');
    assert.equal(data.ok,true,service+' health');
    assert.equal(data.release_commit,expectedRelease,service+' exact release marker');
  }
  report.checks.push('live legacy/growth/draft release markers match corrected release');
}

async function createAdminFixture() {
  const tag='qa-creator-canary-'+randomUUID().slice(0,8);
  const authId=randomUUID(),session=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
  mask(session);mask(csrf);
  const email='delivered+'+tag+'@resend.dev',name='QA Creator Canary '+tag;
  await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,true)',[authId,name,email]);
  await query("INSERT INTO account_sessions(session_hash,auth_user_id,csrf_hash,expires_at) VALUES($1,$2::uuid,$3,now()+interval '2 hours')",[digest(session),authId,digest(csrf)]);
  await query('INSERT INTO pack1_admins(auth_user_id) VALUES($1::uuid)',[authId]);
  return {authId,email,name,token:{session,csrf}};
}

async function deleteAdminFixture(fixture) {
  if(!fixture)return;
  await query('DELETE FROM pack1_admins WHERE auth_user_id=$1::uuid',[fixture.authId]);
  await query('DELETE FROM account_sessions WHERE auth_user_id=$1::uuid',[fixture.authId]);
  await query('DELETE FROM neon_auth.session WHERE "userId"=$1::uuid',[fixture.authId]);
  await query('DELETE FROM account_links WHERE auth_user_id=$1::uuid',[fixture.authId]);
  await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid AND email=$2 AND name=$3',[fixture.authId,fixture.email,fixture.name]);
}

async function playerToken(playerId) {
  const secret=(await query("SELECT value FROM settings WHERE key='player_secret'")).rows[0]?.value;
  assert.ok(secret,'player token secret');
  const signature=createHmac('sha256',String(secret)).update(playerId).digest('base64url');
  const token='p1_'+playerId+'.'+signature;mask(token);return token;
}

async function createFreshPracticeSource() {
  const tag=randomUUID().slice(0,8);
  const created=(await call('/growth/v1/player/session',{
    body:{displayName:'QA Creator Source '+tag},status:[201],
  })).data;
  assert.match(created.playerId||'',/^[a-f0-9-]{36}$/i);
  const playerId=created.playerId,player=await playerToken(playerId);
  const authId=randomUUID(),session=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
  const email='qa-creator-source-'+tag+'@example.invalid',name='QA Creator Source '+tag;
  mask(session);mask(csrf);
  await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,true)',[authId,name,email]);
  await query("INSERT INTO account_sessions(session_hash,auth_user_id,csrf_hash,expires_at) VALUES($1,$2::uuid,$3,now()+interval '2 hours')",[
    digest(session),authId,digest(csrf),
  ]);
  await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[authId,playerId]);
  await query('UPDATE players SET profile_public=true,updated_at=now() WHERE id=$1::uuid',[playerId]);
  const token={session,csrf};

  let run=(await call('/draft/v1/runs',{
    body:{environment:'mixed'},player,token,status:[200,201],
  })).data;
  assert.equal(run.day,null);
  assert.equal(run.answers.length,0);
  while(!run.complete) {
    const round=run.answers.length;
    run=(await call('/draft/v1/runs/'+run.id+'/pick',{
      body:{revision:run.revision,round,puzzleId:run.current.puzzle_id,cardId:run.current.candidates[0].id},
      player,token,
    })).data;
  }
  assert.equal(run.answers.length,8);
  const shared=(await call('/draft/v1/runs/'+run.id+'/share',{body:{},player,token})).data;
  assert.match(shared.id||'',/^[a-f0-9]{24}$/);

  const row=(await query(`SELECT s.id::text session_id,s.player_id::text player_id,
      s.score::int score,s.environment,s.answers,s.puzzle_ids,s.measurement_qa,
      p.profile_public,p.public_identity_hidden_at,p.display_name
    FROM draft_run_sessions s JOIN players p ON p.id=s.player_id
    WHERE s.id=$1::uuid AND s.player_id=$2::uuid`,[run.id,playerId])).rows[0];
  assert.ok(row);
  assert.equal(row.measurement_qa,false,'fresh Practice canary source must exercise ordinary creator eligibility');
  practiceFixture={authId,email,name,playerId,player,token,sessionId:run.id,shareId:shared.id};
  report.checks.push('fresh QA Practice source completed and shared through live production APIs');
  return {...row,share_id:shared.id};
}

async function cleanupFreshPracticeSource() {
  const fixture=practiceFixture;
  if(!fixture)return;
  await query('UPDATE draft_run_sessions SET measurement_qa=true WHERE id=$1::uuid AND player_id=$2::uuid',[
    fixture.sessionId,fixture.playerId,
  ]);
  await query(`DELETE FROM analytics_events WHERE player_id=$1::uuid`,[fixture.playerId]);
  await query('DELETE FROM draft_run_shares WHERE id=$1 AND session_id=$2::uuid',[fixture.shareId,fixture.sessionId]);
  await query('DELETE FROM account_sessions WHERE auth_user_id=$1::uuid',[fixture.authId]);
  await query('DELETE FROM neon_auth.session WHERE "userId"=$1::uuid',[fixture.authId]);
  await query('DELETE FROM account_links WHERE auth_user_id=$1::uuid',[fixture.authId]);
  await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid AND email=$2 AND name=$3',[
    fixture.authId,fixture.email,fixture.name,
  ]);
  await query(`UPDATE players SET profile_public=false,username_owned=false,updated_at=now()
    WHERE id=$1::uuid AND display_name LIKE 'QA Creator Source %'`,[fixture.playerId]);
}

async function borrowSource(row,type) {
  assert.ok(row?.session_id&&row?.player_id,type+' retained QA source is required.');
  assert.equal(row.measurement_qa,true,type+' retained source must begin as measurement QA.');
  borrowedSources.push({
    type,
    session_id:row.session_id,
    player_id:row.player_id,
    measurement_qa:true,
    profile_public:Boolean(row.profile_public),
  });
  await query('UPDATE draft_run_sessions SET measurement_qa=false WHERE id=$1::uuid',[row.session_id]);
  await query('UPDATE players SET profile_public=true,updated_at=now() WHERE id=$1::uuid',[row.player_id]);
  return {...row,measurement_qa:false,profile_public:true};
}

async function restoreBorrowedSources() {
  for(const source of [...borrowedSources].reverse()) {
    await query('UPDATE draft_run_sessions SET measurement_qa=$2::boolean WHERE id=$1::uuid',[
      source.session_id,source.measurement_qa,
    ]);
    await query('UPDATE players SET profile_public=$2::boolean,updated_at=now() WHERE id=$1::uuid',[
      source.player_id,source.profile_public,
    ]);
  }
}

async function candidatePools() {
  // Practice is generated fresh through the live production API using an
  // owned QA player/account. Daily must already be closed, so borrow only the
  // exact retained QA release fixture from the corrected backend release.
  const practice=await createFreshPracticeSource();
  const dailyName='QA release '+expectedRelease.slice(0,7);
  const dailyRow=(await query(`SELECT s.id::text session_id,s.player_id::text player_id,s.day::text AS source_day,
      s.score::int score,s.environment,s.answers,s.puzzle_ids,s.measurement_qa,
      p.profile_public,p.public_identity_hidden_at,p.display_name
    FROM draft_run_sessions s
    JOIN players p ON p.id=s.player_id
    WHERE s.day IS NOT NULL AND s.day<$1::date AND s.score IS NOT NULL
      AND s.environment='mixed'
      AND jsonb_array_length(s.puzzle_ids)=8 AND jsonb_array_length(s.answers)=8
      AND s.measurement_qa=true
      AND p.display_name=$2
      AND p.public_identity_hidden_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM account_links a WHERE a.player_id=s.player_id)
      AND NOT EXISTS(SELECT 1 FROM creator_challenges c WHERE c.source_owner_player_id=s.player_id)
    ORDER BY s.day DESC,s.updated_at DESC LIMIT 1`,[gameDateKey(),dailyName])).rows[0];
  assert.ok(dailyRow,'No retained closed QA Daily from the corrected release is available; refusing customer fallback.');
  const daily=await borrowSource(dailyRow,'daily');
  report.checks.push('source selection uses only fresh owned QA Practice plus the corrected release QA Daily; customer rows excluded');
  return {practice:[practice],daily:[daily]};
}

async function resolveCandidate(type,candidates) {
  for(const candidate of candidates){
    const body=type==='practice'
      ?{source_type:'practice',share:candidate.share_id}
      :{source_type:'daily',creator_player_id:candidate.player_id,source_session_id:candidate.session_id};
    try{
      const {data}=await call('/growth/v1/admin/creator-challenges/resolve',{body,token:admin.token});
      if(data?.source?.source_session_id===candidate.session_id)return {...candidate,summary:data.source};
    }catch{}
  }
  throw Error('No '+type+' source passed the live Admin authority checks.');
}

async function createChallenge(type,candidate,tag) {
  const slug='canary-'+type+'-'+tag;
  const body={
    source_type:type,
    ...(type==='practice'?{share:candidate.share_id}:{creator_player_id:candidate.player_id,source_session_id:candidate.session_id}),
    creator_public_name:'Pack One Canary',
    headline:'Pack One release canary',
    slug,
    acquisition_source:'creator',
    acquisition_campaign:'release-canary',
    acquisition_medium:'creator',
  };
  const {data}=await call('/growth/v1/admin/creator-challenges',{body,token:admin.token});
  assert.equal(data.challenge.source_session_id,candidate.session_id);
  assert.equal(Number(data.challenge.source_score),Number(candidate.score));
  createdChallenges.push({id:data.challenge.id,slug,type,owner:candidate.player_id});
  report.challenges.push({id:data.challenge.id,slug,type,source_session_id:candidate.session_id});
  return data.challenge;
}

async function publication(challenge,action,{timeoutMs=45*60*1000}={}) {
  await call('/growth/v1/admin/creator-challenges/'+challenge.id+'/publication',{
    body:{action},token:admin.token,status:[200,202],
  });
  const deadline=Date.now()+timeoutMs;
  let latest=null;
  while(Date.now()<deadline){
    const {data}=await call('/growth/v1/admin/creator-challenges/'+challenge.id+'/publication',{method:'GET',token:admin.token});
    latest=data;
    const complete=action==='publish'
      ?data.state==='published'&&data.live_verified===true
      :data.state==='retired'&&data.live_verified===true;
    if(complete)return data;
    if(data?.challenge?.publication_error&&data?.workflow?.conclusion&&data.workflow.conclusion!=='success')
      throw Error(action+' workflow failed for '+challenge.slug+': '+data.challenge.publication_error);
    await sleep(10000);
  }
  throw Error(action+' timed out for '+challenge.slug+'; state '+String(latest?.state||'unknown'));
}

async function staticState(challenge,status) {
  const route='https://packone.pro/creator/'+challenge.slug+'/';
  const htmlResponse=await fetch(route,{headers:{'cache-control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(30000)});
  const html=await htmlResponse.text();
  assert.equal(htmlResponse.status,200);
  assert.ok(html.includes('data-creator-challenge-id="'+challenge.id+'"'));
  assert.ok(html.includes('data-creator-challenge-status="'+status+'"'));
  const card=await fetch(route+'creator-card.png',{headers:{'cache-control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(status==='published')assert.ok(card.ok&&String(card.headers.get('content-type')||'').includes('image/'));
  else assert.ok([404,410].includes(card.status),'retired personalized card must be unavailable');
  if(status==='retired')assert.equal(html.includes('Pack One Canary'),false,'retired HTML must scrub the canary identity');
  return {html,card_status:card.status};
}

async function publicMetadata(challenge,token) {
  const first=await call('/draft/v1/creator-challenges/'+challenge.slug,{method:'GET',player:token});
  const second=await call('/draft/v1/creator-challenges/'+challenge.slug,{method:'GET',player:token});
  assert.equal(first.data.id,challenge.id);assert.equal(second.data.id,challenge.id);
  assert.equal('answers' in first.data,false);
  return first.data;
}

async function playChallenge(challenge,candidate,guestToken,guestId) {
  const sourceAnswers=parseJson(candidate.answers)||[];
  assert.equal(sourceAnswers.length,8);
  const sourceBefore=(await query(`SELECT id::text id,day::text source_day,score::int score,answers,puzzle_ids,
      result_persisted_at,updated_at FROM draft_run_sessions WHERE id=$1::uuid`,[candidate.session_id])).rows[0];
  const dailyBefore=await count('SELECT count(*)::int n FROM draft_run_sessions WHERE player_id=$1::uuid AND day IS NOT NULL',[guestId]);

  const metadata=await publicMetadata(challenge,guestToken);
  assert.equal(Number(metadata.score),Number(candidate.score));
  assert.equal(metadata.source_type,challenge.type);

  const ownerToken=await playerToken(candidate.player_id);
  const self=(await call('/draft/v1/runs',{body:{creatorChallenge:challenge.id},player:ownerToken,status:[200,201]})).data;
  assert.equal(self.id,candidate.session_id,'creator self-open must return authoritative source session');
  assert.equal(self.creator_source_owner?.challenge_id,challenge.id);

  let run=(await call('/draft/v1/runs',{body:{creatorChallenge:challenge.id},player:guestToken,status:[200,201]})).data;
  const repeated=(await call('/draft/v1/runs',{body:{creatorChallenge:challenge.id},player:guestToken,status:[200,201]})).data;
  assert.equal(repeated.id,run.id,'creator start must be idempotent');
  assert.equal(run.answers.length,0);
  assert.equal(run.comparison?.kind,'creator');
  assert.equal(run.comparison?.creator_matches??null,null);

  const chosen=[];
  while(!run.complete){
    const round=run.answers.length;
    assert.ok(run.current?.puzzle_id);
    assert.ok(Array.isArray(run.current?.candidates)&&run.current.candidates.length>0);
    const selected=run.current.candidates[0].id;chosen.push(selected);
    run=(await call('/draft/v1/runs/'+run.id+'/pick',{body:{
      revision:run.revision,round,puzzleId:run.current.puzzle_id,cardId:selected,
    },player:guestToken})).data;
    assert.equal(run.answers.length,round+1);
    assert.ok(run.answers.every(answer=>answer.creatorId),'only submitted answers may expose creator selections');
    if(!run.complete)assert.equal(run.comparison?.creator_matches??null,null);
  }
  assert.equal(run.answers.length,8);
  const creatorMatches=chosen.filter((id,index)=>id===sourceAnswers[index]?.selectedId).length;
  const trophyMatches=run.answers.filter(answer=>answer.historicalMatch).length;
  const expectedOutcome=Number(run.score)>Number(candidate.score)?'win':Number(run.score)<Number(candidate.score)?'loss':'tie';
  assert.equal(run.comparison.creator_matches,creatorMatches);
  assert.equal(run.comparison.trophy_matches,trophyMatches);
  assert.equal(run.comparison.outcome,expectedOutcome);

  const stored=(await query(`SELECT day::text source_day,creator_challenge_id::text creator_challenge_id,measurement_qa
    FROM draft_run_sessions WHERE id=$1::uuid`,[run.id])).rows[0];
  assert.equal(stored.source_day,null,'creator replay must be unranked, not a Daily');
  assert.equal(stored.creator_challenge_id,challenge.id);
  const dailyAfter=await count('SELECT count(*)::int n FROM draft_run_sessions WHERE player_id=$1::uuid AND day IS NOT NULL',[guestId]);
  assert.equal(dailyAfter,dailyBefore,'creator replay must not consume or create a real Daily');

  const sourceAfter=(await query(`SELECT id::text id,day::text source_day,score::int score,answers,puzzle_ids,
      result_persisted_at,updated_at FROM draft_run_sessions WHERE id=$1::uuid`,[candidate.session_id])).rows[0];
  assert.deepEqual(sourceAfter,sourceBefore,'original creator source must remain immutable');

  const detail=(await call('/growth/v1/admin/creator-challenges/'+challenge.id,{method:'GET',token:admin.token})).data.challenge;
  assert.equal(Number(detail.attempts),1);
  assert.equal(Number(detail.wins)+Number(detail.ties)+Number(detail.losses),1);
  assert.equal(await count(`SELECT count(*)::int n FROM analytics_events
    WHERE player_id=$1::uuid AND event_name='creator_challenge_open'
      AND event_props->>'creator_challenge_id'=$2`,[guestId,challenge.id]),1);
  assert.equal(await count(`SELECT count(*)::int n FROM analytics_events
    WHERE player_id=$1::uuid AND event_name='creator_challenge_started'
      AND event_props->>'creator_challenge_id'=$2`,[guestId,challenge.id]),1);
  assert.equal(await count(`SELECT count(*)::int n FROM analytics_events
    WHERE player_id=$1::uuid AND event_name='acquisition_touch'
      AND event_props->>'creator_challenge_id'=$2`,[guestId,challenge.id]),1);
  return {run_id:run.id,score:Number(run.score),outcome:expectedOutcome,creator_matches:creatorMatches,trophy_matches:trophyMatches};
}

async function privacyRetire(challenge,owner) {
  const owned=(await query('SELECT id::text id,status,publication_detail FROM creator_challenges WHERE source_owner_player_id=$1::uuid ORDER BY created_at',[owner])).rows;
  const unsafe=owned.filter(row=>row.id!==challenge.id && !(row.status==='retired'&&parseJson(row.publication_detail)?.live_verified===true));
  assert.equal(unsafe.length,0,'Privacy canary owner acquired unrelated active creator work; refusing broad cleanup.');
  const deadline=Date.now()+45*60*1000;
  while(Date.now()<deadline){
    if(await requestCreatorPrivacyRetirement(query,owner,{
      reason:'release_canary',
      today:gameDateKey(),
      env:{PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:process.env.PACK1_LAUNCH_WATCHER_GITHUB_TOKEN},
      fetcher:fetch,
    }))return;
    await sleep(10000);
  }
  throw Error('Privacy retirement timed out for '+challenge.slug);
}

async function verifyRetiredApi(challenge,player) {
  await call('/draft/v1/creator-challenges/'+challenge.slug,{method:'GET',player,status:[410]});
}

async function cleanupGuest(guestId,challengeIds) {
  if(!guestId)return;
  for(const challengeId of challengeIds){
    await query(`UPDATE draft_run_sessions SET measurement_qa=true
      WHERE player_id=$1::uuid AND creator_challenge_id=$2::uuid`,[guestId,challengeId]);
    await query(`DELETE FROM analytics_events WHERE player_id=$1::uuid
      AND event_props->>'creator_challenge_id'=$2`,[guestId,challengeId]);
  }
  await query(`UPDATE players SET display_name='QA Creator Canary',profile_public=false,username_owned=false,updated_at=now()
    WHERE id=$1::uuid AND NOT EXISTS(SELECT 1 FROM account_links WHERE player_id=$1::uuid)`,[guestId]);
}

async function bestEffortRetire() {
  if(!admin)return;
  for(const challenge of createdChallenges){
    try{
      const row=(await call('/growth/v1/admin/creator-challenges/'+challenge.id,{method:'GET',token:admin.token,status:[200]})).data.challenge;
      if(row.status==='retired'&&parseJson(row.publication_detail)?.live_verified===true)continue;
      await publication(challenge,'retire',{timeoutMs:30*60*1000});
    }catch(error){console.error('Canary cleanup retirement failed for '+challenge.slug+': '+error.message);}
  }
}

try{
  await markerCheck();
  admin=await createAdminFixture();
  const pools=await candidatePools();
  const practice=await resolveCandidate('practice',pools.practice);
  const daily=await resolveCandidate('daily',pools.daily);
  report.checks.push('authentic non-QA Practice share and closed Daily resolved through live Admin authority');

  const tag=randomUUID().slice(0,8);
  const practiceChallenge=await createChallenge('practice',practice,tag);
  const dailyChallenge=await createChallenge('daily',daily,tag);

  const guestData=(await call('/growth/v1/player/session',{body:{displayName:'Creator Canary Challenger '+tag},status:[201]})).data;
  guest={id:guestData.playerId,token:await playerToken(guestData.playerId)};
  assert.match(guest.id,/^[a-f0-9-]{36}$/);

  for(const challenge of [practiceChallenge,dailyChallenge]){
    await publication(challenge,'publish');
    await staticState(challenge,'published');
  }
  report.checks.push('Practice and Daily creator routes published through protected publication workflow with live cards');

  const practiceRun=await playChallenge({...practiceChallenge,type:'practice'},practice,guest.token,guest.id);
  const dailyRun=await playChallenge({...dailyChallenge,type:'daily'},daily,guest.token,guest.id);
  report.challenges.find(row=>row.id===practiceChallenge.id).play=practiceRun;
  report.challenges.find(row=>row.id===dailyChallenge.id).play=dailyRun;
  report.checks.push('guest play, self-open, progressive reveal, final comparison, stats, dedupe and Daily isolation passed live');

  await publication(practiceChallenge,'retire');
  await staticState(practiceChallenge,'retired');
  await verifyRetiredApi(practiceChallenge,guest.token);
  report.checks.push('normal Admin retirement replaced Practice route and removed personalized PNG');

  await privacyRetire(dailyChallenge,daily.player_id);
  await staticState(dailyChallenge,'retired');
  await verifyRetiredApi(dailyChallenge,guest.token);
  const privacy=(await query(`SELECT status,creator_public_name,creator_handle,headline,
      source_owner_auth_user_id,privacy_removed_at,publication_detail
    FROM creator_challenges WHERE id=$1::uuid`,[dailyChallenge.id])).rows[0];
  assert.equal(privacy.status,'retired');
  assert.equal(privacy.creator_public_name,'A creator');
  assert.equal(privacy.creator_handle,null);
  assert.equal(privacy.headline,'Creator challenge unavailable');
  assert.equal(privacy.source_owner_auth_user_id,null);
  assert.ok(privacy.privacy_removed_at);
  assert.equal(parseJson(privacy.publication_detail)?.live_verified,true);
  report.checks.push('privacy retirement scrubbed dynamic identity and live static route/image before reporting complete');

  report.passed=true;
}catch(error){
  report.error=String(error?.message||error);
  console.error(report.error);
  await bestEffortRetire();
  process.exitCode=1;
}finally{
  try{if(guest)await cleanupGuest(guest.id,createdChallenges.map(row=>row.id));}catch(error){report.cleanup.guest_error=error.message;}
  try{await restoreBorrowedSources();report.cleanup.borrowed_sources=true;}catch(error){report.cleanup.borrowed_source_error=error.message;process.exitCode=1;}
  try{await cleanupFreshPracticeSource();report.cleanup.fresh_practice=true;}catch(error){report.cleanup.fresh_practice_error=error.message;process.exitCode=1;}
  try{await deleteAdminFixture(admin);report.cleanup.admin=true;}catch(error){report.cleanup.admin_error=error.message;}
  report.finished_at=new Date().toISOString();
  fs.writeFileSync(artifactDir+'/acceptance.json',JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({passed:report.passed,checks:report.checks,challenges:report.challenges.map(({id,slug,type,play})=>({id,slug,type,play}))}));
