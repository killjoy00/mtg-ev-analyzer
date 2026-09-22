import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseAuthWebhookRequest} from '../scripts/auth-webhook-request.mjs';

const commit='a'.repeat(40);

test('QA Auth webhook release request accepts only fixed reviewed operations',()=>{
  assert.deepEqual(parseAuthWebhookRequest({operation:'idle',reason:'rest'}),{operation:'idle',commit:''});
  assert.deepEqual(parseAuthWebhookRequest({operation:'check-secret',reason:'preflight'}),{operation:'check-secret',commit:''});
  assert.deepEqual(parseAuthWebhookRequest({operation:'deploy-qa',reason:'qa',commit}),{operation:'deploy-qa',commit});
  assert.deepEqual(parseAuthWebhookRequest({operation:'deploy-qa-fail',reason:'retry probe',commit}),{operation:'deploy-qa-fail',commit});
  assert.deepEqual(parseAuthWebhookRequest({operation:'deploy-qa-retry',reason:'dedupe probe',commit}),{operation:'deploy-qa-retry',commit});
  assert.deepEqual(parseAuthWebhookRequest({operation:'qa-acceptance',reason:'happy path'}),{operation:'qa-acceptance',commit:''});
  assert.deepEqual(parseAuthWebhookRequest({operation:'qa-failure-check',reason:'failure retry'}),{operation:'qa-failure-check',commit:''});
  assert.deepEqual(parseAuthWebhookRequest({operation:'qa-retry-check',reason:'dedupe retry'}),{operation:'qa-retry-check',commit:''});
  assert.deepEqual(parseAuthWebhookRequest({operation:'delete-qa',reason:'cleanup'}),{operation:'delete-qa',commit:''});

  for(const value of [
    {operation:'deploy-production',reason:'no'},
    {operation:'deploy-qa',reason:'missing commit'},
    {operation:'deploy-qa',reason:'bad commit',commit:'abc'},
    {operation:'delete-qa',reason:'x',commit},
    {operation:'deploy-qa',reason:'x',commit,url:'https://evil.test'},
    {operation:'deploy-qa',reason:'x',commit,sender:'evil@example.com'},
    null,
  ])assert.throws(()=>parseAuthWebhookRequest(value),/Invalid Auth webhook request/);
});

test('QA Auth webhook workflow uses dedicated secrets and exposes no production deploy path',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/auth-webhook-release.yml',import.meta.url),'utf8');
  assert.match(workflow,/PACK1_AUTH_RESEND_API_KEY: \$\{\{ secrets\.PACK1_AUTH_RESEND_API_KEY \}\}/);
  assert.match(workflow,/CLOUDFLARE_EDGE_TOKEN: \$\{\{ secrets\.CLOUDFLARE_EDGE_TOKEN \}\}/);
  assert.match(workflow,/auth-webhook-control\.mjs deploy-qa/);
  assert.match(workflow,/auth-webhook-control\.mjs deploy-qa-fail/);
  assert.match(workflow,/auth-webhook-control\.mjs deploy-qa-retry/);
  assert.match(workflow,/auth-webhook-qa-acceptance\.mjs happy/);
  assert.match(workflow,/auth-webhook-qa-acceptance\.mjs failure/);
  assert.match(workflow,/auth-webhook-qa-acceptance\.mjs retry/);
  assert.match(workflow,/auth-webhook-control\.mjs delete-qa/);
  assert.doesNotMatch(workflow,/auth-webhook-control\.mjs deploy-production/);
});

test('Auth webhook deployment controller pins service identity, Auth bases, senders and reset origins',()=>{
  const source=fs.readFileSync(new URL('../scripts/auth-webhook-control.mjs',import.meta.url),'utf8');
  assert.match(source,/worker:'pack1-authhook-qa'/);
  assert.match(source,/worker:'pack1-authhook'/);
  assert.match(source,/ep-lively-river-b5tky50l\.neonauth/);
  assert.match(source,/ep-hidden-bonus-ayfmcpys\.neonauth/);
  assert.match(source,/Pack One QA <qa-accounts@packone\.pro>/);
  assert.match(source,/Pack One <accounts@packone\.pro>/);
  assert.match(source,/resetOrigin:'http:\/\/localhost:4173'/);
  assert.match(source,/resetOrigin:'https:\/\/packone\.pro'/);
  assert.match(source,/PACK1_FORCE_RETRY_AFTER_SEND/);
  assert.match(source,/observability:\{enabled:target==='production'\}/);
  assert.match(source,/wrangler.*secret.*bulk/s);
  assert.match(source,/async function waitForHealth/);
  assert.match(source,/attempt<=20/);
  assert.match(source,/release marker mismatch/);
});


test('QA recovery acceptance runner exposes no recovery secrets',()=>{
  const source=fs.readFileSync(new URL('../scripts/auth-webhook-qa-acceptance.mjs',import.meta.url),'utf8');
  assert.match(source,/QA_ACCEPTANCE/);
  assert.match(source,/QA_FAILURE_ACCEPTANCE/);
  assert.match(source,/QA_RETRY_ACCEPTANCE/);
  assert.match(source,/unexpected output/);
  assert.doesNotMatch(source,/console\.log\([^\n]*(token|password|signature|cookie)/i);
});


test('secure Auth release deploys the production recovery Worker from the exact reviewed revision',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/secure-auth-release.yml',import.meta.url),'utf8');
  assert.match(workflow,/PACK1_AUTH_RESEND_API_KEY: \$\{\{ secrets\.PACK1_AUTH_RESEND_API_KEY \}\}/);
  assert.match(workflow,/PACK1_AUTH_RESEND_API_KEY is missing or malformed/);
  assert.match(workflow,/name: Deploy dedicated production recovery webhook Worker/);
  assert.match(workflow,/RELEASE_COMMIT: \$\{\{ github\.sha \}\}/);
  assert.match(workflow,/auth-webhook-control\.mjs deploy-production/);
});


test('production recovery smoke is main-only, fixed-target and secret-free',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/production-recovery-smoke.yml',import.meta.url),'utf8');
  const source=fs.readFileSync(new URL('../scripts/auth-webhook-production-smoke.mjs',import.meta.url),'utf8');
  assert.match(workflow,/branches: \[main\]/);
  assert.match(workflow,/pack1-authhook\.killjoy00\.workers\.dev\/health\?quick=1/);
  assert.match(workflow,/auth-webhook-production-smoke\.mjs/);
  assert.doesNotMatch(workflow,/secrets\./);
  assert.match(source,/ep-hidden-bonus-ayfmcpys\.neonauth/);
  assert.match(source,/https:\/\/packone\.pro/);
  assert.match(source,/delivered@resend\.dev/);
  assert.doesNotMatch(source,/console\.log\([^\n]*(password|token|signature|cookie)/i);
});


test('production Auth webhook config workflow is fixed to recovery-only subscription',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/production-auth-webhook-config.yml',import.meta.url),'utf8');
  assert.match(workflow,/patient-shadow-91417882/);
  assert.match(workflow,/br-orange-feather-ayps8kep/);
  assert.match(workflow,/pack1-authhook\.killjoy00\.workers\.dev\/webhook/);
  assert.match(workflow,/enabled_events:\['send\.magic_link'\]/);
  assert.match(workflow,/timeout_seconds:5/);
  assert.match(workflow,/secrets\.NEON_API_KEY/);
  assert.match(workflow,/ensure-enabled','disable/);
  assert.match(workflow,/enabled:operation==='ensure-enabled'/);
  assert.match(workflow,/steps\.request\.outputs\.operation == 'ensure-enabled'/);
  assert.doesNotMatch(workflow,/send\.otp/);
});
