import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('email verification QA acceptance is pinned to a disposable production child and restores state',()=>{
  const source=fs.readFileSync(new URL('../scripts/auth-verification-qa-acceptance.mjs',import.meta.url),'utf8');
  assert.match(source,/BRANCH='br-old-surf-ayfjob8u'/);
  assert.match(source,/PROD_BRANCH='br-orange-feather-ayps8kep'/);
  assert.match(source,/assert\(BRANCH!==PROD_BRANCH&&BRANCH!==DEV_BRANCH/);
  assert.match(source,/meta\.default===false&&meta\.protected===false/);
  assert.match(source,/Boolean\(meta\.expires_at\)/);
  assert.match(source,/PACK1_QA_AUTO_VERIFY_AFTER_SEND:'1'/);
  assert.match(source,/email_verification_method:'link'/);
  assert.match(source,/require_email_verification:true/);
  assert.match(source,/AUTH_VERIFY_QA_SIGNIN_AFTER/);
  assert.match(source,/link_type==='email-verification'/);
  assert.match(source,/link_type==='forget-password'/);
  assert.match(source,/emailUpdate\(neon,originalEmail\)/);
  assert.match(source,/webhookUpdate\(neon,originalWebhook\)/);
  assert.match(source,/neon-auth','user','delete'/);
  assert.match(source,/AUTH_VERIFY_QA_WORKER_CLEANED true/);
  assert.doesNotMatch(source,/br-orange-feather-ayps8kep[^\n]*emailUpdate/);
});

test('QA verification workflow is reviewed-main-only and does not deploy production',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/auth-verification-qa.yml',import.meta.url),'utf8');
  assert.match(workflow,/branches: \[main\]/);
  assert.match(workflow,/auth-verification-qa-request\.json/);
  assert.match(workflow,/scripts\/auth-verification-qa-acceptance\.mjs/);
  assert.doesNotMatch(workflow,/deploy-production|secure-auth-release|PROD_BRANCH/);
});
