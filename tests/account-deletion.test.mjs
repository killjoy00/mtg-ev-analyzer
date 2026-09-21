import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  beginDeletion,
  deletedPlayerTombstone,
  deletionEnabled,
  deletionRecoveryKey,
  finishProviderPhase,
  stuckDeletion,
  sweepExpiredVerification,
  verificationSweepEnabled,
} from '../worker/account-deletion.mjs';
import {issueAccountSession} from '../worker/account-session.mjs';

const AUTH='11111111-1111-4111-8111-111111111111';
const PLAYER='22222222-2222-4222-8222-222222222222';
const OP='33333333-3333-4333-8333-333333333333';

test('kill switches fail closed except exact 1',()=>{
  assert.equal(deletionEnabled({PACK1_ACCOUNT_DELETION_ENABLED:'1'}),true);
  for(const value of [undefined,'','0','true','01','yes'])assert.equal(deletionEnabled({PACK1_ACCOUNT_DELETION_ENABLED:value}),false);
  assert.equal(verificationSweepEnabled({PACK1_VERIFICATION_SWEEP_ENABLED:'1'}),true);
  for(const value of [undefined,'','0','true','01','yes'])assert.equal(verificationSweepEnabled({PACK1_VERIFICATION_SWEEP_ENABLED:value}),false);
});

test('recovery limiter key remains HMAC-only',()=>{
  const env={PACK1_RATE_LIMIT_SECRET:'x'.repeat(64)};
  const key=deletionRecoveryKey('Person@Example.com',env);
  assert.match(key,/^[a-f0-9]{64}$/);
  assert.equal(key.includes('person'),false);
  assert.equal(key,deletionRecoveryKey(' person@example.com ',env));
  assert.equal(deletionRecoveryKey('person@example.com',{}),null);
});

test('pending transition uses shared advisory lock and revokes sessions atomically',async()=>{
  let seen='';
  const row={operation_id:OP,auth_user_id:AUTH,player_id:PLAYER,state:'pending',attempts:'0'};
  const query=async(sql,params)=>{seen=sql;assert.deepEqual(params,[AUTH,null]);return {rows:[row],rowCount:1};};
  assert.deepEqual(await beginDeletion(query,{authUserId:AUTH}),row);
  assert.match(seen,/pg_advisory_xact_lock\(hashtextextended\(\$1::text,0\)\)/);
  assert.match(seen,/INSERT INTO account_deletion_operations/);
  assert.match(seen,/UPDATE account_sessions/);
});

test('session issuance uses the same lock and denies tombstoned identities',async()=>{
  let seen='';
  await assert.rejects(
    issueAccountSession(async(sql)=>{seen=sql;return {rows:[],rowCount:0};},{user_id:AUTH}),
    error=>error?.code==='ACCOUNT_DELETING',
  );
  assert.match(seen,/pg_advisory_xact_lock\(hashtextextended\(\$2::text,0\)\)/);
  assert.match(seen,/account_deletion_operations/);
});

test('stale player tombstone lookup rejects deleted career ids',async()=>{
  const yes=await deletedPlayerTombstone(async(sql,params)=>{
    assert.match(sql,/account_deletion_operations/);assert.deepEqual(params,[PLAYER]);
    return {rows:[{'?column?':'1'}],rowCount:1};
  },PLAYER);
  assert.equal(yes,true);
  assert.equal(await deletedPlayerTombstone(async()=>{throw Error('must not query');},'bad'),false);
});

test('verification sweep is expired-only, bounded and idempotent-shaped',async()=>{
  let seen='',params;
  const count=await sweepExpiredVerification(async(sql,p)=>{seen=sql;params=p;return {rows:[],rowCount:2};},{limit:9999});
  assert.equal(count,2);
  assert.deepEqual(params,[500]);
  assert.match(seen,/"expiresAt"<now\(\)/);
  assert.match(seen,/ORDER BY "expiresAt",id/);
  assert.match(seen,/LIMIT \$1::int/);
  assert.doesNotMatch(seen,/neon_auth\."user"|neon_auth\.account|neon_auth\.session/);
});

test('provider not-found is success only from provider-delete-pending',async()=>{
  const updates=[];
  const query=async(sql,params)=>{
    updates.push(sql);
    if(sql.startsWith('UPDATE')&&sql.includes("state='complete'"))return {rows:[{operation_id:OP,state:'complete'}],rowCount:1};
    if(sql.startsWith('UPDATE'))return {rows:[],rowCount:1};
    return {rows:[{operation_id:OP,state:'operator_review'}],rowCount:1};
  };
  const complete=await finishProviderPhase(query,{operation_id:OP,state:'provider_delete_pending'},{kind:'not_found'});
  assert.equal(complete.state,'complete');
  const review=await finishProviderPhase(query,{operation_id:OP,state:'pending'},{kind:'not_found'});
  assert.equal(review.state,'operator_review');
});

test('stuck threshold is 15 minutes and operator_review is immediate',()=>{
  const now=Date.now();
  assert.equal(stuckDeletion({state:'provider_delete_pending',created_at:new Date(now-14*60*1000).toISOString()},now),false);
  assert.equal(stuckDeletion({state:'provider_delete_pending',created_at:new Date(now-16*60*1000).toISOString()},now),true);
  assert.equal(stuckDeletion({state:'operator_review',created_at:new Date(now).toISOString()},now),true);
});

test('schema and release bookkeeping include migration 0031 in both stages',()=>{
  const migration=fs.readFileSync('migrations/0031_account_deletion.sql','utf8');
  assert.match(migration,/account_deletion_operations/);
  assert.match(migration,/account_delete_init/);
  const schema=fs.readFileSync('worker/schema.sql','utf8');
  assert.match(schema,/account_deletion_operations/);
  const verify=fs.readFileSync('scripts/verify-neon-schema.mjs','utf8');
  assert.match(verify,/account_deletion_operations/);
  const release=fs.readFileSync('.github/workflows/secure-auth-release.yml','utf8');
  assert.equal((release.match(/migrations\/0031_account_deletion\.sql/g)||[]).length,2);
});

test('public gateway allows deletion but not maintenance endpoint',()=>{
  const gateway=fs.readFileSync('edge/gateway.mjs','utf8');
  assert.match(gateway,/'\/v1\/account\/delete'/);
  const permittedBlock=gateway.slice(gateway.indexOf('function permitted'),gateway.indexOf('function selectedCookies'));
  assert.doesNotMatch(permittedBlock,/account-deletion-maintenance/);
});

test('maintenance workflow has schedule, dispatch, concurrency and OIDC',()=>{
  const flow=fs.readFileSync('.github/workflows/account-deletion-maintenance.yml','utf8');
  assert.match(flow,/cron: '\*\/10 \* \* \* \*'/);
  assert.match(flow,/workflow_dispatch/);
  assert.match(flow,/id-token: write/);
  assert.match(flow,/group: pack1-account-deletion-maintenance/);
  assert.match(flow,/GITHUB_STEP_SUMMARY/);
});

test('manual controls redeploy the current release without migrations',()=>{
  const flow=fs.readFileSync('.github/workflows/account-deletion-controls.yml','utf8');
  assert.match(flow,/release_commit/);
  assert.match(flow,/git checkout --detach "\$commit"/);
  assert.doesNotMatch(flow,/psql|migrations\//);
  assert.match(flow,/PACK1_ACCOUNT_DELETION_ENABLED/);
  assert.match(flow,/PACK1_VERIFICATION_SWEEP_ENABLED/);
});
