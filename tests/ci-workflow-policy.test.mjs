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

test('scoped presentation validation preserves native editorial parity for canonical web and legal inputs', () => {
  const presentationCase=unit.split('            presentation)')[1]?.split('            ci)')[0]||'';
  assert.match(presentationCase,/tests\/editorial\.test\.mjs/);
  assert.match(presentationCase,/tests\/mobile-native-editorial\.test\.mjs/);
  for(const path of ['about/index.html','contact/index.html','privacy/index.html','terms/index.html']) {
    const selection=classifyChanges([path]);
    assert.equal(selection.plan,'presentation',path);
    assert.equal(selection.unit,'presentation',path);
  }
});

test('browser dependency image matches the locked Playwright version and avoids apt mirror downloads', () => {
  const playwright = JSON.parse(readFileSync('package.json', 'utf8')).devDependencies.playwright;
  const image = browser.match(/image: mcr\.microsoft\.com\/playwright:v([\d.]+)-noble/);
  assert.ok(image, 'browser job must use the official Noble Playwright image');
  assert.equal(image[1], playwright, 'image and installed package versions must match');
  assert.match(browser, /options: --ipc=host/);
  assert.match(browser, /defaults:\n\s+run:\n\s+shell: bash/, 'container steps use Bash, not the default sh');
  assert.match(browser, /git config --global --add safe\.directory "\$GITHUB_WORKSPACE"/,
    'container must trust only its checked-out workspace for Git-backed preview validation');
  assert.match(browser, /timeout-minutes: 30/);
  const install = browser.split('      - name: Verify preinstalled Playwright browsers and install JS dependencies')[1]
    ?.split('      - name: Start static site')[0] || '';
  assert.match(install, /npm ci --no-audit --no-fund/);
  assert.match(install, /BROWSER_GROUPS/);
  assert.match(install, /groups\.includes\(',account,'\)/);
  assert.match(install, /groups\.includes\(',admin,'\)/);
  assert.match(install, /chromium, webkit/);
  assert.match(install, /browser\.executablePath\(\)/);
  assert.match(install, /accessSync\(executable, constants\.X_OK\)/);
  assert.doesNotMatch(install, /--with-deps|sudo dpkg|apt-get\s+(?:install|update)/);
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

test('iOS 1.4 TestFlight enables only approved production AdMob with a fail-closed config audit', () => {
  const release = JSON.parse(readFileSync('mobile/store-release.json', 'utf8'));
  const request = JSON.parse(readFileSync('.github/testflight-release-request.json', 'utf8'));
  const ios = readFileSync('.github/workflows/ios-testflight.yml', 'utf8');
  assert.equal(release.appStoreVersion, '1.4');
  assert.equal(release.playVersionName, '1.0');
  assert.equal(request.operation, 'upload-testflight-app-store-eligible');
  assert.match(request.reason, /iOS 1\.4/);
  assert.match(request.reason, /\bdo not submit (?:to )?App Review\b/i, 'explicit no-App-Review release boundary must remain');
  assert.equal((ios.match(/PACKONE_ADMOB_IOS_ENABLED: '1'/g) || []).length, 2,
    'both unsigned archive and protected signing must explicitly enable live iOS ads');
  assert.equal((ios.match(/Verify reviewed iOS 1\.4 live-AdMob release configuration/g) || []).length, 2,
    'both jobs must check the generated public Expo config before archiving');
  assert.match(ios, /ad\?\.iosEnabled !== true \|\| ad\?\.androidEnabled !== false/);
  assert.match(ios, /ad\?\.iosBannerUnitId !== 'ca-app-pub-1217971050094766\/8989398185'/);
  assert.match(ios, /expo-tracking-transparency/);
  assert.match(ios, /version\.appStoreVersion !== '1\.4'/);
  assert.match(ios, /github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'\)/);
});

test('iOS archives embed the production AdMob configuration rather than only passing preflight', () => {
  const workflow = readFileSync('.github/workflows/ios-testflight.yml', 'utf8');
  for (const stepName of ['Archive iPhone device build without signing', 'Archive signed Pack One app']) {
    const block = workflow.split(`      - name: ${stepName}\n`)[1]?.split('\n      - name: ')[0] ?? '';
    assert.match(block, /(?:^|\n)        env:\n          PACKONE_BUILD_PROFILE: production\n/,
      `${stepName} must propagate the production profile to Xcode's Expo config build phase`);
  }
  assert.equal((workflow.match(/run: node \.\/scripts\/check-ios-admob-archive\.mjs "\$RUNNER_TEMP\/PackOne\.xcarchive"/g) || []).length, 2,
    'both unsigned PR and signed release archives must validate embedded Expo app.config');

  const archive = mkdtempSync(path.join(tmpdir(), 'packone-embedded-admob-'));
  const embedded = path.join(archive, 'Products', 'Applications', 'PackOne.app', 'EXConstants.bundle', 'app.config');
  const config = {
    version: '1.4',
    ios: { bundleIdentifier: 'pro.packone.app' },
    extra: {
      buildProfile: 'production',
      adMob: {
        iosEnabled: true,
        androidEnabled: false,
        testBanners: false,
        iosBannerUnitId: 'ca-app-pub-1217971050094766/8989398185',
      },
    },
  };
  const run = () => spawnSync(process.execPath, ['mobile/scripts/check-ios-admob-archive.mjs', archive], { encoding: 'utf8' });
  try {
    mkdirSync(path.dirname(embedded), { recursive: true });
    writeFileSync(embedded, JSON.stringify(config));
    assert.equal(run().status, 0, 'correctly packaged live iOS AdMob must pass');
    for (const [label, broken] of [
      ['development profile', { ...config, extra: { ...config.extra, buildProfile: 'development' } }],
      ['ads disabled', { ...config, extra: { ...config.extra, adMob: { ...config.extra.adMob, iosEnabled: false } } }],
      ['missing unit', { ...config, extra: { ...config.extra, adMob: { ...config.extra.adMob, iosBannerUnitId: null } } }],
    ]) {
      writeFileSync(embedded, JSON.stringify(broken));
      assert.notEqual(run().status, 0, `${label} must fail archived app validation`);
    }
    rmSync(embedded);
    assert.notEqual(run().status, 0, 'missing embedded app.config must fail, not silently disable ads');
  } finally {
    rmSync(archive, { recursive: true, force: true });
  }
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

test('Android native PR smoke and screenshots run automatically while Play releases remain protected', () => {
  const android = readFileSync('.github/workflows/android-production-bundle.yml', 'utf8');
  const internal = readFileSync('.github/workflows/android-internal-testing.yml', 'utf8');
  const baseline = readFileSync('.github/workflows/mobile-native-baseline.yml', 'utf8');
  const ios = readFileSync('.github/workflows/ios-testflight.yml', 'utf8');
  const screenshots = readFileSync('.github/workflows/mobile-store-screenshots.yml', 'utf8');
  const rc = readFileSync('.github/workflows/mobile-exact-main-rc.yml', 'utf8');

  const releaseTriggers = android.split('permissions:')[0];
  const releasePush = releaseTriggers.split('  pull_request:')[0];
  assert.match(releasePush, /push:\n    branches: \[main\]\n    paths:\n      - '\.github\/android-production-bundle-request\.json'/,
    'Protected signed AAB builds remain review-request-only on main pushes');
  assert.doesNotMatch(releasePush, /- 'mobile\/\*\*'/,
    'Routine mobile pushes must not sign an AAB');
  assert.match(releaseTriggers, /pull_request:\n    types: \[opened, synchronize, reopened\]\n    paths:/);
  assert.match(releaseTriggers, /- 'mobile\/\*\*'/,
    'Android production unsigned PR smoke runs for native changes');
  assert.match(android, /name: validate production Android bundle build[\s\S]*github\.event_name == 'pull_request'/);
  assert.match(android, /name: build protected Play-signed Android bundle[\s\S]*github\.ref == 'refs\/heads\/main'/);
  assert.match(android, /environment: pack-one-mobile-release/);
  assert.match(android, /github\.event_name == 'push'/);
  // Review-request parsing and Android advertising config remain guarded.
  const signedRequest = android.split('      - name: Resolve reviewed production bundle request')[1]
    ?.split('      - name: Require current approved main revision')[0] ?? '';
  assert.match(signedRequest, /import json, os/);
  assert.ok(signedRequest.includes("request.get('android_admob','disabled')"));
  assert.match(signedRequest, /PACKONE_ADMOB_ANDROID_ENABLED/);

  const internalTriggers = internal.split('permissions:')[0];
  assert.match(internalTriggers, /pull_request:\n    types: \[opened, synchronize, reopened\]\n    paths:/);
  assert.match(internalTriggers, /- 'mobile\/\*\*'/,
    'Internal signing-config smoke runs for native PRs');
  assert.match(internalTriggers, /workflow_dispatch:/);
  assert.doesNotMatch(internalTriggers, /\n  push:/,
    'Internal Google Play publisher must not be activated by ordinary pushes');
  assert.match(internal, /name: validate Android upload signing config[\s\S]*github\.event_name == 'pull_request'/);
  assert.match(internal, /name: sign and publish Android internal test[\s\S]*github\.ref == 'refs\/heads\/main'/);
  const baselineTriggers = baseline.split('permissions:')[0];
  assert.match(baselineTriggers, /workflow_dispatch:/);
  assert.doesNotMatch(baselineTriggers, /\n  (?:push|pull_request):/,
    'Historical baseline reproduction should remain opt-in');

  assert.match(ios, /- '\.github\/scripts\/app-store-\*\.mjs'/,
    'iOS CI continues unchanged');
  assert.match(ios, /pull_request:/);
  assert.match(screenshots, /pull_request:/);
  assert.match(screenshots, /if: needs\.validate\.outputs\.capture_required == 'true' && \(github\.event_name == 'pull_request' \|\| github\.event_name == 'push' \|\| inputs\.android_only\)/,
    'Android emulator acceptance captures PRs and reviewed main requests automatically');
  assert.match(rc, /github\.event_name == 'push' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.include_android\)/,
    'Android RC must run on mobile main pushes');
  assert.match(rc, /default: true/,
    'Manual RC includes Android by default');
  assert.match(rc, /needs\.android-bundle\.result == 'success'/);
  assert.match(rc, /github\.event_name == 'workflow_dispatch' && !inputs\.include_android && needs\.android-bundle\.result == 'skipped'/,
    'Only an explicit manual opt-out may record iOS-only RC evidence');
  assert.match(rc, /android_artifact: process\.env\.INCLUDE_ANDROID === 'true'/);
  assert.match(rc, /not built; manual RC explicitly excluded Android/);
});

test('backend full path fans out by domain and aggregates fail closed', () => {
  const backend = readFileSync('.github/workflows/backend-gate.yml', 'utf8');
  assert.match(backend, /backend-domain:\n[\s\S]*?fail-fast: false[\s\S]*?matrix:/);
  assert.match(backend, /CI_BRANCH_PREFIX: ci-pr-.*matrix\.domain/);
  assert.match(backend, /name: backend-gate\n    needs: \[precheck, backend-domain, postgres-contract\]/);
  assert.match(backend, /DOMAIN_RESULT: \$\{\{ needs\.backend-domain\.result \}\}/);
  assert.match(backend, /run: node scripts\/verify-backend-execution\.mjs/);
  const aggregate=backend.split('\n  backend-gate:\n')[1];
  const checkout=aggregate.indexOf('actions/checkout@v4');
  assert.ok(checkout>=0&&checkout<aggregate.indexOf('name: Aggregate isolated backend domains'));
  assert.match(aggregate,/actions\/setup-node@v4\n        with:\n          node-version: 24/);
  assert.match(backend, /NEON_DOMAINS_JSON: \$\{\{ needs\.precheck\.outputs\.neon_domains_json \}\}/);
  assert.match(backend, /if: always\(\) && steps\.neon\.outputs\.branch_id != ''/);
});

test('serving readiness state-machine checks run on the local PostgreSQL contract', () => {
  const backend = readFileSync('.github/workflows/backend-gate.yml', 'utf8');
  const contract = backend.split('\n  postgres-contract:\n')[1].split('\n  precheck:\n')[0];
  assert.match(contract, /run: node tests\/corpus-readiness-backend-smoke\.mjs --local-fixture\n/);
  const suite = readFileSync('tests/corpus-readiness-backend-smoke.mjs', 'utf8');
  // Neon domain jobs install no dependencies, so pg must load only for the local scope.
  assert.doesNotMatch(suite, /^import .*postgres-fixture/m);
  for (const name of ['killed worker lease is reclaimed', 'timeout is actionable', 'real cache corruption fails', 'post-smoke concurrent revision', 'reactivation of the same source']) {
    const at = suite.indexOf(name);
    assert.ok(at > suite.indexOf('if(local) {\n // A real killed Node process') && at < suite.indexOf('// The local fixture has no supplemental component'), name);
  }
});

test('serving maintenance runs only the reviewed SQL on a named Neon branch, and only when needed', () => {
  const flow = readFileSync('.github/workflows/serving-maintenance.yml', 'utf8');
  assert.match(flow, /schedule:\n    - cron: '[^']+'/);
  assert.match(flow, /\npermissions:\n  contents: read\n/);
  assert.match(flow, /if: github\.repository == 'killjoy00\/mtg-ev-analyzer'/);
  assert.match(flow, /npm install -g neon@4\.17\.4/);
  assert.match(flow, /echo "::add-mask::\$connection"/);
  assert.match(flow, /development\) branch=br-twilight-hill-ayffyd2b ;;\n\s+production\) branch=br-orange-feather-ayps8kep ;;/);
  assert.match(flow, /if: steps\.check\.outputs\.needed == 'true'[\s\S]*-f \.github\/scripts\/maintain-serving-indexes\.sql/);
  assert.doesNotMatch(flow, /functions deploy|build-neon-functions|\b(UPDATE|INSERT|DELETE|DROP|ALTER|TRUNCATE)\b/);
});

test('backend Neon branches are capped, sampled, gated on local contracts and swept weekly', () => {
  const backend = readFileSync('.github/workflows/backend-gate.yml', 'utf8');
  const domain = backend.split('\n  backend-domain:\n')[1].split('\n  backend-gate:\n')[0];
  assert.match(backend, /schedule:\n    - cron: '17 7 \* \* 1'/);
  assert.match(domain, /needs: \[precheck, postgres-contract\]/);
  assert.match(domain, /needs\.postgres-contract\.result == 'success'/);
  assert.match(domain, /github\.event_name == 'schedule'/);
  assert.match(domain, /github\.event_name == 'workflow_dispatch'/);
  assert.match(domain, /github\.ref == 'refs\/heads\/main'/);
  assert.match(domain, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(domain, /CI_BRANCH_MAX_CU:[^\n]*matrix\.domain == 'draft_run'[^\n]*matrix\.domain == 'corpus'[^\n]*matrix\.domain == 'corpus_readiness'[^\n]*&& 2 \|\| 1/);
  assert.match(domain, /if: matrix\.domain == 'corpus' \|\| matrix\.domain == 'corpus_readiness' \|\| matrix\.domain == 'subscriptions'/);
  assert.match(domain, /CI_BRANCH_PREFIX: ci-pr-\$\{\{ github\.event\.pull_request\.number \|\| 0 \}\}/);
  assert.doesNotMatch(domain, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  const summary = domain.indexOf('name: Summarize Neon compute allocation');
  assert.ok(domain.indexOf('name: Start Neon compute sampler') > domain.indexOf('name: Prepare isolated connection'));
  assert.ok(summary > 0 && summary < domain.indexOf('name: Delete isolated Neon branch'));
  assert.match(domain.slice(summary), /^name: Summarize Neon compute allocation\n        if: always\(\) && env\.NEON_SAMPLER_PID != ''\n        continue-on-error: true\n/);
});

test('store screenshot sweeps are explicit release evidence, not a routine PR gate', () => {
  const workflow = readFileSync('.github/workflows/mobile-store-screenshots.yml', 'utf8');
  const header = workflow.split('\npermissions:')[0];
  assert.match(header, /workflow_dispatch:/, 'owner can request fresh store screenshots');
  assert.match(header, /workflow_call:/, 'reviewed native fixture capture can be reused');
  assert.match(header, /\.github\/store-screenshot-request\.json/, 'reviewed main request still starts capture');
  assert.match(workflow, /  validate:\n(?:[^\n]*\n)*?    if: github\.event_name != 'pull_request'/,
    'skip all expensive screenshot jobs on pull requests');
  assert.match(workflow, /  ios:[\s\S]*?needs: validate/);
  assert.match(workflow, /  android:[\s\S]*?needs: validate/);
  assert.match(mobile, /uses: \.\/\.github\/actions\/mobile-validate/,
    'fast native type, lint and config validation remains on PRs');
});
