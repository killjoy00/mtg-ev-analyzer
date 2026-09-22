import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('email verification QA acceptance is pinned to a fresh disposable production child and deletes it',()=>{
  const source=fs.readFileSync(new URL('../scripts/auth-verification-qa-acceptance-v2.mjs',import.meta.url),'utf8');
  // The branch moves every attempt, so pin the mechanism and the fences rather
  // than the value: a retry changes the reviewed request file, not this test.
  const request=JSON.parse(fs.readFileSync(new URL('../.github/auth-verification-qa-request.json',import.meta.url),'utf8'));
  const workflow=fs.readFileSync(new URL('../.github/workflows/auth-verification-qa.yml',import.meta.url),'utf8');
  assert.deepEqual(Object.keys(request).sort(),['authBase','branch','operation','reason']);
  assert.match(request.branch,/^br-[a-z0-9-]{6,60}$/);
  assert.ok(!['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b'].includes(request.branch));
  assert.match(request.authBase,/^https:\/\/[a-z0-9-]+\.neonauth\.[a-z0-9.-]+\.neon\.tech\/pack1\/auth$/);
  assert.match(workflow,/\['authBase','branch','operation','reason'\]/);
  assert.match(workflow,/QA verification must not target production or development/);
  assert.match(source,/const BRANCH=String\(REQUEST\.branch\|\|''\)/);
  assert.match(source,/const AUTH_BASE=String\(REQUEST\.authBase\|\|''\)/);
  assert.match(source,/\/\^br-\[a-z0-9-\]\{6,60\}\$\/\.test\(BRANCH\)/);
  assert.match(source,/authBase\.pathname==='\/pack1\/auth'/);
  assert.match(source,/PROD_BRANCH='br-orange-feather-ayps8kep'/);
  assert.match(source,/assert\(BRANCH!==PROD_BRANCH&&BRANCH!==DEV_BRANCH/);
  assert.match(source,/meta\.parent_id===PROD_BRANCH/);
  assert.match(source,/meta\.default===false&&meta\.protected===false&&Boolean\(meta\.expires_at\)/);
  assert.match(source,/attempt<80/);
  assert.match(source,/email_verification_method:'link'/);
  assert.match(source,/require_email_verification:true/);
  assert.match(source,/AUTH_VERIFY_QA_LEGACY_AFTER_POLICY/);
  assert.match(source,/AUTH_VERIFY_QA_SIGNIN_AFTER/);
  assert.match(source,/waitVerificationDelivery\(workerBase\)/);
  assert.match(source,/randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(source,/PACK1_QA_EVIDENCE_KEY:qaEvidenceKey/);
  assert.match(source,/waitPendingVerificationLink\(workerBase,qaEvidenceKey\)/);
  assert.match(source,/\/qa\/pending-verification/);
  assert.match(source,/authorization:'Bearer '\+evidenceKey/);
  assert.match(source,/clickDeliveredVerification\(deliveredLink\)/);
  assert.match(source,/Delivered verification link was rejected/);
  assert.doesNotMatch(source,/api\.resend\.com/);
  assert.doesNotMatch(source,/verificationEmailIds|waitDeliveredVerificationLink/);
  assert.match(source,/for\(const delay of \[2000,5000,10000\]\)/);
  assert.doesNotMatch(source,/attempt<30/);
  assert.match(source,/link_type==='email-verification'/);
  assert.match(source,/link_type==='forget-password'/);
  assert.match(source,/console\.log\('::add-mask::'\+qaEvidenceKey\)/);
  assert.doesNotMatch(source,/AUTH_VERIFY_QA[^\n]*(deliveredLink|qaEvidenceKey)/);
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
