import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('App Store 1.1 version creation is guarded and cannot submit review or release publicly', () => {
  const helper = readFileSync(new URL('../.github/scripts/app-store-ensure-version.mjs', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../.github/workflows/app-store-version.yml', import.meta.url), 'utf8');
  const request = JSON.parse(readFileSync(new URL('../.github/app-store-version-request.json', import.meta.url), 'utf8'));

  assert.equal(request.operation, 'ensure-app-store-version');
  assert.equal(request.version, '1.1');
  assert.match(helper, /versionString !== '1\.1'/);
  assert.match(helper, /'\/v1\/appStoreVersions'/);
  assert.match(helper, /method: 'POST'/);
  assert.match(helper, /releaseType: 'MANUAL'/);
  assert.match(helper, /PREPARE_FOR_SUBMISSION/);
  assert.match(helper, /READY_FOR_REVIEW/);
  assert.match(helper, /reviewSubmissionCreated: false/);
  assert.match(helper, /publicReleaseCreated: false/);
  assert.doesNotMatch(helper, /reviewSubmissions/);
  assert.doesNotMatch(helper, /appStoreVersionSubmissions/);

  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /pack-one-mobile-release/);
  assert.match(workflow, /Require current approved main revision/);
  assert.match(workflow, /app-store-ensure-version\.mjs/);
});
