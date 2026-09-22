import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('email verification QA acceptance is pinned to a fresh disposable production child and deletes it',()=>{
  const source=fs.readFileSync(new URL('../scripts/auth-verification-qa-acceptance-v2.mjs',import.meta.url),'utf8');
  assert.match(source,/BRANCH='br-long-bar-ayqfnpn4'/);
  assert.match(source,/PROD_BRANCH='br-orange-feather-ayps8kep'/);
  assert.match(source,/assert\(BRANCH!==PROD_BRANCH&&BRANCH!==DEV_BRANCH/);
  assert.match(source,/meta\.parent_id===PROD_BRANCH/);
  assert.match(source,/meta\.default===false&&meta\.protected===false&&Boolean\(meta\.expires_at\)/);
  assert.match(source,/PACK1_QA_AUTO_VERIFY_AFTER_SEND:'1'/);
  assert.match(source,/attempt<80/);
  assert.match(source,/email_verification_method:'link'/);
  assert.match(source,/require_email_verification:true/);
  assert.match(source,/AUTH_VERIFY_QA_LEGACY_AFTER_POLICY/);
  assert.match(source,/AUTH_VERIFY_QA_SIGNIN_AFTER/);
  assert.match(source,/waitVerificationDelivery\(workerBase\)/);
  assert.match(source,/for\(const delay of \[2000,5000,10000\]\)/);
  assert.doesNotMatch(source,/attempt<30/);
  assert.match(source,/link_type==='email-verification'/);
  assert.match(source,/link_type==='forget-password'/);
  assert.match(source,/qa_auto_verified===true/);
  assert.match(source,/emailUpdate\(neon,originalEmail\)/);
  assert.match(source,/webhookUpdate\(neon,originalWebhook\)/);
  assert.match(source,/AUTH_VERIFY_QA_WORKER_CLEANED true/);
  assert.match(source,/deleteBranch\(\)/);
  assert.match(source,/AUTH_VERIFY_QA_BRANCH_CLEANED true/);
  assert.doesNotMatch(source,/neon-auth','user','delete/);
});

test('QA verification workflow uses the v2 runner and remains main-only',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/auth-verification-qa.yml',import.meta.url),'utf8');
  assert.match(workflow,/branches: \[main\]/);
  assert.match(workflow,/auth-verification-qa-request\.json/);
  assert.match(workflow,/scripts\/auth-verification-qa-acceptance-v2\.mjs/);
  assert.doesNotMatch(workflow,/deploy-production|secure-auth-release|PROD_BRANCH/);
});
