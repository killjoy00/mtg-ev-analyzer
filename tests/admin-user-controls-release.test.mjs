import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {adminGrowthPath,adminPath} from '../edge/gateway.mjs';

test('admin user control migration keeps rename and audit atomic and deletion attribution durable',()=>{
  const migration=fs.readFileSync('migrations/0047_admin_user_account_controls.sql','utf8');
  assert.match(migration,/CREATE OR REPLACE FUNCTION pack1_admin_rename_public_username/);
  assert.match(migration,/pg_advisory_xact_lock\(hashtextextended\(p_target_auth_user_id::text,0\)\)/);
  assert.match(migration,/public_identity_hidden_at/);
  assert.match(migration,/account_deletion_operations WHERE auth_user_id=p_target_auth_user_id|account_deletion_operations existing WHERE existing\.auth_user_id=p_target_auth_user_id/);
  assert.match(migration,/UPDATE players[\s\S]*?display_name=p_display_name[\s\S]*?username_owned=p_username_owned[\s\S]*?INSERT INTO public_identity_moderation_actions/);
  assert.doesNotMatch(migration,/public_identity_terms_version\s*=/);
  assert.doesNotMatch(migration,/public_identity_terms_accepted_at\s*=/);
  assert.match(migration,/initiation_source/);
  assert.match(migration,/initiated_by_admin_auth_user_id/);
  assert.match(migration,/target_was_admin/);
  assert.match(migration,/start_status/);
  assert.match(migration,/admin_ack_required/);
});

test('Admin Users disables Admin-to-Admin deletion for non-Owners',()=>{
  const users=fs.readFileSync('admin/users.mjs','utf8');
  const shell=fs.readFileSync('admin/admin.mjs','utf8');
  assert.match(shell,/renderUsers\(root,authorizedRequest,authorizedGrowthRequest,access\.role\)/);
  assert.match(users,/user\.is_admin&&viewerRole!=='owner'/);
  assert.match(users,/Only the Owner may permanently delete another administrator account/);
  assert.match(shell,/Accept admin invitation/);
  assert.match(shell,/cancel-admin-invite/);
  assert.match(shell,/switch-admin-invite/);
});

test('gateway allows only the narrow admin username and deletion routes and methods',()=>{
  // Renames are served by growth, which sends the account notice; draft-run no longer accepts them.
  assert.equal(adminPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/username','PATCH'),false);
  assert.equal(adminGrowthPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/username','PATCH','production'),true);
  assert.equal(adminGrowthPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/username','POST','production'),false);
  assert.equal(adminGrowthPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/username','PATCH','preview'),false);
  assert.equal(adminGrowthPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/delete','POST','production'),true);
  assert.equal(adminGrowthPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/delete','GET','production'),false);
  assert.equal(adminGrowthPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/deletion','GET','production'),true);
  assert.equal(adminGrowthPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/delete','POST','preview'),false);
  assert.equal(adminGrowthPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/email','POST','production'),false);
  assert.equal(adminPath('/v1/admin/measurements','GET'),true);
  assert.equal(adminPath('/v1/admin/measurements/habits','GET'),true);
  assert.equal(adminPath('/v1/admin/measurements/reviews','GET'),true);
  assert.equal(adminPath('/v1/admin/measurements/habits','POST'),false);
  assert.equal(adminPath('/v1/admin/corpus/blb/detail','GET'),true);
  assert.equal(adminPath('/v1/admin/corpus/blb/detail','POST'),false);
});

test('Admin Users browser uses PATCH rename, typed destructive confirmation, status recovery and separate services',()=>{
  const users=fs.readFileSync('admin/users.mjs','utf8');
  const shell=fs.readFileSync('admin/admin.mjs','utf8');
  assert.match(users,/growthRequest\('\/v1\/admin\/users\/'\+encodeURIComponent\(id\)\+'\/username'.*'PATCH'/s);
  assert.doesNotMatch(users,/[^h]request\('\/v1\/admin\/users\/'\+encodeURIComponent\(id\)\+'\/username'/);
  assert.match(users,/name="notifyUser" value="yes" checked/);
  assert.equal((users.match(/notifyUser:values\.get\('notifyUser'\)==='yes'/g)||[]).length,2);
  assert.match(users,/Reason \(optional\), included in the email to the user/);
  assert.match(users,/confirm:String\(values\.get\('confirm'\)/);
  assert.match(users,/acknowledgeAdmin/);
  assert.match(users,/const deletionPromise=deletionStatus\(id\)\.then/);
  assert.match(users,/Checking deletion status/);
  assert.match(users,/Deletion status is temporarily unavailable/);
  assert.match(users,/deletionCommitted/);
  assert.match(users,/Refresh deletion status/);
  assert.match(users,/Apple subscriptions or Patreon memberships/);
  assert.match(users,/Public username/);
  assert.match(users,/previous_display_name/);
  assert.match(shell,/renderUsers\(root,authorizedRequest,authorizedGrowthRequest,access\.role\)/);
  assert.match(shell,/method=body\?'POST':'GET'/);
  const growth=fs.readFileSync('worker/growth-function.js','utf8');
  assert.match(growth,/deletionCommitted:true/);
  assert.match(growth,/operationId:error\.operationId/);
  assert.match(growth,/handleAdminUsernameChange\(request,query,url,\{readJson,adminAuthUserId:admin\.user_id\}\)/);
  assert.match(growth,/username\$\/i\.test\(url\.pathname\)\) \{\n\s*const admin=await adminAccountIdentity\(request,\{mutation:true\}\)/);
});

test('admin shell keeps timeout handling around body parsing and publishes only current core reports',()=>{
  const shell=fs.readFileSync('admin/admin.mjs','utf8');
  const requestBlock=shell.slice(shell.indexOf('async function requestAt'),shell.indexOf('const request='));
  assert.match(requestBlock,/try \{[\s\S]*await fetch\([\s\S]*await r\.json\(\)[\s\S]*\} catch\(error\)/);
  assert.match(requestBlock,/TimeoutError.*AbortError.*admin_timeout/s);
  const loadBlock=shell.slice(shell.indexOf('async function load()'),shell.indexOf("document.addEventListener('pack1:admin-signout'"));
  assert.match(loadBlock,/await verifyAdminContract\(\)/);
  assert.match(loadBlock,/nextReport=await authorizedRequest\([\s\S]*if\(loadId!==deferredLoad\)return;[\s\S]*report=nextReport/);
  assert.doesNotMatch(loadBlock,/report=await request\('\/v1\/admin\/measurements/);
  assert.match(shell,/x-pack1-admin-api-version/);
  assert.match(shell,/admin_release_mismatch/);
});

test('0047 is registered in secure auth and isolated backend release paths',()=>{
  const manifest=JSON.parse(fs.readFileSync('migrations/manifest.json','utf8'));
  for(const key of ['secure-auth-release','backend-gate-backlog','launch-load','launch-distributed'])
    assert.ok(manifest.release_paths[key].migrations.includes('0047_admin_user_account_controls.sql'),key);
  const secure=fs.readFileSync('.github/workflows/secure-auth-release.yml','utf8');
  assert.equal((secure.match(/migrations\/0047_admin_user_account_controls\.sql/g)||[]).length,2);
  const verify=fs.readFileSync('scripts/verify-neon-schema.mjs','utf8');
  assert.match(verify,/pack1_admin_rename_public_username/);
  assert.match(verify,/pack1_begin_admin_account_deletion/);
  assert.match(verify,/through 0047/);
});

test('completed deletion redacts rename and deletion free text while retaining operation/admin attribution',()=>{
  const deletion=fs.readFileSync('worker/account-deletion.mjs','utf8');
  assert.match(deletion,/previous_display_name=NULL/);
  assert.match(deletion,/new_display_name=NULL/);
  assert.match(deletion,/reason=CASE WHEN action='rename' THEN NULL ELSE reason END/);
  assert.match(deletion,/target_auth_user_id=\$2::uuid/);
  assert.match(deletion,/OR target_auth_user_id=\$2::uuid/);
  assert.match(deletion,/deletion_reason=NULL/);
  assert.match(deletion,/initiated_by_admin_auth_user_id/);
});

test('QA purge endpoint is available only through the authenticated production growth gateway',()=>{
  const route='/v1/admin/creator-challenges/11111111-1111-4111-8111-111111111111/purge';
  assert.equal(adminGrowthPath(route,'POST','production'),true);
  assert.equal(adminGrowthPath(route,'GET','production'),false);
  assert.equal(adminGrowthPath(route,'DELETE','production'),false);
  assert.equal(adminGrowthPath(route,'POST','preview'),false);
  assert.equal(adminPath(route,'POST'),false);
  assert.equal(adminGrowthPath('/v1/admin/creator-challenges/garbage/purge','POST','production'),false);
  const backend=fs.readFileSync('worker/creator-challenge-publish.mjs','utf8');
  assert.match(backend,/handleCreatorChallengePurge[\s\S]*requireCreatorAdmin\(request,\{query,allowedOrigins,csrf:true\}\)/);
  assert.match(backend,/if\(input\?\.confirm!==row\.slug\)/);
});
