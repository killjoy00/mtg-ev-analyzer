import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const helperPath = fileURLToPath(new URL('../.github/scripts/app-store-ensure-version.mjs', import.meta.url));
const workflow = readFileSync(new URL('../.github/workflows/app-store-version.yml', import.meta.url), 'utf8');
const helper = readFileSync(helperPath, 'utf8');
const request = JSON.parse(readFileSync(new URL('../.github/app-store-version-request.json', import.meta.url), 'utf8'));
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

function resource(id = 'version-1', overrides = {}) {
  return {
    type: 'appStoreVersions',
    id,
    attributes: {
      platform: 'IOS',
      versionString: '1.1',
      appVersionState: 'PREPARE_FOR_SUBMISSION',
      releaseType: 'MANUAL',
      createdDate: '2026-10-07T00:00:00Z',
      ...overrides,
    },
  };
}

const app = () => ({ data: { type: 'apps', id: '6814318676', attributes: { bundleId: 'pro.packone.app' } } });
const list = data => ({ data, links: { next: null } });

function runScript(sequence) {
  const dir = mkdtempSync(join(tmpdir(), 'packone-app-store-version-'));
  const evidencePath = join(dir, 'evidence.json');
  const callsPath = join(dir, 'calls.jsonl');
  const preloadPath = join(dir, 'mock-fetch.mjs');
  const preload = [
    "import { appendFileSync } from 'node:fs';",
    "const sequence = JSON.parse(process.env.MOCK_ASC_SEQUENCE);",
    "globalThis.fetch = async (url, options = {}) => {",
    "  const method = options.method || 'GET';",
    "  const call = { url, method, body: options.body ? JSON.parse(options.body) : null };",
    "  appendFileSync(process.env.MOCK_ASC_CALLS, JSON.stringify(call) + '\\\\n');",
    "  if (!sequence.length) throw new Error('Unexpected fetch: ' + method + ' ' + url);",
    "  const next = sequence.shift();",
    "  if (next.throw) throw new TypeError(next.throw);",
    "  const status = next.status ?? 200;",
    "  return { status, ok: status >= 200 && status < 300, async text() {",
    "    if (Object.prototype.hasOwnProperty.call(next, 'raw')) return next.raw;",
    "    return JSON.stringify(next.body ?? null);",
    "  }};",
    "};",
  ].join('\n');
  writeFileSync(preloadPath, preload);
  const env = {
    ...process.env,
    ASC_ISSUER_ID: 'issuer-id',
    ASC_KEY_ID: 'key-id',
    ASC_PRIVATE_KEY: privateKeyPem,
    PACKONE_ASC_VERSION_OUTPUT: evidencePath,
    MOCK_ASC_SEQUENCE: JSON.stringify(sequence),
    MOCK_ASC_CALLS: callsPath,
    NODE_OPTIONS: ((process.env.NODE_OPTIONS || '') + ' --import=' + preloadPath).trim(),
  };
  const result = spawnSync(process.execPath, [helperPath, '1.1'], { env, encoding: 'utf8' });
  const evidence = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, 'utf8')) : null;
  const calls = existsSync(callsPath)
    ? readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    : [];
  rmSync(dir, { recursive: true, force: true });
  return { ...result, evidence, calls };
}

test('App Store 1.1 operation stays pinned and workflow scopes credentials to the provider step', () => {
  assert.equal(request.operation, 'ensure-app-store-version');
  assert.equal(request.version, '1.1');
  assert.match(helper, /versionString !== '1\.1'/);
  assert.match(helper, /filter%5Bplatform%5D=IOS/);
  assert.match(helper, /filter%5BversionString%5D=/);
  assert.match(helper, /releaseType: 'MANUAL'/);
  assert.doesNotMatch(helper, /reviewSubmissions|appStoreVersionSubmissions|appStoreVersionReleaseRequests/);
  assert.match(workflow, /branches: \[main\]/);
  assert.ok(workflow.indexOf('actions/setup-node@v4') < workflow.indexOf('Require current approved main revision'));
  const beforeSteps = workflow.slice(0, workflow.indexOf('steps:'));
  assert.doesNotMatch(beforeSteps, /ASC_KEY_ID|ASC_ISSUER_ID|ASC_PRIVATE_KEY/);
  assert.match(workflow, /if-no-files-found: error/);
});

test('existing manual version performs no mutation and writes success evidence', () => {
  const existing = resource();
  const run = runScript([
    { body: app() },
    { body: list([existing]) },
    { body: { data: existing } },
  ]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.evidence.created, false);
  assert.equal(run.evidence.creationOutcome, 'existing');
  assert.equal(run.calls.filter(call => ['POST', 'PATCH'].includes(call.method)).length, 0);
});

test('unsafe state fails before PATCH and retains evidence', () => {
  const listed = resource('unsafe', { releaseType: 'AUTOMATIC' });
  const unsafe = resource('unsafe', { releaseType: 'AUTOMATIC', appVersionState: 'WAITING_FOR_REVIEW' });
  const run = runScript([
    { body: app() },
    { body: list([listed]) },
    { body: { data: unsafe } },
  ]);
  assert.notEqual(run.status, 0);
  assert.equal(run.calls.some(call => call.method === 'PATCH'), false);
  assert.equal(run.evidence.appVersionState, 'WAITING_FOR_REVIEW');
  assert.match(run.evidence.error, /not safely editable/);
});

test('creation includes MANUAL and existing non-manual version PATCHes only after identity verification', () => {
  const created = resource('created');
  const createRun = runScript([
    { body: app() },
    { body: list([]) },
    { body: { data: created } },
    { body: { data: created } },
  ]);
  assert.equal(createRun.status, 0, createRun.stderr);
  const post = createRun.calls.find(call => call.method === 'POST');
  assert.equal(post.body.data.attributes.releaseType, 'MANUAL');
  assert.equal(createRun.evidence.created, true);

  const automatic = resource('patch-me', { releaseType: 'AUTOMATIC' });
  const manual = resource('patch-me');
  const patchRun = runScript([
    { body: app() },
    { body: list([automatic]) },
    { body: { data: automatic } },
    { body: { data: manual } },
    { body: { data: manual } },
  ]);
  assert.equal(patchRun.status, 0, patchRun.stderr);
  assert.equal(patchRun.calls.filter(call => call.method === 'PATCH').length, 1);

  const wrong = resource('wrong', { releaseType: 'AUTOMATIC', versionString: '1.0' });
  const mismatchRun = runScript([
    { body: app() },
    { body: list([resource('wrong', { releaseType: 'AUTOMATIC' })]) },
    { body: { data: wrong } },
  ]);
  assert.notEqual(mismatchRun.status, 0);
  assert.equal(mismatchRun.calls.some(call => call.method === 'PATCH'), false);
});

test('provider failure persists structured provider evidence', () => {
  const run = runScript([
    { status: 503, body: { errors: [{ status: '503', detail: 'unavailable' }] } },
  ]);
  assert.notEqual(run.status, 0);
  assert.equal(run.evidence.providerStatus, 503);
  assert.deepEqual(run.evidence.providerError, { errors: [{ status: '503', detail: 'unavailable' }] });
  assert.equal(run.evidence.reviewSubmissionCreated, false);
  assert.equal(run.evidence.publicReleaseCreated, false);
});

test('ambiguous POST outcome reconciles read-only without a second POST and stays unknown', () => {
  const reconciled = resource('reconciled');
  const run = runScript([
    { body: app() },
    { body: list([]) },
    { status: 409, body: { errors: [{ status: '409', detail: 'already exists' }] } },
    { body: list([reconciled]) },
    { body: { data: reconciled } },
  ]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(run.evidence.created, null);
  assert.equal(run.evidence.creationOutcome, 'unknown_reconciled');
  assert.equal(run.evidence.creationProviderStatus, 409);
});

test('malformed successful responses fail closed without blind writes', () => {
  const malformedList = runScript([
    { body: app() },
    { body: { data: {} } },
  ]);
  assert.notEqual(malformedList.status, 0);
  assert.equal(malformedList.calls.some(call => call.method === 'POST'), false);
  assert.match(malformedList.evidence.error, /Malformed App Store version list/);

  const malformedCreate = runScript([
    { body: app() },
    { body: list([]) },
    { body: { data: {} } },
  ]);
  assert.notEqual(malformedCreate.status, 0);
  assert.equal(malformedCreate.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(malformedCreate.calls.length, 3);
  assert.equal(malformedCreate.evidence.created, null);
  assert.match(malformedCreate.evidence.error, /response is malformed/);
});
