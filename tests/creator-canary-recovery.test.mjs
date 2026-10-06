import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryFixtures,validateRecoveryFixture,recoverKnownCanaryFixtures} from '../scripts/creator-canary-recovery.mjs';

const rowFor=fixture=>({challenge_id:fixture.challengeId,session_id:fixture.sessionId,slug:fixture.slug,
  source_type:fixture.type,player_id:fixture.playerId||'daily-owned-fixture',source_owner_player_id:fixture.playerId||'daily-owned-fixture',
  source_share_id:fixture.shareId,source_day:fixture.type==='daily'?'2026-10-01':null,measurement_qa:fixture.type==='daily',profile_public:false,
  display_name:fixture.type==='daily'?'QA release abc1234':'Creator Canary Source abc12345',
  auth_id:fixture.type==='daily'?null:'owned-auth',auth_email:'qa-creator-source-abc12345@example.invalid',auth_name:'Creator Canary Source abc12345'});

test('recovery requires exact recorded source/challenge identities and owned fixture naming',()=>{
  for(const fixture of recoveryFixtures){
    const row=rowFor(fixture);validateRecoveryFixture(row,fixture);
    for(const replacement of [{session_id:'customer-source'},{challenge_id:'unknown-challenge'},
      {display_name:'Customer'}, {source_owner_player_id:'different-owner'}])
      assert.throws(()=>validateRecoveryFixture({...row,...replacement},fixture));
  }
  assert.throws(()=>validateRecoveryFixture({...rowFor(recoveryFixtures[0]),auth_email:'customer@example.com'},recoveryFixtures[0]));
  assert.throws(()=>validateRecoveryFixture({...rowFor(recoveryFixtures[1]),auth_id:'customer-account'},recoveryFixtures[1]));
  validateRecoveryFixture({...rowFor(recoveryFixtures[0]),auth_id:null,source_share_id:null,measurement_qa:true,profile_public:false},recoveryFixtures[0]);
});

test('recovery stops before retirement if an owner has unrelated active work',async()=>{
  const fixture=recoveryFixtures[0];let mutation=false;
  const query=async(sql,params)=>sql.startsWith('SELECT c.id')?{rows:[rowFor(fixture)]}:{rows:[{id:'unrelated'}]};
  await assert.rejects(recoverKnownCanaryFixtures(query,{
    retire:async(owner,assertOwnerScope)=>{await assertOwnerScope();mutation=true;},
    cleanPractice:async()=>{},verifyRetired:async()=>{},record:()=>{},
  }),/unrelated active work/);
  assert.equal(mutation,false);
});
