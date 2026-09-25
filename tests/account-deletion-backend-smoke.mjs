import fs from 'node:fs';
import assert from 'node:assert/strict';

if(!process.argv.includes('--dev-fixtures'))throw Error('Requires an isolated fixture database.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();

const {default:growth,query}=await import('../worker/growth-function.js');
const {beginDeletion,cleanupPackOne,sweepExpiredVerification}=await import('../worker/account-deletion.mjs');
const {issueAccountSession}=await import('../worker/account-session.mjs');
const {
  consumeDeletionVerification,
  deletionCodeHmac,
  purgeExpiredDeletionVerifications,
  storeDeletionVerification,
}=await import('../worker/account-deletion-verification.mjs');

const auth=crypto.randomUUID();
const player=crypto.randomUUID();
const other=crypto.randomUUID();
const challenge='qa-delete-'+crypto.randomUUID().replaceAll('-','').slice(0,20);
const draftShare='qa-draft-'+crypto.randomUUID().replaceAll('-','').slice(0,20);
const draftOwnerSession=crypto.randomUUID();
const draftRetainedSession=crypto.randomUUID();
const recovery='b'.repeat(64);
const deletionEnv={PACK1_RATE_LIMIT_SECRET:'h'.repeat(64)};
const verificationAuth=crypto.randomUUID();
const verificationRaceAuth=crypto.randomUUID();

async function deletionTrigger(name='pack1-account-deletion-maintenance',status=[200,503]) {
  const invocationId='qa-delete-trigger-'+crypto.randomUUID();
  const response=await growth.fetch(new Request('https://origin.test/internal/account-deletion-maintenance',{
    method:'POST',
    headers:{'content-type':'application/json','x-neon-trigger-invocation-id':invocationId},
    body:JSON.stringify({
      version:1,
      invocation_id:invocationId,
      trigger:{type:'schedule',id:'trigger-qa-delete',name},
      data:{scheduled_at:'2041-06-15T16:09:00Z'},
    }),
  }));
  const data=await response.json();
  const allowed=Array.isArray(status)?status:[status];
  assert.ok(allowed.includes(response.status),JSON.stringify({status:response.status,body:data}));
  return data;
}

try {
  const scheduled=await deletionTrigger();
  assert.equal(scheduled.report_only,false);
  assert.equal(Array.isArray(scheduled.advanced),true);
  assert.equal(Array.isArray(scheduled.attention),true);
  await deletionTrigger('wrong-trigger',403);

  // Exercise the shared advisory lock with two independent runtime queries.
  // The account is an existing Auth identity from this disposable Neon branch;
  // this test never mutates managed Auth user/account/session tables.
  const raceAuth=(await query(`SELECT u.id
    FROM neon_auth."user" u
    WHERE NOT EXISTS (
      SELECT 1 FROM account_deletion_operations d WHERE d.auth_user_id=u.id
    )
    ORDER BY u."createdAt",u.id
    LIMIT 1`)).rows[0]?.id;
  assert.ok(raceAuth,'isolated branch must contain an Auth identity for the deletion/session race');
  const [deleteRace,sessionRace]=await Promise.allSettled([
    beginDeletion(query,{authUserId:raceAuth}),
    issueAccountSession(query,{user_id:raceAuth}),
  ]);
  assert.equal(deleteRace.status,'fulfilled','deletion must commit its tombstone in the race');
  if(sessionRace.status==='rejected')assert.equal(sessionRace.reason?.code,'ACCOUNT_DELETING');
  const raceLive=Number((await query(`SELECT count(*)::int n FROM account_sessions
    WHERE auth_user_id=$1::uuid AND revoked_at IS NULL AND expires_at>now()`,[raceAuth])).rows[0].n);
  assert.equal(raceLive,0,'a concurrent account session must never remain live after deletion commits');
  assert.equal(Number((await query('SELECT count(*)::int n FROM account_deletion_operations WHERE auth_user_id=$1::uuid',[raceAuth])).rows[0].n),1);

  // The maintenance sweep must delete only expired verification rows. The
  // unexpired fixture is intentionally left for disposal with the CI branch.
  const expiredVerification=crypto.randomUUID();
  const freshVerification=crypto.randomUUID();
  const marker='qa-delete-verification-'+crypto.randomUUID();
  await query(`INSERT INTO neon_auth.verification(id,identifier,value,"expiresAt")
    VALUES($1::uuid,$3,$3,now()-interval '1 minute'),
          ($2::uuid,$3,$3,now()+interval '1 hour')`,[expiredVerification,freshVerification,marker]);
  const swept=await sweepExpiredVerification(query,{limit:500});
  assert.ok(swept>=1);
  assert.equal(Number((await query('SELECT count(*)::int n FROM neon_auth.verification WHERE id=$1::uuid',[expiredVerification])).rows[0].n),0);
  assert.equal(Number((await query('SELECT count(*)::int n FROM neon_auth.verification WHERE id=$1::uuid',[freshVerification])).rows[0].n),1);


  // Passwordless deletion verification state is one-row, replaceable, expiring,
  // and consumed atomically by Auth UUID + HMAC.
  await query(`INSERT INTO account_deletion_verifications(auth_user_id,code_hmac,created_at,expires_at)
    VALUES($1::uuid,$2,now()-interval '2 minutes',now()-interval '1 minute')`,[
      verificationAuth,deletionCodeHmac(verificationAuth,'11111111',deletionEnv),
    ]);
  assert.ok(await purgeExpiredDeletionVerifications(query)>=1);
  assert.equal(Number((await query('SELECT count(*)::int n FROM account_deletion_verifications WHERE auth_user_id=$1::uuid',[verificationAuth])).rows[0].n),0);

  await storeDeletionVerification(query,{
    authUserId:verificationAuth,
    codeHmac:deletionCodeHmac(verificationAuth,'22222222',deletionEnv),
  });
  await storeDeletionVerification(query,{
    authUserId:verificationAuth,
    codeHmac:deletionCodeHmac(verificationAuth,'33333333',deletionEnv),
  });
  const replaced=(await query('SELECT code_hmac FROM account_deletion_verifications WHERE auth_user_id=$1::uuid',[verificationAuth])).rows[0];
  assert.equal(replaced.code_hmac,deletionCodeHmac(verificationAuth,'33333333',deletionEnv),'resend must replace the prior code row');
  assert.equal(await consumeDeletionVerification(query,{authUserId:verificationAuth,code:'22222222',env:deletionEnv}),false,'replaced code must fail');

  const consumeResults=await Promise.all([
    consumeDeletionVerification(query,{authUserId:verificationAuth,code:'33333333',env:deletionEnv}),
    consumeDeletionVerification(query,{authUserId:verificationAuth,code:'33333333',env:deletionEnv}),
  ]);
  assert.equal(consumeResults.filter(Boolean).length,1,'concurrent code consumption must have exactly one winner');
  assert.equal(Number((await query('SELECT count(*)::int n FROM account_deletion_verifications WHERE auth_user_id=$1::uuid',[verificationAuth])).rows[0].n),0);

  // Race issuance against tombstone creation on the same per-user advisory-lock
  // boundary. Issuance may win before deletion, or it may fail after deletion;
  // once the tombstone exists, a later resend must never create or replace state.
  const [issueRace,deletionRace]=await Promise.allSettled([
    storeDeletionVerification(query,{
      authUserId:verificationRaceAuth,
      codeHmac:deletionCodeHmac(verificationRaceAuth,'66666666',deletionEnv),
    }),
    beginDeletion(query,{authUserId:verificationRaceAuth}),
  ]);
  assert.equal(deletionRace.status,'fulfilled','deletion must commit in the verification issuance race');
  if(issueRace.status==='rejected')assert.equal(issueRace.reason?.code,'ACCOUNT_DELETING');
  const raceRowBefore=Number((await query(
    'SELECT count(*)::int n FROM account_deletion_verifications WHERE auth_user_id=$1::uuid',
    [verificationRaceAuth],
  )).rows[0].n);
  await assert.rejects(
    storeDeletionVerification(query,{
      authUserId:verificationRaceAuth,
      codeHmac:deletionCodeHmac(verificationRaceAuth,'77777777',deletionEnv),
    }),
    error=>error?.code==='ACCOUNT_DELETING',
    'resend after the deletion tombstone commits must be refused',
  );
  const raceRowAfter=Number((await query(
    'SELECT count(*)::int n FROM account_deletion_verifications WHERE auth_user_id=$1::uuid',
    [verificationRaceAuth],
  )).rows[0].n);
  assert.equal(raceRowAfter,raceRowBefore,'post-tombstone resend must not recreate or replace verification state');

  await query('INSERT INTO players(id,display_name) VALUES($1::uuid,$2),($3::uuid,$4)',[
    player,'QA Deleted Player',other,'QA Retained Player',
  ]);
  const puzzleIds=JSON.stringify(Array.from({length:10},(_,i)=>`qa-puzzle-${i}`));
  await query(`INSERT INTO draft_run_sessions(id,player_id,seed,corpus_version,scoring_version,puzzle_ids,seen_sources)
    VALUES($1::uuid,$2::uuid,'qa-owner','qa-corpus','qa-scoring',$5::jsonb,'[]'::jsonb),
          ($3::uuid,$4::uuid,'qa-retained','qa-corpus','qa-scoring',$5::jsonb,'[]'::jsonb)`,[
      draftOwnerSession,player,draftRetainedSession,other,puzzleIds,
    ]);
  await query(`INSERT INTO draft_run_shares(id,session_id,display_name,score,puzzle_ids)
    VALUES($1,$2::uuid,'Deleted Draft Opponent',84,$3::jsonb)`,[draftShare,draftOwnerSession,puzzleIds]);
  await query('UPDATE draft_run_sessions SET challenge_id=$1 WHERE id=$2::uuid',[draftShare,draftRetainedSession]);
  await query(`INSERT INTO share_challenges(id,player_id,display_name,set_id,set_name,pack_json,selected_json,score,grade)
    VALUES($1,$2::uuid,'Deleted Opponent','qa','QA','[]'::jsonb,'[]'::jsonb,80,'B')`,[challenge,player]);
  const retained=(await query(`INSERT INTO game_results(player_id,set_id,mode,score,grade,challenge_id,opponent_name,opponent_score,outcome,client_result_id)
    VALUES($1::uuid,'qa','full',75,'C',$2,'Deleted Opponent',80,'loss',$3) RETURNING id`,[
      other,challenge,'qa-retained-'+crypto.randomUUID(),
    ])).rows[0];
  const retainedDraft=(await query(`INSERT INTO game_results(player_id,set_id,mode,score,grade,challenge_id,opponent_name,opponent_score,outcome,client_result_id)
    VALUES($1::uuid,'qa','draft_run',88,'B',$2,'Deleted Draft Opponent',84,'win',$3) RETURNING id`,[
      other,draftShare,'qa-retained-draft-'+crypto.randomUUID(),
    ])).rows[0];
  await query(`INSERT INTO corpus_status_events(set_id,auth_user_id,old_status,new_status,reason)
    VALUES('qa',$1::uuid,'Candidate','Paused','deletion fixture')`,[auth]);
  await query(`INSERT INTO account_credential_rate_limits(auth_user_id,purpose,network_hash,attempts,expires_at)
    VALUES($1::uuid,'account_delete_init','',1,now()+interval '15 minutes')`,[auth]);
  await query(`INSERT INTO account_recovery_rate_limits(limit_key,attempts,expires_at)
    VALUES($1,1,now()+interval '15 minutes')`,[recovery]);

  await storeDeletionVerification(query,{
    authUserId:auth,
    codeHmac:deletionCodeHmac(auth,'44444444',deletionEnv),
  });
  const operation=await beginDeletion(query,{authUserId:auth,playerId:player});
  assert.equal(operation.auth_user_id,auth);
  assert.equal(operation.player_id,player);
  assert.equal(operation.state,'pending');

  const cleaned=await cleanupPackOne(query,operation,{recoveryKey:recovery});
  assert.equal(cleaned.state,'provider_delete_pending');

  const count=async(sql,params=[])=>Number((await query(sql,params)).rows[0].n);
  assert.equal(await count('SELECT count(*)::int n FROM players WHERE id=$1::uuid',[player]),0);
  assert.equal(await count('SELECT count(*)::int n FROM corpus_status_events WHERE auth_user_id=$1::uuid',[auth]),0);
  assert.equal(await count('SELECT count(*)::int n FROM account_credential_rate_limits WHERE auth_user_id=$1::uuid',[auth]),0);
  assert.equal(await count('SELECT count(*)::int n FROM account_deletion_verifications WHERE auth_user_id=$1::uuid',[auth]),0);
  assert.equal(await count('SELECT count(*)::int n FROM account_recovery_rate_limits WHERE limit_key=$1',[recovery]),0);
  const retainedRow=(await query('SELECT challenge_id,opponent_name,opponent_score,outcome FROM game_results WHERE id=$1',[retained.id])).rows[0];
  assert.equal(retainedRow.challenge_id,null);
  assert.equal(retainedRow.opponent_name,null);
  assert.equal(Number(retainedRow.opponent_score),80);
  assert.equal(retainedRow.outcome,'loss');
  const retainedDraftRow=(await query('SELECT challenge_id,opponent_name,opponent_score,outcome FROM game_results WHERE id=$1',[retainedDraft.id])).rows[0];
  assert.equal(retainedDraftRow.challenge_id,null);
  assert.equal(retainedDraftRow.opponent_name,null);
  assert.equal(Number(retainedDraftRow.opponent_score),84);
  assert.equal(retainedDraftRow.outcome,'win');
  const retainedDraftSession=(await query('SELECT challenge_id FROM draft_run_sessions WHERE id=$1::uuid',[draftRetainedSession])).rows[0];
  assert.ok(retainedDraftSession,'another player\'s Draft Run session must be retained');
  assert.equal(retainedDraftSession.challenge_id,null,'deleted Draft Run share must not remain as a dangling challenge');

  const tombstone=(await query('SELECT auth_user_id,player_id,state FROM account_deletion_operations WHERE operation_id=$1::uuid',[operation.operation_id])).rows[0];
  assert.equal(tombstone.auth_user_id,auth);
  assert.equal(tombstone.player_id,player);
  assert.equal(tombstone.state,'provider_delete_pending');

  await assert.rejects(
    storeDeletionVerification(query,{
      authUserId:auth,
      codeHmac:deletionCodeHmac(auth,'55555555',deletionEnv),
    }),
    error=>error?.code==='ACCOUNT_DELETING',
    'guarded issuance must refuse to recreate verification state after deletion commits',
  );
  assert.equal(await count('SELECT count(*)::int n FROM account_deletion_verifications WHERE auth_user_id=$1::uuid',[auth]),0);

  const again=await cleanupPackOne(query,cleaned,{recoveryKey:recovery});
  assert.equal(again.state,'provider_delete_pending','cleanup is rerunnable while provider deletion is pending');

  console.log('Account deletion SQL cleanup passed: Neon trigger auth, durable tombstone, cross-player preservation, hard deletes, and idempotent resume without managed-Auth fixture mutation.');
} finally {
  await query(`DELETE FROM draft_run_shares WHERE session_id IN (
    SELECT id FROM draft_run_sessions WHERE player_id=$1::uuid OR player_id=$2::uuid
  )`,[player,other]);
  await query('DELETE FROM draft_run_sessions WHERE player_id=$1::uuid OR player_id=$2::uuid',[player,other]);
  await query('DELETE FROM game_results WHERE player_id=$1::uuid OR player_id=$2::uuid',[other,player]);
  await query('DELETE FROM share_challenges WHERE player_id=$1::uuid',[player]);
  await query('DELETE FROM account_deletion_verifications WHERE auth_user_id=$1::uuid OR auth_user_id=$2::uuid',[verificationAuth,verificationRaceAuth]);
  await query('DELETE FROM players WHERE id=$1::uuid OR id=$2::uuid',[other,player]);
}
