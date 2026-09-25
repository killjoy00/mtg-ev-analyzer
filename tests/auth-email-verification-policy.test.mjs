import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PROJECT,
  PROD_BRANCH,
  PROD_WORKER,
  safeEmailConfig,
  validateRequest,
  requiredTarget,
} from '../scripts/auth-email-verification-policy.mjs';

test('Phase 2 request is fixed to required verification and an exact Worker release',()=>{
  const good={
    operation:'enable-required-email-verification',
    reason:'Part of #246 Phase 2 rollout.',
    required_worker_commit:'a'.repeat(40),
  };
  assert.equal(validateRequest(good),good);
  assert.throws(()=>validateRequest({...good,operation:'enable-optional-email-verification'}),/operation/);
  assert.throws(()=>validateRequest({...good,required_worker_commit:'abc'}),/Worker commit/);
  assert.throws(()=>validateRequest({...good,extra:true}),/keys/);
});

test('Phase 2 target requires link verification for authentication',()=>{
  const original=safeEmailConfig({
    enabled:true,
    email_verification_method:'link',
    require_email_verification:false,
    auto_sign_in_after_verification:true,
    send_verification_email_on_sign_up:true,
    send_verification_email_on_sign_in:false,
    disable_sign_up:false,
  });
  assert.deepEqual(requiredTarget(original),{
    enabled:true,
    email_verification_method:'link',
    require_email_verification:true,
    auto_sign_in_after_verification:true,
    send_verification_email_on_sign_up:true,
    send_verification_email_on_sign_in:false,
    disable_sign_up:false,
  });
});

test('production Phase 2 controller is fixed-target, migration-gated and reversible',()=>{
  assert.equal(PROJECT,'patient-shadow-91417882');
  assert.equal(PROD_BRANCH,'br-orange-feather-ayps8kep');
  assert.equal(PROD_WORKER,'https://pack1-authhook.killjoy00.workers.dev');
  const source=fs.readFileSync(new URL('../scripts/auth-email-verification-policy.mjs',import.meta.url),'utf8');
  const workflow=fs.readFileSync(new URL('../.github/workflows/auth-email-verification-policy.yml',import.meta.url),'utf8');
  const request=JSON.parse(fs.readFileSync(new URL('../.github/auth-email-verification-policy-request.json',import.meta.url),'utf8'));

  assert.equal(request.operation,'enable-required-email-verification');
  assert.equal(request.required_worker_commit,'d7dbaf89f391fd82b4f344285533aaee31f0fb0f');
  assert.match(source,/release marker mismatch/);
  assert.match(source,/require_email_verification:true/);
  assert.match(source,/send_verification_email_on_sign_up:true/);
  assert.match(source,/email_verification_method:'link'/);
  assert.match(source,/Production email\/password policy no longer matches the reviewed Phase 1 baseline/);
  assert.match(source,/allowLocalhost\(\)===false/);
  assert.match(source,/smtp\.resend\.com/);
  assert.match(source,/accounts@packone\.pro/);
  assert.match(source,/Number\(users\.credential_count\)===4/);
  assert.match(source,/Number\(users\.verified_count\)===4&&Number\(users\.unverified_count\)===0/);
  assert.match(source,/updateEmailConfig\(original\)/);
  assert.match(source,/automatic email-policy rollback/);
  assert.doesNotMatch(source,/\bUPDATE\s+neon_auth|\bDELETE\s+FROM\s+neon_auth|\bINSERT\s+INTO\s+neon_auth/i);

  assert.match(workflow,/branches: \[main\]/);
  assert.match(workflow,/secrets\.NEON_API_KEY/);
  assert.match(workflow,/neon@5\.0\.0/);
  assert.match(workflow,/auth-email-verification-policy\.mjs production/);
  assert.doesNotMatch(workflow,/pull_request:/);
});
