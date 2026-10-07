import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { ALWAYS_STEPS, classifyBackendChanges, filterBackendChangedPaths, loadBackendMap, matchesGlob } from '../scripts/backend-gate-scope.mjs';

const map = loadBackendMap();

const workflowTriggers=[...readFileSync('.github/workflows/backend-gate.yml','utf8').matchAll(/^      - '([^']+)'$/gm)].map(match=>match[1]);

function fullPathExample(glob) {
  if(!glob.includes('*')) return glob;
  if(glob==='migrations/**') return 'migrations/9999_probe.sql';
  throw new Error('Add a representative full-path example for '+glob);
}

test('every registered integration suite selects itself and is reachable from the workflow trigger',()=>{
  const flow=loadBackendMap();
  for(const [domain,config] of Object.entries(flow.domains))for(const suite of config.suites) {
    const result=classifyBackendChanges([suite],{map:flow});
    assert.ok(result.suites.includes(suite),suite);
    assert.ok(result.domains.includes(domain),suite);
    assert.ok(workflowTriggers.some(glob=>matchesGlob(suite,glob)),`Workflow cannot be triggered by ${suite}`);
  }
});

test('every declared full path triggers the workflow, survives filtering, and stays full when mixed with a narrow domain',()=>{
  const narrow='worker/draft-run-pool.mjs';
  for(const glob of map.full_paths) {
    const path=fullPathExample(glob);
    assert.ok(workflowTriggers.some(trigger=>matchesGlob(path,trigger)),`Workflow cannot be triggered by full path ${path}`);
    assert.deepEqual(filterBackendChangedPaths([path],map),[path],`Full path was filtered out: ${path}`);
    for(const paths of [[path],[path,narrow]]) {
      const result=classifyBackendChanges(paths,{map});
      assert.equal(result.needsNeon,true,path);
      assert.equal(result.fullSuite,true,path);
      assert.deepEqual(result.domains,Object.keys(map.domains),path);
      assert.ok(result.reasons.includes(`full-path: ${path}`),path);
    }
  }
});

test('mixed narrow domains retain every required domain without broadening to full',()=>{
  const result=classifyBackendChanges([
    'worker/draft-run-pool.mjs',
    'tests/apple-subscription-backend-smoke.mjs',
  ],{map});
  assert.equal(result.fullSuite,false);
  assert.deepEqual(result.domains,['draft_run','subscriptions']);
  assert.ok(result.suites.includes('tests/draft-run-backend-smoke.mjs'));
  assert.ok(result.suites.includes('tests/apple-subscription-backend-smoke.mjs'));
});

test('account backend-smoke change selects account suites plus the always-run foundation', () => {
  const result = classifyBackendChanges(['tests/account-deletion-backend-smoke.mjs'], { map });
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
    ['scripts/create-ci-neon-branch.mjs'],
    ['scripts/control-read.mjs'],
    ['scripts/reroll-index-schema.mjs'],
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

test('neutral files are removed before backend classification and mixed PR noise can stay narrow', () => {
  const paths = [
    'worker/draft-run-pool.mjs',
    'docs/backend-gate.md',
    'mobile/app/index.tsx',
    'tests/draft-run-pool.test.mjs',
    'README.md',
    '.github/dependabot.yml',
  ];
  assert.deepEqual(filterBackendChangedPaths(paths), ['worker/draft-run-pool.mjs']);
  const result = classifyBackendChanges(paths, { map });
  assert.equal(result.fullSuite, false);
  assert.deepEqual(result.domains, ['draft_run']);
});

test('modules reached through full-path handlers are shared and force the full suite', () => {
  for (const path of [
    'worker/capabilities.mjs',
    'worker/draft-run-season.mjs',
    'worker/account-deletion.mjs',
    'worker/patreon.mjs',
    'worker/public-identity-safety.mjs',
  ]) {
    const result = classifyBackendChanges([path], { map });
    assert.equal(result.fullSuite, true, path);
    assert.match(result.reasons.join('\n'), /shared across domains/, path);
  }
});

test('a module reached from more than one mapped domain is treated as shared and forces full', () => {
  const result = classifyBackendChanges(['worker/account-session.mjs'], { map });
  assert.equal(result.fullSuite, true);
  assert.match(result.reasons.join('\n'), /shared across domains/);
});

test('narrow routes are limited to backend smoke tests or mapped modules outside handler imports', () => {
  const cases = [
    ['worker/draft-run-pool.mjs', 'draft_run'],
    ['tests/account-deletion-backend-smoke.mjs', 'account'],
    ['tests/apple-subscription-backend-smoke.mjs', 'subscriptions'],
    ['tests/daily-generation-backend-smoke.mjs', 'daily'],
    ['tests/corpus-version-backend-smoke.mjs', 'corpus'],
  ];
  for (const [path, domain] of cases) {
    const result = classifyBackendChanges([path], { map });
    assert.equal(result.fullSuite, false, path);
    assert.deepEqual(result.domains, [domain], path);
  }
});

test('season smoke suite itself remains a narrow seasons route and schedules destructive fixtures last', () => {
  const result = classifyBackendChanges(['tests/season-backend-smoke.mjs'], { map });
  assert.equal(result.fullSuite, false);
  assert.deepEqual(result.domains, ['seasons']);
  assert.equal(result.seasonDestructive, true);
  assert.ok(result.suites.includes('tests/season-backend-smoke.mjs'));
});

test('root web files remain classified and fail closed while a neutral-only filtered list is full', () => {
  assert.equal(classifyBackendChanges(['web-only.mjs'], { map }).fullSuite, true);
  assert.equal(classifyBackendChanges(['README.md', 'docs/only.md', 'mobile/app/index.tsx', 'tests/unit.test.mjs', '.github/dependabot.yml'], { map }).fullSuite, true);
});

test('serving maintenance remains a full-suite input even beside a narrow backend edit', () => {
  const maintenance='.github/scripts/maintain-serving-indexes.sql';
  assert.deepEqual(filterBackendChangedPaths([maintenance,'worker/draft-run-pool.mjs']),[maintenance,'worker/draft-run-pool.mjs']);
  assert.equal(classifyBackendChanges([maintenance,'worker/draft-run-pool.mjs'],{map}).fullSuite,true);
});
