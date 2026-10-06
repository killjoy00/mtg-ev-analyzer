import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';

import {buildCampaignTrackingUrl,validateCampaignEntries} from '../campaign-links.mjs';
import {DRAFT_RUN_SCORING_VERSION,gradeDraftRunPick} from '../draft-run.mjs';
import {gameDateKey} from '../game-date.mjs';
import {
  creatorRevealState,
  parsePracticeShareReference,
  publicCreatorChallenge,
  validateCreatorChallengeSource,
} from '../worker/creator-challenges.mjs';
import {
  creatorChallengeDescription,
  creatorChallengeTrackedUrl,
  renderCreatorChallengePage,
  validateCreatorPageEntries,
} from '../creator-challenge-pages.mjs';
import {prepareCreatorChallengePublish} from '../scripts/prepare-creator-challenge-publish.mjs';
import {checkCreatorChallenges} from '../scripts/check-creator-challenges.mjs';
import {
  beginCreatorPublicationOperation,
  creatorPublicationDispatchRetryDue,
  discoverCreatorPublicationWorkflowRun,
  dispatchCreatorPublicationAttempt,
  requestCreatorPrivacyRetirement,
  verifyCreatorPublicationLive,
} from '../worker/creator-challenge-publish.mjs';

const SHARE='0123456789abcdef01234567';
const CHALLENGE='11111111-1111-4111-8111-111111111111';

test('Practice creator source accepts only canonical Pack One shared-run references',()=>{
  assert.equal(parsePracticeShareReference(SHARE),SHARE);
  assert.equal(
    parsePracticeShareReference(`https://packone.pro/?game=draft-run&shared=${SHARE}`),
    SHARE,
  );
  assert.equal(
    parsePracticeShareReference(`https://www.packone.pro/open/shared?id=${SHARE}`),
    SHARE,
  );
  assert.throws(
    ()=>parsePracticeShareReference(`https://evil.example/?game=draft-run&shared=${SHARE}`),
    /approved Pack One origin/,
  );
  assert.throws(
    ()=>parsePracticeShareReference(`https://packone.pro/?game=draft-run&shared=${SHARE}&next=https%3A%2F%2Fevil.example`),
    /unsupported parameters/,
  );
  assert.throws(
    ()=>parsePracticeShareReference('https://packone.pro/?game=draft-run&shared=bad'),
    /valid share ID/,
  );
});

test('creator reveal exposes only already-submitted rounds and keeps future creator picks server-only',()=>{
  const challenge={
    id:CHALLENGE,
    slug:'lola-rft',
    creator_public_name:'Lola',
    creator_handle:'@lola',
    headline:'Can you beat Lola?',
    source_type:'practice',
    source_day:null,
    creator_post_run_note:'P3 was the one I was unsure about.',
  };
  const source={
    score:84,
    answers:Array.from({length:8},(_,index)=>({
      selectedId:`creator-${index}`,
      selectedName:`Creator ${index}`,
    })),
  };
  const submitted=[
    {selectedId:'creator-0',selectedName:'Creator 0',historicalMatch:true},
    {selectedId:'mine-1',selectedName:'Mine 1',historicalMatch:false},
  ];
  const partial=creatorRevealState(challenge,source,submitted,{complete:false});
  assert.equal(partial.answers.length,2);
  assert.deepEqual(partial.answers.map(answer=>answer.creatorId),['creator-0','creator-1']);
  assert.equal(partial.answers[0].creatorMatch,true);
  assert.equal(partial.answers[1].creatorMatch,false);
  assert.equal(partial.comparison.creator_matches,null);
  assert.equal(partial.comparison.trophy_matches,null);
  assert.equal(partial.comparison.outcome,null);
  assert.equal(Object.hasOwn(partial.comparison,'creator_post_run_note'),false,'post-run note is not an in-run spoiler surface');
  assert.equal(JSON.stringify(partial).includes('creator-7'),false,'future creator answers must not leak into the response');

  const completeAnswers=Array.from({length:8},(_,index)=>({
    selectedId:index<5?`creator-${index}`:`mine-${index}`,
    selectedName:`Mine ${index}`,
    historicalMatch:index<6,
    score:index===0?100:86,
  }));
  const complete=creatorRevealState(challenge,source,completeAnswers,{complete:true});
  assert.equal(complete.creatorMatches,5);
  assert.equal(complete.trophyMatches,6);
  assert.equal(complete.outcome,'win');
  assert.equal(complete.comparison.creator_post_run_note,'P3 was the one I was unsure about.');
});

test('completed Daily remains previewable but cannot publish/start until the Pacific game date rolls over',async()=>{
  const corpus=JSON.parse(gunzipSync(await readFile('corpus/draft-run/blb.json.gz')));
  const puzzles=corpus.slice(0,8);
  assert.equal(puzzles.length,8);
  const sessionId='22222222-2222-4222-8222-222222222222';
  const playerId='33333333-3333-4333-8333-333333333333';
  const day='2026-10-05';
  const answers=puzzles.map(p=>{
    const selectedId=p.historical_pick_id;
    const graded=gradeDraftRunPick(p,selectedId);
    return {
      puzzle:{puzzle_id:p.puzzle_id},
      selectedId,
      selectedName:p.candidates.find(card=>card.id===selectedId)?.name||'Trophy pick',
      score:graded.score,
    };
  });
  const score=Math.round(answers.reduce((sum,answer)=>sum+answer.score,0)/answers.length);
  const source={
    id:sessionId,player_id:playerId,day,environment:'mixed',score,
    puzzle_ids:puzzles.map(p=>p.puzzle_id),answers,
    source_components:[],custom_set_ids:[],measurement_qa:false,
    profile_public:true,username_owned:true,public_identity_hidden_at:null,
    challenge_id:null,creator_challenge_id:null,display_name:'Daily Creator',
    source_owner_auth_user_id:null,corpus_version:puzzles[0].corpus_version,
    scoring_version:DRAFT_RUN_SCORING_VERSION,
  };
  const byId=new Map(puzzles.map(p=>[p.puzzle_id,p]));
  const query=async(sql,params=[])=>{
    if(sql.includes('FROM draft_run_sessions s'))return {rows:[source]};
    if(sql.includes('FROM draft_run_verified_puzzles'))return {rows:[{payload:byId.get(params[0])}]};
    if(sql.includes('FROM corpus_components'))return {rows:[{ok:true}]};
    throw new Error('Unexpected query: '+sql);
  };
  const challenge={
    source_session_id:sessionId,authoritative_owner_player_id:playerId,source_owner_player_id:playerId,
    source_score:score,source_type:'daily',source_day:day,authoritative_source_day:day,
    source_environment:'mixed',authoritative_environment:'mixed',
    profile_public:true,public_identity_hidden_at:null,measurement_qa:false,
  };

  assert.equal(gameDateKey('2026-10-06T06:59:59.999Z'),'2026-10-05');
  assert.equal(gameDateKey('2026-10-06T07:00:00.000Z'),'2026-10-06');
  await assert.rejects(
    validateCreatorChallengeSource(query,challenge,{today:day,requireClosed:true}),
    error=>error?.code==='CREATOR_DAILY_STILL_OPEN',
  );
  const resolved=await validateCreatorChallengeSource(query,challenge,{today:'2026-10-06',requireClosed:true});
  assert.equal(resolved.id,sessionId);
  assert.equal(resolved.answers.length,8);

  source.scoring_version='historical-unsupported';
  await assert.rejects(
    validateCreatorChallengeSource(query,challenge,{today:'2026-10-06',requireClosed:true}),
    error=>error?.code==='CREATOR_SOURCE_SCORING_VERSION',
  );
});

test('creator public payload uses existing acquisition tracking without weakening normal campaign destinations',()=>{
  const row={
    id:CHALLENGE,
    slug:'lola-rft',
    creator_public_name:'Lola',
    creator_handle:'@lola',
    headline:'Can you beat Lola?',
    source_score:87,
    source_environment:'latest',
    source_type:'daily',
    source_day:'2026-10-08',
    acquisition_source:'creator',
    acquisition_campaign:'beat-the-creator',
    acquisition_medium:'creator',
    attempts:10,wins:4,ties:1,losses:5,beat_percentage:40,average_score:82.4,
  };
  const info=publicCreatorChallenge(row);
  assert.equal(info.public_url,'https://packone.pro/creator/lola-rft/');
  assert.equal(
    info.tracked_url,
    `https://packone.pro/?game=draft-run&creator=${CHALLENGE}&utm_source=creator&utm_campaign=beat-the-creator&utm_medium=creator`,
  );
  assert.throws(
    ()=>validateCampaignEntries([{slug:'not-ordinary',destination:`/?game=draft-run&creator=${CHALLENGE}`,source:'creator',campaign:'beat-the-creator'}]),
    /destination .* is not supported/,
  );
  assert.equal(
    buildCampaignTrackingUrl({destination:`/?game=draft-run&creator=${CHALLENGE}`,source:'creator',campaign:'beat-the-creator'},{allowCreator:true}),
    `https://packone.pro/?game=draft-run&creator=${CHALLENGE}&utm_source=creator&utm_campaign=beat-the-creator`,
  );
});

test('published creator page has creator social metadata but no gameplay answers; retired page scrubs identity',()=>{
  const entry={
    id:CHALLENGE,
    slug:'lola-rft',
    status:'published',
    creator_name:'Lola',
    headline:'Can you beat Lola?',
    score:87,
    environment:'latest',
    source_type:'daily',
    source_day:'2026-10-08',
    source:'creator',
    campaign:'beat-the-creator',
    medium:'creator',
  };
  assert.deepEqual(validateCreatorPageEntries([entry]),[entry]);
  assert.match(creatorChallengeDescription(entry),/Lola scored 87\/100/);
  assert.equal(
    creatorChallengeTrackedUrl(entry),
    `https://packone.pro/?game=draft-run&creator=${CHALLENGE}&utm_source=creator&utm_campaign=beat-the-creator&utm_medium=creator`,
  );
  const html=renderCreatorChallengePage(entry);
  assert.match(html,/property="og:title" content="Can you beat Lola\?"/);
  assert.match(html,/creator-card\.png/);
  assert.match(html,new RegExp(`game=draft-run&creator=${CHALLENGE}`));
  for(const forbidden of ['selectedId','creatorId','puzzle_ids','answers'])assert.doesNotMatch(html,new RegExp(forbidden));

  const retired=renderCreatorChallengePage({id:CHALLENGE,slug:'lola-rft',status:'retired'});
  assert.match(retired,/creator challenge is no longer available/i);
  assert.doesNotMatch(retired,/Lola|87\/100|location\.replace/);
});

test('creator publication registry is immutable, collision-safe, and retirement scrubs metadata',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'packone-creator-publish-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,'campaign-links.json'),JSON.stringify([
    {slug:'reddit-launch',destination:'/',source:'reddit',campaign:'launch-week'},
  ],null,2)+'\n');
  await writeFile(path.join(root,'creator-challenges.json'),'[]\n');
  const entry={
    id:CHALLENGE,
    slug:'lola-rft',
    creator_name:'Lola',
    headline:'Can you beat Lola?',
    score:87,
    environment:'latest',
    source_type:'daily',
    source_day:'2026-10-08',
    source:'creator',
    campaign:'beat-the-creator',
    medium:'creator',
  };
  const first=await prepareCreatorChallengePublish({root,action:'publish',entry});
  assert.equal(first.created,true);
  const page=await readFile(path.join(root,'creator','lola-rft','index.html'),'utf8');
  assert.match(page,/Can you beat Lola/);
  await assert.rejects(
    prepareCreatorChallengePublish({root,action:'publish',entry:{...entry,slug:'reddit-launch'}}),
    /collides with an ordinary campaign link/,
  );
  await assert.rejects(
    prepareCreatorChallengePublish({root,action:'publish',entry:{...entry,id:'22222222-2222-4222-8222-222222222222'}}),
    /reserved by a different challenge/,
  );
  const retired=await prepareCreatorChallengePublish({root,action:'retire',entry});
  assert.equal(retired.retired,true);
  const registry=JSON.parse(await readFile(path.join(root,'creator-challenges.json'),'utf8'));
  assert.deepEqual(registry,[{id:CHALLENGE,slug:'lola-rft',status:'retired'}]);
  const retiredPage=await readFile(path.join(root,'creator','lola-rft','index.html'),'utf8');
  assert.doesNotMatch(retiredPage,/Lola|87\/100/);
  await checkCreatorChallenges({root});
  const orphan=path.join(root,'creator','orphan');
  await mkdir(orphan,{recursive:true});
  await writeFile(path.join(orphan,'index.html'),'<!-- Generated by scripts/prepare-creator-challenge-publish.mjs. Do not edit by hand. -->\n');
  await assert.rejects(checkCreatorChallenges({root}),/orphan generated creator page/);
  await rm(orphan,{recursive:true,force:true});
  await assert.rejects(
    prepareCreatorChallengePublish({root,action:'publish',entry}),
    /cannot be recycled/,
  );
});

test('protected campaign publication workflow has a creator path without direct main pushes',async()=>{
  const workflow=await readFile('.github/workflows/campaign-link-publish.yml','utf8');
  assert.match(workflow,/inputs\.kind == 'creator'/);
  assert.match(workflow,/prepare-creator-challenge-publish\.mjs/);
  assert.match(workflow,/generate-creator-social-card\.py/);
  assert.match(workflow,/check-creator-challenges\.mjs/);
  assert.match(workflow,/node scripts\/ci-publication-validate\.mjs/);
  assert.match(workflow,/python3 scripts\/check-creator-social-card\.py/);
  assert.match(workflow,/node \.github\/scripts\/publication-pr-checks\.mjs/);
  assert.match(workflow,/environment: pack-one-mobile-release/);
  assert.match(workflow,/--match-head-commit "\$HEAD_SHA"/);
  assert.doesNotMatch(workflow,/HEAD:refs\/heads\/main/);
});


test('account deletion pauses after dispatching creator retirement until the static scrub is verified live',async()=>{
  let dispatchBody=null;
  const state={
    id:CHALLENGE,
    slug:'lola-rft',
    status:'published',
    creator_public_name:'Lola',
    creator_handle:'@lola',
    headline:'Can you beat Lola?',
    source_score:87,
    source_environment:'latest',
    source_type:'daily',
    source_day:'2026-10-08',
    acquisition_source:'creator',
    acquisition_campaign:'lola-rft',
    acquisition_medium:'creator',
    published_at:'2026-10-08T18:00:00Z',
    publication_operation_ref:null,
    publication_detail:{},
    publication_error:null,
  };
  const row=()=>({...state,publication_detail:{...state.publication_detail}});
  const query=async(sql,params=[])=>{
    if(sql.includes('SELECT id FROM creator_challenges'))return {rows:[{id:CHALLENGE}]};
    if(sql.includes('SELECT c.*,s.score source_score'))return {rows:[row()]};
    if(sql.startsWith("UPDATE game_results SET opponent_name='A creator'"))return {rows:[],rowCount:1};
    if(sql.startsWith("UPDATE creator_challenges SET status='retired',\n        creator_public_name='A creator'")) {
      Object.assign(state,{
        status:'retired',creator_public_name:'A creator',creator_handle:null,
        headline:'Creator challenge unavailable',publication_error:null,
      });
      return {rows:[],rowCount:1};
    }
    if(sql.startsWith("UPDATE creator_challenges SET status='retired',\n          retired_at=")) {
      state.status='retired';
      state.publication_operation_ref=params[3];
      state.publication_detail=JSON.parse(params[4]);
      state.publication_error=null;
      return {rows:[{id:CHALLENGE}],rowCount:1};
    }
    if(sql.startsWith('UPDATE creator_challenges\n    SET publication_detail=publication_detail||')) {
      state.publication_detail={...state.publication_detail,...JSON.parse(params[3])};
      return {rows:[{id:CHALLENGE}],rowCount:1};
    }
    if(sql.startsWith('UPDATE creator_challenges SET publication_error=')) {
      state.publication_error=params[3];
      return {rows:[{id:CHALLENGE}],rowCount:1};
    }
    if(sql.startsWith('INSERT INTO creator_challenge_audit'))return {rows:[],rowCount:1};
    throw new Error('Unexpected query: '+sql);
  };
  const ready=await requestCreatorPrivacyRetirement(query,'22222222-2222-4222-8222-222222222222',{
    env:{PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:'github_pat_fixture_abcdefghijklmnopqrstuvwxyz'},
    fetcher:async(url,options={})=>{
      if(String(url).includes('/actions/workflows/campaign-link-publish.yml/runs'))
        return Response.json({workflow_runs:[]});
      if(String(url).endsWith('/dispatches')) {
        dispatchBody=JSON.parse(options.body);
        return new Response(null,{status:204});
      }
      throw new Error('Unexpected fetch: '+url);
    },
  });
  assert.equal(ready,false,'deletion must pause after dispatch instead of deleting the account immediately');
  assert.match(state.publication_operation_ref,/^[a-f0-9-]{36}$/i);
  assert.equal(state.publication_detail.dispatch.state,'accepted');
  assert.equal(dispatchBody.ref,'main');
  assert.equal(dispatchBody.inputs.kind,'creator');
  assert.equal(dispatchBody.inputs.creator_action,'retire');
  assert.equal(dispatchBody.inputs.creator_challenge_id,CHALLENGE);
  assert.equal(dispatchBody.inputs.creator_name,'A creator');
  assert.equal(dispatchBody.inputs.creator_headline,'Creator challenge unavailable');
  assert.equal(dispatchBody.inputs.creator_score,'0');
  assert.equal(dispatchBody.inputs.campaign,'retired');
  assert.equal(JSON.stringify(dispatchBody).includes('Lola'),false);
  const workflow=await readFile('.github/workflows/campaign-link-publish.yml','utf8');
  const declaredInputs=new Set([...workflow.matchAll(/^      ([a-z_]+):\s*$/gm)].map(match=>match[1]));
  assert.deepEqual(
    Object.keys(dispatchBody.inputs).filter(key=>!declaredInputs.has(key)),
    [],
    'creator dispatch may only send declared workflow_dispatch inputs',
  );
});

test('repeated publish reuses one operation and a competing retire supersedes it safely',async()=>{
  const admin='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const state={
    id:CHALLENGE,slug:'lola-rft',status:'draft',
    publication_operation_ref:null,publication_detail:{},publication_error:null,
    creator_public_name:'Lola',headline:'Can you beat Lola?',source_score:87,
    source_environment:'mixed',source_type:'practice',source_day:null,
    acquisition_source:'creator',acquisition_campaign:'lola-rft',acquisition_medium:'creator',
    authoritative_owner_player_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    source_owner_player_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    profile_public:true,public_identity_hidden_at:null,measurement_qa:false,
  };
  const row=()=>({...state,publication_detail:{...state.publication_detail}});
  const query=async(sql,params=[])=>{
    if(sql.startsWith("UPDATE creator_challenges SET status='publishing'")) {
      const expectedStatus=params[3],expectedOperation=params[4]||null;
      const currentOperation=state.publication_operation_ref||null;
      const matches=state.status===expectedStatus&&currentOperation===expectedOperation;
      if(matches){
        state.status='publishing';state.publication_operation_ref=params[1];
        state.publication_detail=JSON.parse(params[2]);state.publication_error=null;
      }
      return {rows:matches?[{id:CHALLENGE}]:[]};
    }
    if(sql.startsWith("UPDATE creator_challenges SET status='retired'")) {
      const expectedStatus=params[5],expectedOperation=params[6]||null;
      const currentOperation=state.publication_operation_ref||null;
      const matches=state.status===expectedStatus&&currentOperation===expectedOperation;
      if(matches){
        state.status='retired';state.publication_operation_ref=params[3];
        state.publication_detail=JSON.parse(params[4]);state.publication_error=null;
      }
      return {rows:matches?[{id:CHALLENGE}]:[]};
    }
    if(sql.startsWith('INSERT INTO creator_challenge_audit'))return {rows:[],rowCount:1};
    if(sql.includes('SELECT c.*,s.score source_score'))return {rows:[row()]};
    throw new Error('Unexpected query: '+sql);
  };

  const first=await beginCreatorPublicationOperation(query,row(),'publish',{adminAuthUserId:admin,reason:'test_publish'});
  assert.equal(first.reused,false);assert.match(first.operation,/^[a-f0-9-]{36}$/i);
  const second=await beginCreatorPublicationOperation(query,{...row(),status:'draft',publication_operation_ref:null,publication_detail:{}},'publish',{adminAuthUserId:admin,reason:'test_publish'});
  assert.equal(second.reused,true);
  assert.equal(second.operation,first.operation,'concurrent/repeated publish must converge on the in-flight operation');

  const retired=await beginCreatorPublicationOperation(query,row(),'retire',{adminAuthUserId:admin,reason:'test_retire'});
  assert.equal(retired.reused,false);
  assert.notEqual(retired.operation,first.operation);
  assert.equal(state.status,'retired');
  assert.equal(state.publication_detail.action,'retire');
  assert.equal(state.publication_operation_ref,retired.operation);
});

test('creator publication dispatch distinguishes rejection from ambiguous delivery and retries only after the ambiguity window',async()=>{
  const operation='22222222-2222-4222-8222-222222222222';
  const env={PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:'github_pat_fixture_abcdefghijklmnopqrstuvwxyz'};
  const baseRow={
    id:CHALLENGE,slug:'lola-rft',status:'publishing',
    creator_public_name:'Lola',headline:'Can you beat Lola?',source_score:87,
    source_environment:'mixed',source_type:'practice',source_day:null,
    acquisition_source:'creator',acquisition_campaign:'lola-rft',acquisition_medium:'creator',
    publication_operation_ref:operation,
    publication_detail:{action:'publish',dispatch:{state:'pending',attempts:0}},
  };

  const rejectedPatches=[],rejectedErrors=[];
  const rejectedQuery=async(sql,params)=>{
    if(sql.startsWith('UPDATE creator_challenges\n    SET publication_detail=')){
      rejectedPatches.push(JSON.parse(params[3]));return {rows:[{id:CHALLENGE}]};
    }
    if(sql.startsWith('UPDATE creator_challenges SET publication_error=')){
      rejectedErrors.push(params[3]);return {rows:[{id:CHALLENGE}]};
    }
    throw new Error('Unexpected query: '+sql);
  };
  const rejected=await dispatchCreatorPublicationAttempt(
    rejectedQuery,baseRow,operation,'publish',
    {env,fetcher:async()=>new Response(null,{status:422})},
  );
  assert.equal(rejected.state,'rejected');
  assert.equal(rejected.status,422);
  assert.equal(rejectedPatches.at(-1).dispatch.state,'rejected');
  assert.match(rejectedErrors.at(-1),/HTTP 422/);

  const ambiguousPatches=[],ambiguousErrors=[];
  const ambiguousQuery=async(sql,params)=>{
    if(sql.startsWith('UPDATE creator_challenges\n    SET publication_detail=')){
      ambiguousPatches.push(JSON.parse(params[3]));return {rows:[{id:CHALLENGE}]};
    }
    if(sql.startsWith('UPDATE creator_challenges SET publication_error=')){
      ambiguousErrors.push(params[3]);return {rows:[{id:CHALLENGE}]};
    }
    throw new Error('Unexpected query: '+sql);
  };
  const ambiguous=await dispatchCreatorPublicationAttempt(
    ambiguousQuery,baseRow,operation,'publish',
    {env,fetcher:async()=>{throw new Error('socket closed after request write');}},
  );
  assert.equal(ambiguous.state,'ambiguous');
  const detail={action:'publish',dispatch:ambiguousPatches.at(-1).dispatch};
  const attempted=Date.parse(detail.dispatch.last_attempt_at);
  assert.equal(creatorPublicationDispatchRetryDue(detail,{now:attempted+59_999}),false);
  assert.equal(creatorPublicationDispatchRetryDue(detail,{now:attempted+60_001}),true);
  assert.match(ambiguousErrors.at(-1),/socket closed/);
});

test('creator workflow discovery paginates beyond the newest 100 dispatch runs',async()=>{
  const operation='33333333-3333-4333-8333-333333333333';
  const env={PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:'github_pat_fixture_abcdefghijklmnopqrstuvwxyz'};
  const pages=[];
  const run=await discoverCreatorPublicationWorkflowRun(operation,{
    env,
    fetcher:async url=>{
      const page=Number(new URL(url).searchParams.get('page')||1);pages.push(page);
      if(page===1)return Response.json({workflow_runs:Array.from({length:100},(_,i)=>({id:i+1,display_title:'other / '+i}))});
      return Response.json({workflow_runs:[{id:987654,display_title:'Publish creator / '+operation,status:'queued'}]});
    },
  });
  assert.deepEqual(pages,[1,2]);
  assert.equal(run.id,987654);
});

test('stale publication operations cannot overwrite a newer retirement operation',async()=>{
  const oldOperation='44444444-4444-4444-8444-444444444444';
  const newOperation='55555555-5555-4555-8555-555555555555';
  const env={PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:'github_pat_fixture_abcdefghijklmnopqrstuvwxyz'};
  const current={
    operation:newOperation,
    action:'retire',
    detail:{action:'retire',dispatch:{state:'accepted',attempts:1}},
    error:null,
  };
  const staleRow={
    id:CHALLENGE,slug:'lola-rft',status:'publishing',
    creator_public_name:'Lola',headline:'Can you beat Lola?',source_score:87,
    source_environment:'mixed',source_type:'practice',source_day:null,
    acquisition_source:'creator',acquisition_campaign:'lola-rft',acquisition_medium:'creator',
    publication_operation_ref:oldOperation,
    publication_detail:{action:'publish',dispatch:{state:'pending',attempts:0}},
  };
  const query=async(sql,params)=>{
    const matches=params[1]===current.operation&&params[2]===current.action;
    if(sql.startsWith('UPDATE creator_challenges\n    SET publication_detail=')){
      if(matches)current.detail={...current.detail,...JSON.parse(params[3])};
      return {rows:matches?[{id:CHALLENGE}]:[]};
    }
    if(sql.startsWith('UPDATE creator_challenges SET publication_error=')){
      if(matches)current.error=params[3];
      return {rows:matches?[{id:CHALLENGE}]:[]};
    }
    throw new Error('Unexpected query: '+sql);
  };
  const result=await dispatchCreatorPublicationAttempt(
    query,staleRow,oldOperation,'publish',
    {env,fetcher:async()=>new Response(null,{status:204})},
  );
  assert.equal(result.state,'accepted','the network response may be accepted even after a competing state change');
  assert.equal(current.operation,newOperation);
  assert.equal(current.action,'retire');
  assert.deepEqual(current.detail,{action:'retire',dispatch:{state:'accepted',attempts:1}});
  assert.equal(current.error,null);
});

test('retirement never reuses a verified publish as verified static cleanup',async()=>{
  const publishOperation='44444444-4444-4444-8444-444444444444';
  const state={
    id:CHALLENGE,slug:'lola-rft',status:'retired',published_at:'2026-10-06T12:00:00Z',
    publication_operation_ref:publishOperation,
    publication_detail:{
      action:'publish',reason:'admin_publish',live_verified:true,
      dispatch:{state:'accepted',attempts:1},
      workflow:{id:123,status:'completed',conclusion:'success'},
    },
    publication_error:null,creator_public_name:'A creator',headline:'Creator challenge unavailable',
    source_score:87,source_environment:'mixed',source_type:'practice',source_day:null,
    acquisition_source:'creator',acquisition_campaign:'lola-rft',acquisition_medium:'creator',
  };
  const row=()=>({...state,publication_detail:structuredClone(state.publication_detail)});
  const query=async(sql,params=[])=>{
    if(sql.startsWith("UPDATE creator_challenges SET status='retired'")) {
      state.status='retired';
      state.publication_operation_ref=params[3];
      state.publication_detail=JSON.parse(params[4]);
      state.publication_error=null;
      return {rows:[{id:CHALLENGE}],rowCount:1};
    }
    if(sql.startsWith('INSERT INTO creator_challenge_audit'))return {rows:[],rowCount:1};
    if(sql.includes('SELECT c.*,s.score source_score'))return {rows:[row()]};
    throw new Error('Unexpected query: '+sql);
  };

  const begun=await beginCreatorPublicationOperation(query,row(),'retire',{reason:'privacy_cleanup'});
  assert.equal(begun.complete,undefined,'a verified publish is not a completed retirement');
  assert.equal(begun.reused,false);
  assert.notEqual(begun.operation,publishOperation);
  assert.equal(state.publication_detail.action,'retire');
  assert.equal(state.publication_detail.live_verified,false);
  assert.equal(state.publication_detail.static_cleanup,'required');
  assert.equal(state.publication_detail.superseded_publish.operation,publishOperation);
});

test('privacy retirement is not live-verified while the old personalized social image still resolves',async()=>{
  const row={id:CHALLENGE,slug:'lola-rft'};
  const retiredHtml=`<!doctype html><body data-creator-challenge-id="${CHALLENGE}" data-creator-challenge-status="retired"></body>`;
  const stale=await verifyCreatorPublicationLive(row,'retire',{
    fetcher:async url=>String(url).endsWith('creator-card.png')
      ? new Response('old personalized card',{status:200,headers:{'content-type':'image/png'}})
      : new Response(retiredHtml,{status:200,headers:{'content-type':'text/html'}}),
  });
  assert.equal(stale.html_verified,true);
  assert.equal(stale.image_verified,false);
  assert.equal(stale.image_status,200);
  assert.equal(stale.ok,false);

  const scrubbed=await verifyCreatorPublicationLive(row,'retire',{
    fetcher:async url=>String(url).endsWith('creator-card.png')
      ? new Response(null,{status:404})
      : new Response(retiredHtml,{status:200,headers:{'content-type':'text/html'}}),
  });
  assert.equal(scrubbed.ok,true);
  assert.equal(scrubbed.image_verified,true);
});


test('creator migration preserves attribution across account merge and demotes duplicate attempts',async()=>{
  const migration=await readFile('migrations/0053_creator_challenges.sql','utf8');
  assert.match(migration,/pack1_fill_creator_challenge_result/);
  assert.match(migration,/creator_challenge_result_fill/);
  assert.match(migration,/pack1_prepare_creator_challenge_player_merge/);
  assert.match(migration,/creator_challenge_player_merge_guard/);
  assert.match(migration,/NEW\.creator_challenge_id=NULL/);
  assert.match(migration,/NEW\.start_idempotency_hash=NULL/);
  assert.match(migration,/creator_participant_auth_user_id=COALESCE/);
});

test('creator privacy cleanup scrubs retained challenger labels and creator auth identity',async()=>{
  const deletion=await readFile('worker/account-deletion.mjs','utf8');
  const moderation=await readFile('worker/user-admin.mjs','utf8');
  assert.match(deletion,/UPDATE game_results SET opponent_name='A creator'/);
  assert.match(deletion,/source_owner_auth_user_id=NULL/);
  assert.match(moderation,/creator_result_scrub/);
  assert.match(moderation,/UPDATE game_results SET opponent_name='A creator'/);
});


test('creator funnel events have database-backed concurrency idempotency',async()=>{
  const migration=await readFile('migrations/0054_creator_event_idempotency.sql','utf8');
  assert.match(migration,/row_number\(\) OVER/);
  assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS analytics_creator_challenge_event_uq/);
  assert.match(migration,/event_name IN \('creator_challenge_open','acquisition_touch'\)/);
  assert.match(migration,/event_props \? 'creator_challenge_id'/);
  const runtime=await readFile('worker/draft-run-function.mjs','utf8');
  const start=runtime.indexOf("('creator_challenge_open',$2::jsonb)");
  const end=runtime.indexOf('return json(publicCreatorChallenge(challenge));',start);
  assert.ok(start>0&&end>start);
  assert.match(runtime.slice(start,end),/ON CONFLICT DO NOTHING/);
});


test('creator admin list batches stats instead of issuing one detail query per challenge',async()=>{
  const source=await readFile('worker/creator-challenges.mjs','utf8');
  const start=source.indexOf('export async function listCreatorChallenges');
  const end=source.indexOf('export async function handleCreatorChallengeAdmin',start);
  assert.ok(start>0&&end>start);
  const list=source.slice(start,end);
  assert.match(list,/creatorChallengeSelect\(\{includeStats:true\}\)/);
  assert.match(list,/return result\.rows\.map\(challengeRow\)/);
  assert.doesNotMatch(list,/creatorChallengeById/);
});
