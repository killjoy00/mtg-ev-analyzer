import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  beginDeletion,
  cleanupPackOne,
  deletedPlayerTombstone,
  deletionEnabled,
  deletionRecoveryKey,
  finishProviderPhase,
  removeProviderUser,
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

test('pending transition uses the database serialization primitive',async()=>{
  let seen='';
  const row={operation_id:OP,auth_user_id:AUTH,player_id:PLAYER,state:'pending',attempts:'0'};
  const query=async(sql,params)=>{seen=sql;assert.deepEqual(params,[AUTH,null]);return {rows:[row],rowCount:1};};
  assert.deepEqual(await beginDeletion(query,{authUserId:AUTH}),row);
  assert.match(seen,/pack1_begin_account_deletion\(\$1::uuid,\$2::uuid\)/);
});

test('session issuance uses the fresh-snapshot deletion guard',async()=>{
  let seen='';
  await assert.rejects(
    issueAccountSession(async(sql)=>{seen=sql;return {rows:[],rowCount:0};},{user_id:AUTH}),
    error=>error?.code==='ACCOUNT_DELETING',
  );
  assert.match(seen,/pack1_identity_attachment_allowed\(\$2::uuid\)/);
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

test('Pack One cleanup hard-deletes attributable corpus events and preserves retained opponent score/outcome',async()=>{
  const calls=[];
  const current={operation_id:OP,auth_user_id:AUTH,player_id:PLAYER,state:'pending',attempts:0};
  const query=async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.includes('FROM account_deletion_operations WHERE operation_id='))return {rows:[current],rowCount:1};
    if(sql.startsWith('UPDATE account_deletion_operations'))return {rows:[{...current,state:'provider_delete_pending'}],rowCount:1};
    return {rows:[],rowCount:1};
  };
  const result=await cleanupPackOne(query,current);
  assert.equal(result.state,'provider_delete_pending');
  const text=calls.map(row=>row.sql).join('\n');
  assert.match(text,/DELETE FROM corpus_status_events WHERE auth_user_id=/);
  assert.doesNotMatch(text,/UPDATE corpus_status_events SET auth_user_id=NULL/);
  const retained=calls.find(row=>row.sql.includes('UPDATE game_results SET challenge_id=NULL,opponent_name=NULL'))?.sql||'';
  assert.ok(retained,'retained cross-player result is scrubbed');
  assert.doesNotMatch(retained,/opponent_score\s*=|outcome\s*=/);
});

test('provider deletion refuses a Pack One-linked service principal before remove-user',async()=>{
  const originalFetch=globalThis.fetch;
  const service='44444444-4444-4444-8444-444444444444';
  const paths=[];
  globalThis.fetch=async url=>{
    const path=new URL(url).pathname; paths.push(path);
    if(path.endsWith('/sign-in/email'))return new Response(JSON.stringify({user:{id:service}}),{status:200,headers:{'content-type':'application/json','set-cookie':'better-auth.session_token=secret; Path=/; HttpOnly'}});
    if(path.endsWith('/sign-out'))return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
    if(path.endsWith('/admin/remove-user'))return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
    throw Error('unexpected provider path');
  };
  try {
    const result=await removeProviderUser({
      authBase:'https://auth.example.test',
      authUserId:AUTH,
      env:{PACK1_DELETION_ADMIN_EMAIL:'delete-admin@example.test',PACK1_DELETION_ADMIN_PASSWORD:'x'.repeat(32)},
      validateServicePrincipal:async id=>{assert.equal(id,service);return false;},
    });
    assert.deepEqual(result,{kind:'operator_review',code:'PROVIDER_ADMIN_LINKED'});
    assert.equal(paths.includes('/admin/remove-user'),false,'linked service principal must never reach provider deletion');
  } finally {globalThis.fetch=originalFetch;}
});

test('provider deletion fails closed when service-principal Pack One isolation cannot be checked',async()=>{
  const originalFetch=globalThis.fetch;
  const service='44444444-4444-4444-8444-444444444444';
  globalThis.fetch=async url=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/sign-in/email'))return new Response(JSON.stringify({user:{id:service}}),{status:200,headers:{'content-type':'application/json','set-cookie':'better-auth.session_token=secret; Path=/; HttpOnly'}});
    return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const result=await removeProviderUser({
      authBase:'https://auth.example.test',authUserId:AUTH,
      env:{PACK1_DELETION_ADMIN_EMAIL:'delete-admin@example.test',PACK1_DELETION_ADMIN_PASSWORD:'x'.repeat(32)},
    });
    assert.deepEqual(result,{kind:'operator_review',code:'PROVIDER_ADMIN_LINK_POLICY'});
  } finally {globalThis.fetch=originalFetch;}
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
  assert.match(migration,/CREATE OR REPLACE FUNCTION pack1_identity_attachment_allowed/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION pack1_begin_account_deletion/);
  assert.match(migration,/pg_advisory_xact_lock/);
  const schema=fs.readFileSync('worker/schema.sql','utf8');
  assert.match(schema,/account_deletion_operations/);
  assert.match(schema,/CREATE OR REPLACE FUNCTION pack1_identity_attachment_allowed/);
  assert.match(schema,/CREATE OR REPLACE FUNCTION pack1_begin_account_deletion/);
  assert.match(schema,/account_delete_verify/);
  assert.match(schema,/account_delete_network/);
  assert.match(schema,/account_delete_init/);
  assert.ok(schema.includes("network_hash = '' OR network_hash ~ '^[a-f0-9]{64}$'"));
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

test('all Auth identity attachment surfaces share deletion serialization',()=>{
  for(const path of [
    'worker/account-session.mjs',
    'worker/account-credential-limits.mjs',
    'worker/patreon.mjs',
    'worker/capabilities.mjs',
    'worker/measurement-admin.mjs',
    'worker/corpus-admin.mjs',
    'worker/draft-run-function.mjs',
    'worker/growth-function.js',
  ]) {
    const source=fs.readFileSync(path,'utf8');
    assert.match(source,/pack1_identity_attachment_allowed/,path+' must use the fresh-snapshot account identity guard');
  }
});

test('deletion endpoint keeps the committed 200\/202 response and clears both browser identities',()=>{
  const source=fs.readFileSync('worker/growth-function.js','utf8');
  const start=source.indexOf('async function handleAccountDelete');
  const end=source.indexOf('function bearer',start);
  const block=source.slice(start,end);
  assert.match(block,/complete\?200:202/);
  assert.match(block,/clearPlayerCookie\(clearAccountCookies\(response\)\)/);
  assert.match(block,/providerPasswordSession/);
  assert.match(block,/\/verify-password/);
});

test('managed Auth direct deletion remains verification-only',()=>{
  const source=fs.readFileSync('worker/account-deletion.mjs','utf8');
  const direct=[...source.matchAll(/DELETE FROM neon_auth\.("?\w+"?)/g)].map(match=>match[1].replaceAll('"',''));
  assert.deepEqual(direct,['verification']);
  assert.doesNotMatch(source,/DELETE FROM neon_auth\.(?:"?user"?|account|session)\b/);
});

test('maintenance OIDC trust is exact repo owner main workflow audience and scheduled/manual events',()=>{
  const source=fs.readFileSync('worker/account-deletion-auth.mjs','utf8');
  assert.match(source,/killjoy00\/mtg-ev-analyzer/);
  assert.match(source,/REPOSITORY_ID='1201587098'/);
  assert.match(source,/OWNER_ID='211694413'/);
  assert.match(source,/refs\/heads\/main/);
  assert.match(source,/account-deletion-maintenance\.yml@refs\/heads\/main/);
  assert.match(source,/pack-one-account-deletion-maintenance/);
  assert.match(source,/\['schedule','workflow_dispatch'\]/);
  assert.doesNotMatch(source,/pull_request/);
});

test('same-repository PRs fail before merge when deletion release secrets are absent',()=>{
  const testFlow=fs.readFileSync('.github/workflows/test.yml','utf8');
  assert.match(testFlow,/Verify account-deletion release secrets are provisioned/);
  assert.match(testFlow,/secrets\.PACK1_DELETION_ADMIN_EMAIL != ''/);
  assert.match(testFlow,/secrets\.PACK1_DELETION_ADMIN_PASSWORD != ''/);
  assert.match(testFlow,/secrets\.PACK1_RATE_LIMIT_SECRET != ''/);
  assert.match(testFlow,/pull_request\.head\.repo\.full_name == github\.repository/);
  const release=fs.readFileSync('.github/workflows/secure-auth-release.yml','utf8');
  assert.match(release,/PACK1_DELETION_ADMIN_EMAIL is missing or malformed/);
  assert.match(release,/PACK1_DELETION_ADMIN_PASSWORD is missing or too short/);
});

test('manual controls redeploy the current release without migrations',()=>{
  const flow=fs.readFileSync('.github/workflows/account-deletion-controls.yml','utf8');
  assert.match(flow,/release_commit/);
  assert.match(flow,/git checkout --detach "\$commit"/);
  assert.doesNotMatch(flow,/psql|migrations\//);
  assert.match(flow,/PACK1_ACCOUNT_DELETION_ENABLED/);
  assert.match(flow,/PACK1_VERIFICATION_SWEEP_ENABLED/);
});
