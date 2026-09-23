import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHmac} from 'node:crypto';

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
import {
  consumeDeletionVerification,
  createDeletionVerification,
  deletionCodeHmac,
  deletionEmailConfigured,
  deletionEmailForAuth,
  sendDeletionEmail,
} from '../worker/account-deletion-verification.mjs';

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


test('deletion email configuration is local-only and requires a Resend-shaped key',()=>{
  assert.equal(deletionEmailConfigured({PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_fixture'}),true);
  for(const value of [undefined,'','fixture','RE_fixture',' re_fixture'])
    assert.equal(deletionEmailConfigured({PACK1_ACCOUNT_DELETE_RESEND_API_KEY:value}),false);
});

test('deletion code HMAC is keyed, Auth-bound and deletion-specific',()=>{
  const secret='s'.repeat(64),code='01234567';
  const env={PACK1_RATE_LIMIT_SECRET:secret};
  const actual=deletionCodeHmac(AUTH,code,env);
  const expected=createHmac('sha256',secret).update('pack1-account-delete-code:'+AUTH+':'+code).digest('hex');
  assert.equal(actual,expected);
  assert.notEqual(actual,deletionCodeHmac('55555555-5555-4555-8555-555555555555',code,env));
  assert.throws(()=>deletionCodeHmac(AUTH,'1234',env),error=>error?.code==='DELETE_CODE_INVALID');
});

test('deletion email is send-only content and does not place the code or identifiers in a URL',async()=>{
  let request=null;
  await sendDeletionEmail({
    email:'verified@example.test',
    code:'12345678',
    env:{PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_fixture'},
    fetcher:async(url,options)=>{request={url,options};return new Response('{}',{status:200});},
  });
  assert.equal(request.url,'https://api.resend.com/emails');
  const body=JSON.parse(request.options.body);
  assert.equal(body.from,'Pack One <accounts@packone.pro>');
  assert.deepEqual(body.to,['verified@example.test']);
  assert.match(body.text,/12345678/);
  assert.match(body.text,/about 10 minutes/i);
  assert.match(body.text,/did not request account deletion/i);
  assert.doesNotMatch(request.url,new RegExp([AUTH,PLAYER].join('|')));
  assert.doesNotMatch(body.text,new RegExp([AUTH,PLAYER,OP].join('|')));
});

test('deletion capability reads the current verified Auth email server-side',async()=>{
  const calls=[];
  const query=async(sql,params)=>{calls.push({sql,params});return {rows:[{email:'verified@example.test',email_verified:'t'}]};};
  assert.equal(await deletionEmailForAuth(query,AUTH),'verified@example.test');
  assert.deepEqual(calls[0].params,[AUTH]);
  assert.match(calls[0].sql,/neon_auth\."user"/);
  assert.match(calls[0].sql,/"emailVerified"/);
  assert.equal(await deletionEmailForAuth(async()=>({rows:[{email:'verified@example.test',email_verified:'f'}]}),AUTH),null);
  assert.equal(await deletionEmailForAuth(async()=>({rows:[{email:'',email_verified:'t'}]}),AUTH),null);
});

test('deletion code issuance purges expiry, uses the deletion guard and exposes the code only to the sender dependency',async()=>{
  const calls=[];let delivered=null;
  const env={PACK1_RATE_LIMIT_SECRET:'h'.repeat(64),PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_fixture'};
  const query=async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.startsWith('DELETE FROM account_deletion_verifications WHERE expires_at'))return {rows:[],rowCount:2};
    if(sql.startsWith('INSERT INTO account_deletion_verifications'))return {rows:[{auth_user_id:AUTH,code_hmac:params[1],expires_at:'2099-01-01T00:00:00Z'}],rowCount:1};
    throw Error('unexpected SQL');
  };
  const result=await createDeletionVerification(query,{
    authUserId:AUTH,email:'verified@example.test',env,
    sender:async payload=>{delivered=payload;},
  });
  assert.equal(result.expiresInSeconds,600);
  assert.match(delivered.code,/^\d{8}$/);
  assert.equal(delivered.email,'verified@example.test');
  const insert=calls.find(row=>row.sql.startsWith('INSERT INTO account_deletion_verifications'));
  assert.match(insert.sql,/pack1_identity_attachment_allowed\(\$1::uuid\)/);
  assert.match(insert.sql,/ON CONFLICT\(auth_user_id\) DO UPDATE/);
  assert.equal(insert.params[1],deletionCodeHmac(AUTH,delivered.code,env));
  assert.equal(calls.some(row=>row.params.some(value=>value===delivered.code)),false,'plaintext code must never be persisted');
});

test('guarded issuance sends nothing after deletion has begun',async()=>{
  let sent=false;
  const env={PACK1_RATE_LIMIT_SECRET:'h'.repeat(64),PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_fixture'};
  const query=async(sql)=>{
    if(sql.startsWith('DELETE FROM account_deletion_verifications WHERE expires_at'))return {rows:[],rowCount:0};
    if(sql.startsWith('INSERT INTO account_deletion_verifications'))return {rows:[],rowCount:0};
    throw Error('unexpected SQL');
  };
  await assert.rejects(
    createDeletionVerification(query,{authUserId:AUTH,email:'verified@example.test',env,sender:async()=>{sent=true;}}),
    error=>error?.code==='ACCOUNT_DELETING',
  );
  assert.equal(sent,false);
});

test('failed send deletes only the row carrying that send attempt HMAC',async()=>{
  const calls=[];
  const env={PACK1_RATE_LIMIT_SECRET:'h'.repeat(64),PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_fixture'};
  const query=async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.startsWith('DELETE FROM account_deletion_verifications WHERE expires_at'))return {rows:[],rowCount:0};
    if(sql.startsWith('INSERT INTO account_deletion_verifications'))return {rows:[{auth_user_id:AUTH,code_hmac:params[1],expires_at:'2099-01-01T00:00:00Z'}],rowCount:1};
    if(sql.startsWith('DELETE FROM account_deletion_verifications WHERE auth_user_id='))return {rows:[],rowCount:0};
    throw Error('unexpected SQL');
  };
  await assert.rejects(
    createDeletionVerification(query,{authUserId:AUTH,email:'verified@example.test',env,sender:async()=>{throw Error('provider failed');}}),
    error=>error?.code==='DELETE_EMAIL_SEND_FAILED',
  );
  const inserted=calls.find(row=>row.sql.startsWith('INSERT INTO account_deletion_verifications'));
  const cleanup=calls.find(row=>row.sql.startsWith('DELETE FROM account_deletion_verifications WHERE auth_user_id='));
  assert.deepEqual(cleanup.params,[AUTH,inserted.params[1]]);
  assert.match(cleanup.sql,/auth_user_id=\$1::uuid AND code_hmac=\$2/);
});

test('verification consumption is one-row atomic and requires equality plus unexpired state',async()=>{
  const env={PACK1_RATE_LIMIT_SECRET:'h'.repeat(64)};
  let seen='';
  const ok=await consumeDeletionVerification(async(sql,params)=>{
    seen=sql;
    assert.equal(params[0],AUTH);
    assert.equal(params[1],deletionCodeHmac(AUTH,'87654321',env));
    return {rows:[{auth_user_id:AUTH}],rowCount:1};
  },{authUserId:AUTH,code:'87654321',env});
  assert.equal(ok,true);
  assert.match(seen,/DELETE FROM account_deletion_verifications/);
  assert.match(seen,/code_hmac=\$2/);
  assert.match(seen,/expires_at>now\(\)/);
  assert.match(seen,/RETURNING auth_user_id/);
  assert.equal(await consumeDeletionVerification(async()=>({rows:[],rowCount:0}),{authUserId:AUTH,code:'87654321',env}),false);
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
  assert.match(text,/DELETE FROM account_deletion_verifications WHERE auth_user_id=/);
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

test('schema and release bookkeeping include deletion migrations in both secure release stages',()=>{
  const migration=fs.readFileSync('migrations/0031_account_deletion.sql','utf8');
  assert.match(migration,/account_deletion_operations/);
  assert.match(migration,/account_delete_init/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION pack1_identity_attachment_allowed/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION pack1_begin_account_deletion/);
  assert.match(migration,/pg_advisory_xact_lock/);
  const verificationMigration=fs.readFileSync('migrations/0034_account_deletion_verification.sql','utf8');
  assert.match(verificationMigration,/CREATE TABLE IF NOT EXISTS account_deletion_verifications/);
  assert.match(verificationMigration,/auth_user_id uuid PRIMARY KEY/);
  assert.match(verificationMigration,/code_hmac/);
  assert.doesNotMatch(verificationMigration,/challenge_id|consumed_at|invalidated_at|purpose/);
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
  assert.match(verify,/account_deletion_verifications/);
  assert.match(verify,/through 0035/);
  const release=fs.readFileSync('.github/workflows/secure-auth-release.yml','utf8');
  assert.equal((release.match(/migrations\/0031_account_deletion\.sql/g)||[]).length,2);
  assert.equal((release.match(/migrations\/0034_account_deletion_verification\.sql/g)||[]).length,2);
});

test('public gateway allows deletion but not maintenance endpoint',()=>{
  const gateway=fs.readFileSync('edge/gateway.mjs','utf8');
  assert.match(gateway,/'\/v1\/account\/delete'/);
  assert.match(gateway,/'\/v1\/account\/delete\/verification\/start'/);
  const permittedBlock=gateway.slice(gateway.indexOf('function permitted'),gateway.indexOf('function selectedCookies'));
  assert.doesNotMatch(permittedBlock,/account-deletion-maintenance/);
  assert.doesNotMatch(permittedBlock,/account-deletion-maintenance-status/);
});

test('GitHub deletion workflow is manual recovery plus read-only scheduled alerting',()=>{
  const flow=fs.readFileSync('.github/workflows/account-deletion-maintenance.yml','utf8');
  assert.match(flow,/cron: '17,47 \* \* \* \*'/);
  assert.match(flow,/workflow_dispatch/);
  assert.match(flow,/id-token: write/);
  assert.match(flow,/group: pack1-account-deletion-maintenance/);
  assert.match(flow,/account-deletion-maintenance-status/);
  assert.match(flow,/EVENT_NAME.*github\.event_name/s);
  assert.match(flow,/mode=attention-check/);
  assert.match(flow,/mode=manual-recovery/);
  assert.match(flow,/GITHUB_STEP_SUMMARY/);
});

test('deletion maintenance accepts only the named Neon trigger and keeps status OIDC-only',()=>{
  const source=fs.readFileSync('worker/growth-function.js','utf8');
  assert.match(source,/pack1-account-deletion-maintenance/);
  assert.match(source,/verifyNeonScheduleTrigger/);
  assert.match(source,/account-deletion-maintenance-status/);
  assert.match(source,/allowTrigger:false/);
  assert.match(source,/report_only:reportOnly/);
});

test('all Auth identity attachment surfaces share deletion serialization',()=>{
  for(const path of [
    'worker/account-session.mjs',
    'worker/account-credential-limits.mjs',
    'worker/account-deletion-verification.mjs',
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
  assert.match(testFlow,/secrets\.PACK1_ACCOUNT_DELETE_RESEND_API_KEY/);
  assert.match(testFlow,/DELETE_EMAIL_KEY.*re_/s);
  assert.match(testFlow,/pull_request\.head\.repo\.full_name == github\.repository/);
  const release=fs.readFileSync('.github/workflows/secure-auth-release.yml','utf8');
  assert.match(release,/PACK1_DELETION_ADMIN_EMAIL is missing or malformed/);
  assert.match(release,/PACK1_DELETION_ADMIN_PASSWORD is missing or too short/);
  assert.match(release,/PACK1_ACCOUNT_DELETE_RESEND_API_KEY is missing or malformed/);
});

test('manual controls redeploy the current release without migrations',()=>{
  const flow=fs.readFileSync('.github/workflows/account-deletion-controls.yml','utf8');
  assert.match(flow,/release_commit/);
  assert.match(flow,/git checkout --detach "\$commit"/);
  assert.doesNotMatch(flow,/psql|migrations\//);
  assert.match(flow,/PACK1_ACCOUNT_DELETION_ENABLED/);
  assert.match(flow,/PACK1_VERIFICATION_SWEEP_ENABLED/);
  assert.match(flow,/deletion_email_key_valid/);
  assert.match(flow,/hasOwnProperty\.call\(x,"deletion_email_configured"\)/);
  assert.match(flow,/git checkout --detach "\$commit"/);
  assert.doesNotMatch(flow,/tests\/.*deletion.*control|node scripts\/.*deletion.*health/i);
});


test('deletion email deployment policy stays production-only and smoke expectations are caller-owned',()=>{
  const deploy=fs.readFileSync('.github/workflows/deploy-functions.yml','utf8');
  const secure=fs.readFileSync('.github/workflows/secure-auth-release.yml','utf8');
  const releaseSmoke=fs.readFileSync('tests/release-functions-smoke.mjs','utf8');
  const refresh=fs.readFileSync('.github/workflows/refresh-powered-cube-images.yml','utf8');
  const traditional=fs.readFileSync('.github/workflows/traditional-puzzles.yml','utf8');
  assert.match(deploy,/--expect-deletion-email=false/);
  assert.match(deploy,/--expect-deletion-email=\$DELETION_EMAIL_EXPECTED/);
  assert.match(releaseSmoke,/expectedDeletionEmail=null/);
  assert.match(releaseSmoke,/expectedDeletionEmail!==null/);
  assert.doesNotMatch(releaseSmoke,/production.*deletion_email_configured|deletion_email_configured.*production/i);
  assert.doesNotMatch(refresh,/expect-deletion-email/);
  assert.doesNotMatch(traditional,/expect-deletion-email/);
  const devBlock=secure.slice(secure.indexOf('Deploy exact revision to development'),secure.indexOf('Verify activated Patreon secrets before production'));
  const prodBlock=secure.slice(secure.indexOf('Deploy the development-tested revision to production'));
  assert.doesNotMatch(devBlock,/--env "PACK1_ACCOUNT_DELETE_RESEND_API_KEY=/);
  assert.match(devBlock,/--expect-deletion-email=false/);
  assert.match(prodBlock,/--env "PACK1_ACCOUNT_DELETE_RESEND_API_KEY=/);
  assert.match(prodBlock,/--expect-deletion-email=true/);
});

test('emergency control can disable deletion without a usable mail key but refuses to leave deletion enabled without one',()=>{
  const flow=fs.readFileSync('.github/workflows/account-deletion-controls.yml','utf8');
  assert.match(flow,/deletion_email_key_valid=0/);
  assert.match(flow,/PACK1_ACCOUNT_DELETE_RESEND_API_KEY" == re_\*/);
  assert.match(flow,/\$delete" == 1 && "\$deletion_email_key_valid" != 1/);
  assert.match(flow,/if \[\[ "\$DELETION_EMAIL_EXPECTED" == 1 \]\]; then\s*extra\+\=\(--env "PACK1_ACCOUNT_DELETE_RESEND_API_KEY=/s);
  assert.match(flow,/hasOwnProperty\.call\(x,"deletion_email_configured"\)/);
  assert.match(flow,/git checkout --detach "\$commit"/);
  assert.doesNotMatch(flow,/node (?:tests|scripts)\/[^\n]*(?:deletion-email|deletion.*health)/i);
});

test('production code contains no deletion-code exposure switch or response field',()=>{
  const files=[
    'worker/account-deletion-verification.mjs',
    'worker/growth-function.js',
    'growth-api.mjs',
  ].map(path=>fs.readFileSync(path,'utf8')).join('\n');
  assert.doesNotMatch(files,/PACK1_[A-Z0-9_]*(?:EXPOSE|DEBUG|TEST)[A-Z0-9_]*DELETE[A-Z0-9_]*CODE|DELETE[A-Z0-9_]*CODE[A-Z0-9_]*(?:EXPOSE|DEBUG|TEST)/);
  const startSource=fs.readFileSync('worker/growth-function.js','utf8');
  const start=startSource.slice(startSource.indexOf('async function handleAccountDeleteVerificationStart'),startSource.indexOf('async function handleAccountDelete(request)'));
  assert.doesNotMatch(start,/json\([^\n]*\bcode\b/);
});

test('secure-auth release smoke is deletion-specific and corpus-independent',()=>{
  const flow=fs.readFileSync('.github/workflows/secure-auth-release.yml','utf8');
  const smoke=fs.readFileSync('tests/secure-auth-release-smoke.mjs','utf8');
  assert.equal((flow.match(/secure-auth-release-smoke\.mjs/g)||[]).length,2);
  assert.doesNotMatch(flow,/release-functions-smoke\.mjs/);
  assert.match(smoke,/\/health\?quick=1/);
  assert.match(smoke,/account_deletion_enabled/);
  assert.match(smoke,/verification_sweep_enabled/);
  assert.match(smoke,/deletion_email_configured/);
  assert.match(flow,/--expect-deletion-email=false/);
  assert.match(flow,/--expect-deletion-email=true/);
  assert.match(smoke,/\/v1\/account\/delete/);
  assert.match(smoke,/status:401/);
  assert.doesNotMatch(smoke,/daily_featured_sets|\/v1\/runs|corpus_version/);
});

test('secure-auth release smoke waits through stale Neon instances until the revision is stable',()=>{
  const smoke=fs.readFileSync('tests/secure-auth-release-smoke.mjs','utf8');
  assert.match(smoke,/async function waitForGrowthHealth/);
  assert.match(smoke,/pack1growth full health revision/);
  assert.match(smoke,/const stableWindow=30\*1000/);
  assert.match(smoke,/stableSince=0/);
  assert.match(smoke,/if\(await marker\(slug\)!==commit\)all=false/);
  assert.match(smoke,/else \{\s*stableSince=0;/);
  assert.match(smoke,/release markers did not stabilize on the reviewed revision/);
  assert.doesNotMatch(smoke,/stableUntil=Date\.now\(\)\+30\*1000/);
});

