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
