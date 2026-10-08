import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryFixtures,validateRecoveryFixture,recoverKnownCanaryFixtures,practiceCanaryIdentity} from '../scripts/creator-canary-recovery.mjs';
import {normalizeDisplayName} from '../worker/username.mjs';

const rowFor=fixture=>({challenge_id:fixture.challengeId,session_id:fixture.sessionId,slug:fixture.slug,
  source_type:fixture.type,player_id:fixture.playerId||'daily-owned-fixture',source_owner_player_id:fixture.playerId||'daily-owned-fixture',
  source_share_id:fixture.shareId,source_day:fixture.type==='daily'?'2026-10-01':null,measurement_qa:fixture.type==='daily',profile_public:false,
  display_name:fixture.type==='daily'?'QA release abc1234':normalizeDisplayName(fixture.identityStyle==='short'?'Creator Source 42c12345':'Creator Canary Source 42c12345'),
  auth_id:fixture.type==='daily'?null:'owned-auth',auth_email:'qa-creator-source-42c12345@example.invalid',auth_name:fixture.identityStyle==='short'?'Creator Source 42c12345':'Creator Canary Source 42c12345'});

test('fresh fixture identity survives the production player-name normalizer without losing its tag',()=>{
  for(const tag of ['00000000','ffffffff','42c12345']){
    const identity=practiceCanaryIdentity(tag);
    assert.equal(normalizeDisplayName(identity.name),identity.name);
    assert.ok(identity.name.endsWith(tag));
    assert.equal(identity.email,'qa-creator-source-'+tag+'@example.invalid');
  }
  assert.throws(()=>practiceCanaryIdentity('invalid'));
});

test('recovery requires exact recorded source/challenge identities and owned fixture naming when a fixture remains',()=>{
  assert.equal(validateRecoveryFixture(null,recoveryFixtures[0]),false);
  for(const fixture of recoveryFixtures){
    const row=rowFor(fixture);validateRecoveryFixture(row,fixture);
    for(const replacement of [{session_id:'customer-source'},{challenge_id:'unknown-challenge'},
      {display_name:'Customer'}, {source_owner_player_id:'different-owner'}])
      assert.throws(()=>validateRecoveryFixture({...row,...replacement},fixture));
  }
  assert.throws(()=>validateRecoveryFixture({...rowFor(recoveryFixtures[0]),auth_email:'customer@example.com'},recoveryFixtures[0]));
  assert.throws(()=>validateRecoveryFixture({...rowFor(recoveryFixtures[0]),auth_name:'Creator Canary Source 99c12345'},recoveryFixtures[0]));
  assert.throws(()=>validateRecoveryFixture({...rowFor(recoveryFixtures[1]),auth_id:'customer-account'},recoveryFixtures[1]));
  validateRecoveryFixture({...rowFor(recoveryFixtures[0]),auth_id:null,source_share_id:null,measurement_qa:true,profile_public:false},recoveryFixtures[0]);
  const short=recoveryFixtures.find(fixture=>fixture.identityStyle==='short');
  assert.throws(()=>validateRecoveryFixture({...rowFor(short),auth_name:'Creator Source 99c12345'},short));
  assert.throws(()=>validateRecoveryFixture({...rowFor(short),display_name:'Creator Source 99c12345'},short));
  validateRecoveryFixture({...rowFor(short),auth_id:null,source_share_id:null,measurement_qa:true,profile_public:false},short);
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


test('recovery skips historical fixtures that are already fully absent',async()=>{
  const records=[];let mutations=0;
  const query=async()=>({rows:[]});
  await recoverKnownCanaryFixtures(query,{
    retire:async()=>{mutations++;},
    cleanPractice:async()=>{mutations++;},
    verifyRetired:async()=>{mutations++;},
    record:record=>records.push(record),
  });
  assert.equal(mutations,0);
  assert.equal(records.length,recoveryFixtures.length);
  assert.ok(records.every(record=>record.cleaned===true&&record.already_absent===true));
});

test('a partial historical fixture still fails closed instead of being treated as absent',async()=>{
  const fixture=recoveryFixtures[0];let mutations=0;
  const partial={...rowFor(fixture),session_id:null};
  let first=true;
  const query=async()=>first?(first=false,{rows:[partial]}):{rows:[]};
  await assert.rejects(recoverKnownCanaryFixtures(query,{
    retire:async()=>{mutations++;},
    cleanPractice:async()=>{mutations++;},
    verifyRetired:async()=>{mutations++;},
    record:()=>{},
  }));
  assert.equal(mutations,0);
});
