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

test('required checks share one classifier and keep branch-protection job names stable', () => {
  assert.match(unit, /name: test/);
  assert.match(unit, /jobs:\n  test:/);
  assert.match(browser, /name: e2e/);
  assert.match(browser, /jobs:\n  browser:/);
  for (const flow of [unit, browser]) assert.match(flow, /node scripts\/ci-change-scope\.mjs/);
  assert.match(unit, /Verify selected validation completed/);
  assert.match(browser, /Verify selected browser validation completed/);
});

test('generic required checks do not provision release-only account deletion secrets', () => {
  assert.doesNotMatch(unit, /PACK1_ACCOUNT_DELETE_RESEND_API_KEY|Verify account-deletion release secrets are provisioned/);
  const release = readFileSync('.github/workflows/secure-auth-release.yml','utf8');
  const controls = readFileSync('.github/workflows/account-deletion-controls.yml','utf8');
  assert.match(release, /PACK1_ACCOUNT_DELETE_RESEND_API_KEY/);
  assert.match(controls, /PACK1_ACCOUNT_DELETE_RESEND_API_KEY/);
});

test('scheduled full coverage remains while publication and ordinary paths stay replay-light', () => {
  assert.match(unit, /schedule:\n\s+- cron:/);
  assert.match(browser, /schedule:\n\s+- cron:/);
  assert.match(unit, /profile == 'publication'/);
  assert.match(browser, /browser_mode == 'publication'/);
  assert.match(browser, /browser_mode == 'selected'/);
  assert.doesNotMatch(browser, /hydrate-replay-shards/);
  assert.match(unit, /Hydrate replay shards from R2/);
  assert.match(unit, /Run application tests without replay corpus hydration/);
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
  assert.match(backend, /!cancelled\(\).*github\.event\.pull_request\.head\.repo\.full_name == github\.repository.*needs\.precheck\.result != 'success'.*needs\.precheck\.outputs\.needs_neon != 'false'/);
  assert.match(backend, /scripts\/backend-gate-scope\.mjs/);
  assert.match(backend, /scripts\/backend-gate-map\.json/);
  assert.match(backend, /tests\/backend-gate-scope\.test\.mjs/);
});


test('expensive PR jobs stay cancellable and no job-level condition uses always()', () => {
  const workflows = [
    ['Android production', readFileSync('.github/workflows/android-production-bundle.yml', 'utf8')],
    ['Android internal', readFileSync('.github/workflows/android-internal-testing.yml', 'utf8')],
    ['iOS TestFlight', readFileSync('.github/workflows/ios-testflight.yml', 'utf8')],
    ['backend gate', readFileSync('.github/workflows/backend-gate.yml', 'utf8')],
  ];
  for (const [name, flow] of workflows) {
    const jobLevelIfs = flow.split('\n').filter((line) => /^    if:/.test(line));
    for (const condition of jobLevelIfs) assert.doesNotMatch(condition, /always\(\)/, name + ': ' + condition);
  }
});

test('native PR workflows trigger for root helpers they consume', () => {
  const android = readFileSync('.github/workflows/android-production-bundle.yml', 'utf8');
  const internal = readFileSync('.github/workflows/android-internal-testing.yml', 'utf8');
  const ios = readFileSync('.github/workflows/ios-testflight.yml', 'utf8');
  assert.match(android, /- 'scripts\/audit-android-manifest\.py'/);
  assert.match(internal, /- 'scripts\/audit-android-manifest\.py'/);
  assert.match(ios, /- '\.github\/scripts\/app-store-\*\.mjs'/);
});

test('backend full path fans out by domain and aggregates fail closed', () => {
  const backend = readFileSync('.github/workflows/backend-gate.yml', 'utf8');
  assert.match(backend, /backend-domain:\n[\s\S]*?fail-fast: false[\s\S]*?matrix:/);
  assert.match(backend, /branch_name: ci-pr-.*matrix\.domain/);
  assert.match(backend, /name: backend-gate\n    needs: \[precheck, backend-domain\]/);
  assert.match(backend, /DOMAIN_RESULT: \$\{\{ needs\.backend-domain\.result \}\}/);
  assert.match(backend, /At least one required isolated backend domain was skipped, cancelled, or failed/);
  assert.match(backend, /if: always\(\) && steps\.neon\.outputs\.branch_id != ''/);
});
