import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const unit = readFileSync('.github/workflows/test.yml','utf8');
const browser = readFileSync('.github/workflows/e2e.yml','utf8');
const mobile = readFileSync('.github/workflows/mobile.yml','utf8');

for (const [name, flow] of [['test', unit], ['browser', browser], ['mobile', mobile]]) {
  test(name + ' ignores PR metadata edits while keeping cancellation', () => {
    assert.match(flow, /pull_request:\n(?:[\s\S]*?)types: \[opened, synchronize, reopened\]/);
    assert.doesNotMatch(flow, /types: \[[^\]]*edited/);
    assert.match(flow, /cancel-in-progress: true/);
  });
}

test('required test fast path keeps the account-deletion secret guard', () => {
  assert.match(unit, /Verify account-deletion release secrets are provisioned/);
  assert.match(unit, /if: github\.event_name == 'workflow_dispatch' \|\| \(github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository\)/);
});

test('signed and publishing mobile jobs remain unreachable from pull-request execution and never touch the unsigned Gradle cache', () => {
  const android = readFileSync('.github/workflows/android-production-bundle.yml','utf8');
  const internal = readFileSync('.github/workflows/android-internal-testing.yml','utf8');
  const ios = readFileSync('.github/workflows/ios-testflight.yml','utf8');

  const signedAndroid = android.split('  signed-bundle:')[1] ?? '';
  const publishAndroid = internal.split('  internal-release:')[1] ?? '';
  const publishIos = ios.split('  testflight:')[1] ?? '';

  for (const flow of [signedAndroid, publishAndroid, publishIos]) {
    assert.match(flow, /github\.ref == 'refs\/heads\/main'/);
    assert.doesNotMatch(flow, /actions\/cache\/(?:restore|save)@/);
  }
  assert.match(signedAndroid, /environment: pack-one-mobile-release/);
  assert.match(publishAndroid, /environment: pack-one-mobile-release/);
  assert.match(publishIos, /environment: pack-one-mobile-release/);
});

test('unsigned Gradle cache is main-seeded, PR-read-only, and excludes signing material', () => {
  const mainRc = readFileSync('.github/workflows/mobile-exact-main-rc.yml','utf8');
  const android = readFileSync('.github/workflows/android-production-bundle.yml','utf8');
  assert.match(mainRc, /actions\/cache\/save@v4/);
  assert.match(mainRc, /Verify unsigned Gradle cache contains no signing material/);
  assert.match(mainRc, /Log unsigned Gradle cache size/);
  assert.match(android, /actions\/cache\/restore@v4/);
  assert.doesNotMatch(android.split('  signed-bundle:')[1] ?? '', /actions\/cache\/(?:restore|save)@/);
});

test('exact-main RC treats main movement as stale evidence, not a build failure', () => {
  const mainRc = readFileSync('.github/workflows/mobile-exact-main-rc.yml','utf8');
  assert.match(mainRc, /id: freshness/);
  assert.match(mainRc, /echo "current=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(mainRc, /if: steps\.freshness\.outputs\.current == 'true'/);
});

test('backend Neon job is wired fail-closed behind the fork-safety guard', () => {
  const backend = readFileSync('.github/workflows/backend-gate.yml','utf8');
  assert.match(backend, /always\(\).*github\.event\.pull_request\.head\.repo\.full_name == github\.repository.*needs\.precheck\.result != 'success'.*needs\.precheck\.outputs\.needs_neon != 'false'/);
  assert.match(backend, /scripts\/backend-gate-scope\.mjs/);
  assert.match(backend, /scripts\/backend-gate-map\.json/);
  assert.match(backend, /tests\/backend-gate-scope\.test\.mjs/);
});
