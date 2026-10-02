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

test('gateway allows only the narrow admin username and deletion routes and methods',()=>{
  assert.equal(adminPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/username','PATCH'),true);
  assert.equal(adminPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/username','POST'),false);
  assert.equal(adminGrowthPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/delete','POST','production'),true);
  assert.equal(adminGrowthPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/delete','GET','production'),false);
  assert.equal(adminGrowthPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/deletion','GET','production'),true);
  assert.equal(adminGrowthPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/delete','POST','preview'),false);
  assert.equal(adminGrowthPath('/v1/admin/users/22222222-2222-4222-8222-222222222222/email','POST','production'),false);
});

test('Admin Users browser uses PATCH rename, typed destructive confirmation, status recovery and separate services',()=>{
  const users=fs.readFileSync('admin/users.mjs','utf8');
  const shell=fs.readFileSync('admin/admin.mjs','utf8');
  assert.match(users,/\/username'.*'PATCH'/s);
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
  assert.match(shell,/renderUsers\(root,request,growthRequest\)/);
  assert.match(shell,/method=body\?'POST':'GET'/);
  const growth=fs.readFileSync('worker/growth-function.js','utf8');
  assert.match(growth,/deletionCommitted:true/);
  assert.match(growth,/operationId:error\.operationId/);
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
