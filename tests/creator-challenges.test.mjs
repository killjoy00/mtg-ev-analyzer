import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {buildCampaignTrackingUrl,validateCampaignEntries} from '../campaign-links.mjs';
import {
  creatorRevealState,
  parsePracticeShareReference,
  publicCreatorChallenge,
} from '../worker/creator-challenges.mjs';
import {
  creatorChallengeDescription,
  creatorChallengeTrackedUrl,
  renderCreatorChallengePage,
  validateCreatorPageEntries,
} from '../creator-challenge-pages.mjs';
import {prepareCreatorChallengePublish} from '../scripts/prepare-creator-challenge-publish.mjs';
import {requestCreatorPrivacyRetirement} from '../worker/creator-challenge-publish.mjs';

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
  assert.match(workflow,/gh workflow run test\.yml --ref "\$BRANCH"/);
  assert.match(workflow,/gh workflow run e2e\.yml --ref "\$BRANCH"/);
  assert.doesNotMatch(workflow,/HEAD:refs\/heads\/main/);
});


test('account deletion pauses after dispatching creator retirement until the static scrub is verified live',async()=>{
  let operation=null,dispatchBody=null;
  const row={
    id:CHALLENGE,
    slug:'lola-rft',
    status:'published',
    creator_public_name:'Lola',
    headline:'Can you beat Lola?',
    source_score:87,
    source_environment:'latest',
    source_type:'daily',
    source_day:'2026-10-08',
    publication_operation_ref:null,
    publication_detail:{},
  };
  const query=async(sql,params=[])=>{
    if(sql.includes('SELECT id FROM creator_challenges'))return {rows:[{id:CHALLENGE}]};
    if(sql.includes('SELECT c.*,s.score source_score')) {
      return {rows:[{
        ...row,
        status:operation?'retired':'published',
        publication_operation_ref:operation,
        publication_detail:operation?{action:'retire',reason:'account_deletion'}:{},
      }]};
    }
    if(sql.startsWith('UPDATE creator_challenges SET status=\'retired\'')) {
      operation=params[1];
      return {rows:[],rowCount:1};
    }
    if(sql.startsWith('INSERT INTO creator_challenge_audit'))return {rows:[],rowCount:1};
    throw new Error('Unexpected query: '+sql);
  };
  const ready=await requestCreatorPrivacyRetirement(query,'22222222-2222-4222-8222-222222222222',{
    env:{PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:'github_pat_fixture_abcdefghijklmnopqrstuvwxyz'},
    fetcher:async(_url,options)=>{
      dispatchBody=JSON.parse(options.body);
      return new Response(null,{status:204});
    },
  });
  assert.equal(ready,false,'deletion must pause after dispatch instead of deleting the account immediately');
  assert.match(operation,/^[a-f0-9-]{36}$/i);
  assert.equal(dispatchBody.ref,'main');
  assert.equal(dispatchBody.inputs.kind,'creator');
  assert.equal(dispatchBody.inputs.creator_action,'retire');
  assert.equal(dispatchBody.inputs.creator_challenge_id,CHALLENGE);
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
