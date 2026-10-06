import assert from 'node:assert/strict';
import {normalizeDisplayName} from '../worker/username.mjs';

export function practiceCanaryIdentity(tag) {
  assert.match(tag,/^[0-9a-f]{8}$/);
  const name='Creator Source '+tag;
  assert.equal(normalizeDisplayName(name),name,'owned fixture name must survive product normalization');
  return {name,email:'qa-creator-source-'+tag+'@example.invalid'};
}

// Exact owned fixtures from acceptance artifacts 11383024951 / 11385218108 / 11387058492,
// runs 37395491593 / 37399314701 / 37404898908.
// Recovery never discovers candidates or falls back to customer identities.
export const recoveryFixtures=[
  {type:'practice',challengeId:'e10286c0-580f-4e08-926c-df444916b65e',
    sessionId:'3615c3db-4000-489c-a897-e9b35960e321',playerId:'6f736b49-c8f6-4986-a15f-1bd8ff84a141',
    shareId:'159018d878c84de48af28076',slug:'canary-practice-1a144cc5',displayName:'Creator Canary Source 42'},
  {type:'daily',challengeId:'4367a0f4-e706-4037-b436-c8da2cd012ba',
    sessionId:'0d096acd-7f45-47dd-9a4c-c8ec2ff959db',slug:'canary-daily-1a144cc5'},
  {type:'practice',challengeId:'ffc7091d-3f08-4376-8d05-c1e29f678a50',
    sessionId:'aee5f67c-d756-43b9-b7b1-ac9a2cbc9687',playerId:'54998c25-d187-43c2-b1d3-9ac9da4d9520',
    shareId:'c934430b73c44511ae340764',slug:'canary-practice-269df3bf',identityStyle:'short'},
  {type:'daily',challengeId:'f295e269-6f34-4fb1-830b-362b29a9f770',
    sessionId:'70c80d01-ed10-4692-a718-c4ab8e44cba1',slug:'canary-daily-269df3bf'},
  {type:'practice',challengeId:'a1d8a04f-c4d5-4761-9191-a847fc89adb6',
    sessionId:'3b086aed-5035-4896-bdbf-ab531f9e86b8',playerId:'4c052e53-e9a8-4193-945c-ed4fe35eb255',
    shareId:'a6dff30401e64f2d87e5b97f',slug:'canary-practice-47a17637',identityStyle:'short'},
  {type:'daily',challengeId:'536e6084-b07d-4d64-a999-ae5c58113069',
    sessionId:'092dde8d-7b77-41a7-9608-39f621326351',slug:'canary-daily-47a17637'},
];

export function validateRecoveryFixture(row,fixture) {
  assert.ok(row,'known canary fixture must still exist');
  assert.equal(row.challenge_id,fixture.challengeId);
  assert.equal(row.session_id,fixture.sessionId);
  assert.equal(row.slug,fixture.slug);
  assert.equal(row.source_owner_player_id,row.player_id);
  assert.equal(row.source_type,fixture.type);
  if(fixture.type==='daily'){
    assert.match(row.display_name,/^QA release [0-9a-f]{7}$/);
    assert.equal(row.measurement_qa,true);
    assert.ok(row.source_day);
    assert.equal(row.auth_id,null);
  }else{
    assert.equal(row.player_id,fixture.playerId);
    assert.ok(row.source_share_id===fixture.shareId||(!row.auth_id&&row.source_share_id===null),'owned share identity changed');
    assert.equal(row.source_day,null);
    if(fixture.identityStyle==='short')assert.match(row.display_name,/^Creator Source [0-9a-f]{8}$/);
    else assert.equal(row.display_name,fixture.displayName,'recorded canary player name changed');
    if(row.auth_id){
      const tag=String(row.auth_email).match(/^qa-creator-source-([0-9a-f]{8})@example\.invalid$/)?.[1];
      assert.ok(tag,'owned account email must retain the full canary tag');
      assert.equal(row.auth_name,fixture.identityStyle==='short'?practiceCanaryIdentity(tag).name:'Creator Canary Source '+tag);
      assert.equal(row.display_name,normalizeDisplayName(row.auth_name));
    }else{
      assert.equal(row.measurement_qa,true,'missing owned auth is valid only after QA cleanup');
      assert.equal(row.profile_public,false);
    }
  }
}

export async function recoverKnownCanaryFixtures(query,{retire,cleanPractice,verifyRetired,record}) {
  for(const fixture of recoveryFixtures){
    const row=(await query(`SELECT c.id::text challenge_id,c.slug,c.source_type,c.source_share_id,
        c.source_owner_player_id::text source_owner_player_id,s.id::text session_id,
        s.player_id::text player_id,s.day::text source_day,s.measurement_qa,
        p.display_name,p.profile_public,a.auth_user_id::text auth_id,u.email auth_email,u.name auth_name
      FROM creator_challenges c JOIN draft_run_sessions s ON s.id=c.source_session_id
      JOIN players p ON p.id=s.player_id
      LEFT JOIN account_links a ON a.player_id=p.id LEFT JOIN neon_auth."user" u ON u.id=a.auth_user_id
      WHERE c.id=$1::uuid AND s.id=$2::uuid`,[fixture.challengeId,fixture.sessionId])).rows[0];
    validateRecoveryFixture(row,fixture);
    const assertOwnerScope=async()=>{
      const other=(await query(`SELECT id FROM creator_challenges WHERE source_owner_player_id=$1::uuid
        AND id<>$2::uuid AND NOT(status='retired' AND COALESCE(publication_detail->>'live_verified','false')='true')`,
        [row.player_id,fixture.challengeId])).rows;
      assert.equal(other.length,0,'known canary owner has unrelated active work; refusing broad retirement');
    };
    await retire(row.player_id,assertOwnerScope);
    await verifyRetired({id:fixture.challengeId,slug:fixture.slug});
    if(fixture.type==='practice'&&row.auth_id)await cleanPractice({
      authId:row.auth_id,email:row.auth_email,name:row.auth_name,playerId:row.player_id,
      sessionId:fixture.sessionId,shareId:fixture.shareId,challengeId:fixture.challengeId,
    });
    record({challenge_id:fixture.challengeId,source_session_id:fixture.sessionId,type:fixture.type,cleaned:true});
  }
}
