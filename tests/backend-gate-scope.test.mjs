import test from 'node:test';
import assert from 'node:assert/strict';
import { ALWAYS_STEPS, classifyBackendChanges, loadBackendMap } from '../scripts/backend-gate-scope.mjs';

const map = loadBackendMap();

test('account-only worker change selects the account suites plus the always-run foundation', () => {
  const result = classifyBackendChanges(['worker/account-deletion-verification.mjs'], { map });
  assert.equal(result.fullSuite, false);
  assert.deepEqual(result.domains, ['account']);
  assert.deepEqual(result.alwaysSteps, [...ALWAYS_STEPS]);
  assert.ok(result.suites.includes('tests/account-deletion-backend-smoke.mjs'));
  assert.ok(!result.suites.includes('tests/draft-run-backend-smoke.mjs'));
});

test('gate infrastructure, migrations, shared core, unmapped files, and empty diffs force the full suite', () => {
  for (const paths of [
    ['.github/workflows/backend-gate.yml'],
    ['.github/workflows/prepare-rebuild.yml'],
    ['scripts/backend-gate-scope.mjs'],
    ['scripts/backend-gate-map.json'],
    ['tests/backend-gate-scope.test.mjs'],
    ['migrations/9999_probe.sql'],
    ['worker/schema.sql'],
    ['worker/core.mjs'],
    ['worker/index.js'],
    ['worker/request-json.mjs'],
    ['worker/ingress-auth.mjs'],
    ['game-date.mjs'],
    ['worker/launch-watcher-alert.mjs'],
    [],
  ]) {
    const result = classifyBackendChanges(paths, { map });
    assert.equal(result.needsNeon, true, paths.join(', '));
    assert.equal(result.fullSuite, true, paths.join(', '));
    assert.equal(result.suites.length, Object.values(map.domains).flatMap((domain) => domain.suites).filter((value, index, all) => all.indexOf(value) === index).length);
  }
});

test('a module reached from more than one mapped domain is treated as shared and forces full', () => {
  const result = classifyBackendChanges(['worker/account-session.mjs'], { map });
  assert.equal(result.fullSuite, true);
  assert.match(result.reasons.join('\n'), /shared across domains/);
});

test('representative domain-owned files select only their mapped group', () => {
  const cases = [
    ['worker/apple-subscription-policy.mjs', 'subscriptions'],
    ['worker/decision-measurements.mjs', 'draft_run'],
    ['worker/daily-generation-results.mjs', 'daily'],
    ['tests/corpus-version-backend-smoke.mjs', 'corpus'],
    ['worker/draft-run-season.mjs', 'seasons'],
  ];
  for (const [path, domain] of cases) {
    const result = classifyBackendChanges([path], { map });
    assert.equal(result.fullSuite, false, path);
    assert.deepEqual(result.domains, [domain], path);
  }
});

test('season group schedules the destructive season fixture last via the dedicated flag', () => {
  const result = classifyBackendChanges(['worker/draft-run-season.mjs'], { map });
  assert.equal(result.seasonDestructive, true);
  assert.ok(result.suites.includes('tests/season-backend-smoke.mjs'));
});
