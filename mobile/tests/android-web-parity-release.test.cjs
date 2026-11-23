// Release blocker regression: compare the Android-shared native source with
// published website copy and protect platform-specific store boundaries.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileModule } = require('./support/compile-module.cjs');

const root = path.resolve(process.cwd(), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Android Daily-home names and descriptions stay aligned with the website', () => {
  const web = read('daily-home.mjs');
  const home = read('mobile/src/screens/index.tsx');
  const api = read('mobile/src/api/draftRun.ts');
  const shared = [
    ['mixed', 'A mix of sets', 'Draft Run', 'Eight picks from real trophy drafts.'],
    ['powered-cube', 'Powered Cube picks', 'Powered Cube', 'Eight picks from Powered Cube trophy drafts.'],
    ['latest', 'Only the newest set', 'Latest Set', 'Eight picks from trophy drafts in the latest set.'],
  ];
  for (const [environment, label, title, description] of shared) {
    assert.ok(web.includes("label: '" + label + "'"), 'Web label ' + environment);
    assert.ok(home.toLowerCase().includes(label.toLowerCase()), 'Android label ' + environment);
    assert.ok(web.includes("title: '" + title + "'"), 'Web title ' + environment);
    assert.ok(home.includes("'" + title + "'"), 'Android title ' + environment);
    assert.ok(web.includes("description: '" + description + "'"), 'Web description ' + environment);
    assert.ok(api.includes("description: '" + description + "'"), 'Android description ' + environment);
  }
  for (const value of [
    'Eight picks. What would you take?',
    'These picks come from real trophy drafts.',
    'Want another eight picks?',
    'Free · No account required',
    'Create a free account',
    'Go to Practice',
  ]) {
    assert.ok(web.includes(value), 'Website missing ' + value);
    assert.ok(home.includes(value), 'Android missing ' + value);
  }
});

test('Android results/news preference language matches the shared web copy verbatim', () => {
  const web = JSON.parse(read('results-copy.json'));
  const { resultsCopy } = compileModule('src/resultsCopy.ts', {});
  assert.equal(JSON.stringify(resultsCopy), JSON.stringify(web));
  const preferences = read('mobile/src/components/ResultsPreferences.tsx');
  assert.match(preferences, /resultsCopy as copy/);
  assert.match(preferences, /resultsRequest/);
});

test('Android store identity, target SDK baseline and Play-billing separation remain deliberate', () => {
  const app = JSON.parse(read('mobile/app.json')).expo;
  const pkg = JSON.parse(read('mobile/package.json'));
  const release = JSON.parse(read('mobile/store-release.json'));
  const toolchain = JSON.parse(read('mobile/android-toolchain.json'));
  const placement = read('mobile/src/ads/placement.ts');
  const config = read('mobile/app.config.ts');
  const manifestAudit = read('mobile/scripts/audit-android-manifest.py');
  const workflow = read('.github/workflows/android-production-bundle.yml');
  assert.equal(app.android.package, 'pro.packone.app');
  assert.equal(release.playVersionName, '1.0');
  assert.equal(toolchain.compile_sdk, '36');
  assert.ok(pkg.dependencies.expo.startsWith('~57.'), 'Expo SDK 57 targets Android API 36');
  assert.ok(pkg.expo.autolinking.android.exclude.includes('expo-iap'), 'No unapproved Google Play Billing path');
  assert.match(config, /PACKONE_ADMOB_ANDROID_ENABLED/);
  assert.match(config, /ca-app-pub-1217971050094766~5084711148/, 'Android app must use the registered native App ID');
  assert.match(config, /ca-app-pub-1217971050094766\/8963799298/, 'Android Daily uses the registered banner unit');
  assert.match(workflow, /request.get\('android_admob', ?'disabled'\)/, 'protected signed build must opt in per reviewed request');
  assert.match(workflow, /PACKONE_ADMOB_ANDROID_ENABLED/, 'protected native bundle must propagate Android AdMob mode');
  // Android advertising ID remains absent by default. Only a separately
  // enabled, registered Android AdMob build may include it, and the signed
  // manifest audit independently validates the App ID and consent boundary.
  assert.match(config, /androidAds\.enabled \? \[\] : \['com\.google\.android\.gms\.permission\.AD_ID'\]/);
  assert.match(manifestAudit, /android_admob_enabled/);
  assert.match(manifestAudit, /AD_ID_PERMISSION/);
  assert.match(placement, /return platform === 'android' \? 'affiliate' : 'none'/);
  assert.doesNotMatch(workflow, /PACKONE_ADMOB_ANDROID_ENABLED: '1'/);
  assert.match(workflow, /name: Validate production mobile config[\s\S]*run: npm test/);
  assert.match(workflow, /name: Build signed production bundle/);
  assert.match(workflow, /name: Audit protected Android privacy surface/);
  assert.ok(workflow.includes('      PACKONE_BUILD_PROFILE: production\n      EXPO_PUBLIC_PACKONE_ENV: production'),
    'Android Gradle jobs must inherit production Expo environment, not only prebuild');
  assert.match(workflow, /name: Verify signed AAB embeds reviewed Production Android AdMob runtime config/,
    'Protected signed AAB must check actual embedded Expo runtime AdMob flag');
  assert.match(workflow, /name: Verify PR embedded Android runtime AdMob settings/,
    'Full native PR smoke must inspect actual embedded Expo runtime AdMob config');
  const exactRelease = read('.github/workflows/android-exact-aab-production.yml');
  assert.match(exactRelease, /name: Reject exact AAB without enabled embedded Android AdMob runtime config/,
    'Production upload must fail closed when signed AAB has runtime ads disabled');
  const internalWorkflow = read('.github/workflows/android-internal-testing.yml');
  assert.match(internalWorkflow, /name: Verify signed internal Android AAB embeds production and ad-disabled runtime config/,
    'Internal release must not accidentally embed development runtime settings');
});

test('Android includes web Draft Run observation/timing and removes per-card shopping links', () => {
  const api = read('mobile/src/api/draftRun.ts');
  const draft = read('mobile/app/draft-run.tsx');
  const archive = read('mobile/app/set-archive.tsx');
  assert.match(api, /activeMs/);
  assert.match(api, /decisionViewId\(run\)/);
  assert.match(draft, /decisionTimer\.current\.sample\(decisionKey\)/);
  assert.match(draft, /submitDraftRunPick\(current\.run, selected, current\.session, activeMs\)/);
  assert.doesNotMatch(draft, /tcgplayerMagicUrl|openCardAffiliate/);
  assert.doesNotMatch(archive, /tcgplayerMagicUrl|openCardAffiliate/);
});
