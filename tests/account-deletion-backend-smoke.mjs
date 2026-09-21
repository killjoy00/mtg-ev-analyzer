import fs from 'node:fs';
import assert from 'node:assert/strict';

if(!process.argv.includes('--dev-fixtures'))throw Error('Requires an isolated fixture database.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();

const {query}=await import('../worker/growth-function.js');
const {beginDeletion,cleanupPackOne}=await import('../worker/account-deletion.mjs');

const auth=crypto.randomUUID();
const player=crypto.randomUUID();
const other=crypto.randomUUID();
const challenge='qa-delete-'+crypto.randomUUID().replaceAll('-','').slice(0,20);
const invite='a'.repeat(64);
const recovery='b'.repeat(64);

try {
  await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,true)',[
    auth,'QA Delete','qa-delete-'+auth+'@example.invalid',
  ]);
  await query('INSERT INTO players(id,display_name) VALUES($1::uuid,$2),($3::uuid,$4)',[
    player,'QA Deleted Player',other,'QA Retained Player',
  ]);
  await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[auth,player]);
  await query(`INSERT INTO share_challenges(id,player_id,display_name,set_id,set_name,pack_json,selected_json,score,grade)
    VALUES($1,$2::uuid,'Deleted Opponent','qa','QA','[]'::jsonb,'[]'::jsonb,80,'B')`,[challenge,player]);
  const retained=(await query(`INSERT INTO game_results(player_id,set_id,mode,score,grade,challenge_id,opponent_name,opponent_score,outcome,client_result_id)
    VALUES($1::uuid,'qa','full',75,'C',$2,'Deleted Opponent',80,'loss',$3) RETURNING id`,[
      other,challenge,'qa-retained-'+crypto.randomUUID(),
    ])).rows[0];
  await query(`INSERT INTO corpus_status_events(set_id,auth_user_id,old_status,new_status,reason)
    VALUES('qa',$1::uuid,'Candidate','Paused','deletion fixture')`,[auth]);
  await query(`INSERT INTO pack1_admin_invites(token_hash,expires_at,redeemed_by,redeemed_at)
    VALUES($1,now()+interval '1 hour',$2::uuid,now())`,[invite,auth]);
  await query(`INSERT INTO account_credential_rate_limits(auth_user_id,purpose,network_hash,attempts,expires_at)
    VALUES($1::uuid,'account_delete_init','',1,now()+interval '15 minutes')`,[auth]);
  await query(`INSERT INTO account_recovery_rate_limits(limit_key,attempts,expires_at)
    VALUES($1,1,now()+interval '15 minutes')`,[recovery]);

  const operation=await beginDeletion(query,{authUserId:auth});
  assert.equal(operation.auth_user_id,auth);
  assert.equal(operation.player_id,player);
  assert.equal(operation.state,'pending');

  const cleaned=await cleanupPackOne(query,operation,{recoveryKey:recovery});
  assert.equal(cleaned.state,'provider_delete_pending');

  const count=async(sql,params=[])=>Number((await query(sql,params)).rows[0].n);
  assert.equal(await count('SELECT count(*)::int n FROM account_links WHERE auth_user_id=$1::uuid',[auth]),0);
  assert.equal(await count('SELECT count(*)::int n FROM players WHERE id=$1::uuid',[player]),0);
  assert.equal(await count('SELECT count(*)::int n FROM corpus_status_events WHERE auth_user_id=$1::uuid',[auth]),0);
  assert.equal(await count('SELECT count(*)::int n FROM account_credential_rate_limits WHERE auth_user_id=$1::uuid',[auth]),0);
  assert.equal(await count('SELECT count(*)::int n FROM account_recovery_rate_limits WHERE limit_key=$1',[recovery]),0);
  assert.equal(await count('SELECT count(*)::int n FROM neon_auth."user" WHERE id=$1::uuid',[auth]),1,'Pack One cleanup must not directly delete managed Auth user rows');

  const inviteRow=(await query('SELECT redeemed_by FROM pack1_admin_invites WHERE token_hash=$1',[invite])).rows[0];
  assert.equal(inviteRow.redeemed_by,null,'admin invite is detached before provider deletion');

  const retainedRow=(await query('SELECT challenge_id,opponent_name,opponent_score,outcome FROM game_results WHERE id=$1',[retained.id])).rows[0];
  assert.equal(retainedRow.challenge_id,null);
  assert.equal(retainedRow.opponent_name,null);
  assert.equal(Number(retainedRow.opponent_score),80);
  assert.equal(retainedRow.outcome,'loss');

  const tombstone=(await query('SELECT auth_user_id,player_id,state FROM account_deletion_operations WHERE operation_id=$1::uuid',[operation.operation_id])).rows[0];
  assert.equal(tombstone.auth_user_id,auth);
  assert.equal(tombstone.player_id,player);
  assert.equal(tombstone.state,'provider_delete_pending');

  const again=await cleanupPackOne(query,cleaned,{recoveryKey:recovery});
  assert.equal(again.state,'provider_delete_pending','cleanup is rerunnable while provider deletion is pending');

  console.log('Account deletion SQL cleanup passed: durable tombstone, managed-Auth boundary, cross-player preservation, admin detachment, hard deletes, and idempotent resume.');
} finally {
  await query('DELETE FROM pack1_admin_invites WHERE token_hash=$1',[invite]);
  await query('DELETE FROM game_results WHERE player_id=$1::uuid',[other]);
  await query('DELETE FROM players WHERE id=$1::uuid',[other]);
  await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[auth]);
}
