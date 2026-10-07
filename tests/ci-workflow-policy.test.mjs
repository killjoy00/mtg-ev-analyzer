import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { classifyChanges } from '../scripts/ci-change-classifier.mjs';

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

test('required checks share one fail-closed classifier and keep nightly broad coverage', () => {
  for (const flow of [unit,browser]) {
    assert.match(flow,/scripts\/ci-change-classifier\.mjs/);
    assert.match(flow,/schedule:\n\s+- cron:/);
    assert.match(flow,/forcing broad validation/);
    assert.match(flow,/fallback_full/,'classifier execution failures must fail closed to broad validation');
  }
  assert.match(unit,/hydrate_replays/);
  assert.match(unit,/bash scripts\/hydrate-replay-shards\.sh/);
  assert.doesNotMatch(browser,/hydrate-replay-shards|r2_replay_shards\.sh hydrate/,'browser suites do not consume replay shards');
});

test('generic test gate no longer blocks unrelated PRs on release-secret provisioning', () => {
  assert.doesNotMatch(unit,/Verify account-deletion release secrets are provisioned/);
  const secureAuth=readFileSync('.github/workflows/secure-auth-release.yml','utf8');
  assert.match(secureAuth,/PACK1_ACCOUNT_DELETE_RESEND_API_KEY/);
  assert.match(secureAuth,/APPLE_TOKEN_ENCRYPTION_KEY_V1/);
});

test('scoped account browser validation installs WebKit for dual-engine contracts', () => {
  assert.match(browser,/BROWSER_GROUPS/);
  assert.match(browser,/\*,account,\*/);
  assert.match(browser,/playwright install --with-deps chromium webkit/);
});

test('required checks cannot pass by silently skipping their selected validation', () => {
  assert.match(unit,/Verify selected test validation completed/);
  assert.match(unit,/test-validation-complete/);
  assert.match(browser,/Verify selected browser validation completed/);
  assert.match(browser,/browser-validation-complete/);
  assert.match(browser,/Run focused publication browser smoke/);
});

const ciContractStep=unit.split('      - name: Verify CI selection contracts')[1]?.split('      - name: Validate publication diff and generated outputs')[0]||'';

test('workflow/helper validation runs independently of the selected product test plan', () => {
  assert.match(ciContractStep,/if: steps\.scope\.outputs\.ci_contracts == 'true'/);
  assert.match(ciContractStep,/changed_ci/);
  assert.match(ciContractStep,/node --check "\$changed"/);
  assert.match(ciContractStep,/grep -lF/);
  assert.match(ciContractStep,/tests\/ci-workflow-policy\.test\.mjs/);
  assert.match(ciContractStep,/tests\/workflow-block-scalars\.test\.mjs/);
  assert.doesNotMatch(ciContractStep,/npm test/);
  const ciCase=unit.split('            ci)')[1]?.split('            full)')[0]||'';
  assert.match(ciCase,/ci-contracts-complete/);
  assert.doesNotMatch(ciCase,/npm test/);
});

test('presentation/workflow mixed diff executes the affected helper contracts', t => {
  const helper='.github/scripts/review-helper.mjs';
  const selection=classifyChanges(['editorial.css',helper]);
  assert.equal(selection.plan,'presentation');assert.equal(selection.ciContracts,true);
  const root=mkdtempSync(path.join(tmpdir(),'ci-mixed-contract-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.email','ci@example.test');git('config','user.name','CI');
  mkdirSync(path.join(root,'.github/scripts'),{recursive:true});mkdirSync(path.join(root,'tests'));mkdirSync(path.join(root,'bin'));
  writeFileSync(path.join(root,helper),'export const value=1;\n');
  writeFileSync(path.join(root,'tests/review-helper.test.mjs'),`// ${helper}\n`);
  git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
  writeFileSync(path.join(root,helper),'export const value=2;\n');writeFileSync(path.join(root,'editorial.css'),'body {}\n');
  git('add','.');git('commit','-qm','mixed');const head=git('rev-parse','HEAD');
  const log=path.join(root,'node-calls.log');
  writeFileSync(path.join(root,'bin/node'),'#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$CI_NODE_CALLS"\n',{mode:0o755});
  const shell=ciContractStep.split('        run: |\n')[1].split('\n').map(line=>line.replace(/^          /,'')).join('\n');
  const execution=spawnSync('bash',['-c',shell],{cwd:root,encoding:'utf8',env:{...process.env,PATH:path.join(root,'bin')+path.delimiter+process.env.PATH,
    CI_BASE_SHA:base,CI_HEAD_SHA:head,RUNNER_TEMP:root,CI_NODE_CALLS:log}});
  assert.equal(execution.status,0,execution.stderr);
  const calls=readFileSync(log,'utf8');
  assert.match(calls,/--check \.github\/scripts\/review-helper\.mjs/);
  assert.match(calls,/--test .*tests\/review-helper\.test\.mjs/);
  assert.equal(calls.match(/tests\/review-helper\.test\.mjs/g).length,1,'affected tests are deduplicated');
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
  assert.match(backend, /CI_BRANCH_PREFIX: ci-pr-.*matrix\.domain/);
  assert.match(backend, /name: backend-gate\n    needs: \[precheck, backend-domain, postgres-contract\]/);
  assert.match(backend, /DOMAIN_RESULT: \$\{\{ needs\.backend-domain\.result \}\}/);
  assert.match(backend, /At least one required isolated backend domain was skipped, cancelled, or failed/);
  assert.match(backend, /if: always\(\) && steps\.neon\.outputs\.branch_id != ''/);
});
