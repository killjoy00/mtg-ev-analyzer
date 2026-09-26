import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('native source and intended store marketing versions stay aligned', () => {
  const app = JSON.parse(read('mobile/app.json'));
  const release = JSON.parse(read('mobile/store-release.json'));
  assert.equal(app.expo.version, '1.0');
  assert.equal(release.appStoreVersion, '1.0');
  assert.equal(release.playVersionName, release.appStoreVersion);

  const preflight = read('mobile/scripts/release-preflight.mjs');
  assert.match(preflight, /config\.version !== storeRelease\.appStoreVersion/);
  assert.match(preflight, /App Store and Play marketing versions must match/);
});

test('store workflows cannot publish or use store credentials from arbitrary refs', () => {
  const workflowPaths = [
    '.github/workflows/ios-testflight.yml',
    '.github/workflows/android-internal-testing.yml',
    '.github/workflows/ios-testflight-status.yml',
    '.github/workflows/android-internal-status.yml',
  ];
  for (const path of workflowPaths) {
    const workflow = read(path);
    assert.doesNotMatch(workflow, /chatgpt\/pack-one-mobile-v2-(?:ios-testflight|android-internal-testing)/, path);
    if (path === '.github/workflows/ios-testflight.yml') {
      assert.match(workflow, /github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'\)/, path);
      assert.match(workflow, /push:\s+branches: \[main\]\s+paths:\s+- '\.github\/testflight-release-request\.json'/s, path);
      assert.match(workflow, /request\.get\('operation'\) != 'upload-testflight-internal'/, path);
    } else if (path === '.github/workflows/android-internal-testing.yml') {
      assert.match(workflow, /github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'\)/, path);
      assert.match(workflow, /push:\s+branches: \[main\]\s+paths:\s+- '\.github\/android-internal-release-request\.json'/s, path);
      assert.match(workflow, /request\.get\('operation'\) != 'upload-android-internal'/, path);
    } else if (path === '.github/workflows/android-internal-status.yml') {
      assert.match(workflow, /github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'\)/, path);
      assert.match(workflow, /push:\s+branches: \[main\]\s+paths:\s+- '\.github\/android-internal-status-request\.json'/s, path);
      assert.match(workflow, /request\.get\('operation'\) != 'check-android-internal-status'/, path);
    } else {
      assert.match(workflow, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/, path);
    }
    assert.match(workflow, /environment: pack-one-mobile-release/, path);
    assert.match(workflow, /git fetch --no-tags --depth=1 origin main/, path);
    assert.match(workflow, /git rev-parse FETCH_HEAD/, path);
  }

  const ios = read('.github/workflows/ios-testflight.yml');
  const iosRequest = JSON.parse(read('.github/testflight-release-request.json'));
  assert.deepEqual(Object.keys(iosRequest).sort(), ['operation','reason']);
  assert.equal(iosRequest.operation, 'upload-testflight-internal');
  assert.equal(typeof iosRequest.reason, 'string');
  assert.ok(iosRequest.reason.trim().length > 0);

  const androidRequest = JSON.parse(read('.github/android-internal-release-request.json'));
  assert.deepEqual(Object.keys(androidRequest).sort(), ['operation','reason']);
  assert.equal(androidRequest.operation, 'upload-android-internal');
  assert.equal(typeof androidRequest.reason, 'string');
  assert.ok(androidRequest.reason.trim().length > 0);

  const androidStatusRequest = JSON.parse(read('.github/android-internal-status-request.json'));
  assert.deepEqual(Object.keys(androidStatusRequest).sort(), ['operation','reason']);
  assert.equal(androidStatusRequest.operation, 'check-android-internal-status');
  assert.equal(typeof androidStatusRequest.reason, 'string');
  assert.ok(androidStatusRequest.reason.trim().length > 0);

  assert.match(ios, /CFBundleShortVersionString/);
  assert.match(ios, /store-release\.json/);

  const android = read('.github/workflows/android-internal-testing.yml');
  assert.match(android, /versionName/);
  assert.match(android, /store-release\.json/);
});

test('privacy page exposes the stable Play deletion resource and fallback request path', () => {
  const privacy = read('privacy/index.html');
  assert.match(privacy, /<h2 id="delete-account">Deleting your account<\/h2>/);
  assert.match(privacy, /mailto:admin@packone\.pro/);
  assert.match(privacy, />admin@packone\.pro<\/a>/);

  const releaseDocs = read('docs/mobile-release-config.md');
  assert.match(releaseDocs, /https:\/\/packone\.pro\/privacy\/#delete-account/);
  assert.doesNotMatch(releaseDocs, /- Sign in with Apple provider\/capability work/);
});


test('v1 contains a cold-start and resume forced-update gate with fail-open outage behavior', () => {
  const layout = read('mobile/app/_layout.tsx');
  const gate = read('mobile/src/components/VersionGate.tsx');
  const policy = read('mobile/src/versionPolicy.ts');
  const gateway = read('edge/gateway.mjs');
  const releaseWorkflow = read('.github/workflows/secure-auth-release.yml');
  const pkg = JSON.parse(read('mobile/package.json'));

  assert.match(layout, /<VersionGate>/);
  assert.equal(pkg.dependencies['expo-application'], '~57.0.3');
  assert.match(gate, /Application\.nativeApplicationVersion/);
  assert.match(gate, /Application\.nativeBuildVersion/);
  assert.match(gate, /AppState\.addEventListener\('change'/);
  assert.match(gate, /\/growth\/v1\/mobile\/version/);
  assert.match(policy, /catch \{\s*return \{ status: 'allowed' \};\s*\}/);
  assert.match(policy, /apps\.apple\.com/);
  assert.match(policy, /play\.google\.com/);
  assert.match(gateway, /'\/v1\/mobile\/version'/);
  assert.match(releaseWorkflow, /migrations\/0040_mobile_minimum_version\.sql/g);
});


test('v1 implements Sign in with Apple across native iOS, Android/web handoff, and secure release', () => {
  const app = JSON.parse(read('mobile/app.json'));
  const pkg = JSON.parse(read('mobile/package.json'));
  const account = read('mobile/app/account.tsx');
  const api = read('mobile/src/api/account.ts');
  const worker = read('worker/growth-function.js');
  const apple = read('worker/apple-auth.mjs');
  const gateway = read('edge/gateway.mjs');
  const releaseWorkflow = read('.github/workflows/secure-auth-release.yml');
  const integrity = read('docs/REQUEST-INTEGRITY.md');

  assert.equal(app.expo.ios.usesAppleSignIn, true);
  assert.ok(app.expo.plugins.includes('expo-apple-authentication'));
  assert.equal(pkg.dependencies['expo-apple-authentication'], '~57.0.2');
  assert.match(account, /AppleAuthentication\.AppleAuthenticationButton/);
  assert.match(account, /nonce: start\.flowToken/);
  assert.match(account, /finishNativeAppleSignIn/);
  assert.match(account, /finishAppleSignIn/);
  assert.match(account, /credential\.fullName\?\.givenName/);
  assert.match(account, /credential\.fullName\?\.familyName/);
  assert.match(read('migrations/0041_apple_auth.sql'), /first_name text[\s\S]*last_name text/);
  assert.match(api, /\/growth\/v1\/mobile\/account\/apple\/native/);
  assert.match(worker, /\/v1\/account\/apple\/callback/);
  assert.match(worker, /revokeAppleAuthorization/);
  assert.match(apple, /https:\/\/appleid\.apple\.com\/auth\/revoke/);
  assert.match(apple, /pro\.packone\.app/);
  assert.match(apple, /pro\.packone\.web/);
  assert.match(gateway, /'\/v1\/mobile\/account\/apple\/native'/);
  assert.match(releaseWorkflow, /migrations\/0041_apple_auth\.sql/g);
  assert.match(releaseWorkflow, /APPLE_SIGN_IN_KEY_P8/);
  assert.doesNotMatch(integrity, /Sign in with Apple is not currently exposed/);
});


test('Apple launch hardening blocks pre-hijack, separates token keys, and uses Apple deletion re-auth', () => {
  const apple = read('worker/apple-auth.mjs');
  const worker = read('worker/growth-function.js');
  const workflow = read('.github/workflows/secure-auth-release.yml');
  const mobile = read('mobile/app/account.tsx');
  const api = read('mobile/src/api/account.ts');
  const docs = read('docs/mobile-release-config.md');

  assert.match(apple, /APPLE_EXISTING_ACCOUNT_UNVERIFIED/);
  assert.doesNotMatch(apple, /markAppleAuthEmailVerified\(\{authBase,userId:authUserId/);
  assert.match(apple, /APPLE_TOKEN_ENCRYPTION_KEY_V1/);
  assert.match(apple, /TOKEN_CIPHER_PREFIX='apple-token'[\s\S]*TOKEN_KEY_VERSION='v1'/);
  assert.match(workflow, /APPLE_TOKEN_ENCRYPTION_KEY_V1/);
  assert.match(worker, /purpose='delete'/);
  assert.match(worker, /\/v1\/mobile\/account\/delete\/apple\/start/);
  assert.match(worker, /\/v1\/mobile\/account\/delete\/apple\/finish/);
  assert.match(worker, /flow_kind='mobile'[\s\S]*purpose='signin'/);
  assert.match(api, /startAppleDeletionVerification/);
  assert.match(api, /finishAppleDeletion/);
  assert.match(mobile, /Verify with Apple and delete account/);
  assert.match(mobile, /appleDeleteHandoff/);
  assert.match(docs, /Private Email Relay/);
  assert.match(docs, /at least as prominent as the Google control/);
  assert.match(mobile, /appleButton: \{ width: '100%', height: 52 \}/);
  assert.match(mobile, /googleButton: \{ minHeight: 52/);
});


test('v1 routes stored friend runs and public profiles through the native parity surface', () => {
  const app = JSON.parse(read('mobile/app.json'));
  const linking = read('mobile/src/linking.ts');
  const draft = read('mobile/app/draft-run.tsx');
  const draftApi = read('mobile/src/api/draftRun.ts');
  const account = read('mobile/app/account.tsx');
  const gateway = read('edge/gateway.mjs');

  assert.ok(app.expo.ios.associatedDomains.includes('applinks:packone.pro'));
  const filter = app.expo.android.intentFilters.find((item) => item.action === 'VIEW' && item.autoVerify === true);
  assert.ok(filter);
  assert.ok(filter.data.some((item) => item.scheme === 'https' && item.host === 'packone.pro'));

  assert.match(linking, /\^\[a-f0-9\]\{24\}\$/);
  assert.match(linking, /\/draft-run\?shared=\$\{shared\}/);
  assert.match(linking, /\^\[a-f0-9\]\{16\}\$/);
  assert.match(linking, /\/profile\?key=\$\{publicProfile\}/);

  assert.match(draftApi, /loadSharedRun/);
  assert.match(draftApi, /startSharedDraftRun/);
  assert.match(draftApi, /\/draft\/v1\/shared-runs\//);
  assert.match(draft, /Play this run and compare/);
  assert.match(draft, /Scores so far/);
  assert.match(draft, /startSharedDraftRun/);
  assert.match(account, /returnToShared/);
  assert.match(account, /params: \{ shared: returnToShared \}/);

  assert.match(gateway, /shared-runs/);
  assert.match(gateway, /\[a-f0-9\]\{24\}/);
});


test('v1 manages existing Patreon Elite access natively without forking entitlement authority', () => {
  const account = read('mobile/app/account.tsx');
  const api = read('mobile/src/api/account.ts');
  const worker = read('worker/patreon.mjs');
  const gateway = read('edge/gateway.mjs');

  assert.match(api, /loadMobilePatreonStatus/);
  assert.match(api, /startMobilePatreonConnect/);
  assert.match(api, /disconnectMobilePatreon/);
  assert.match(api, /\/growth\/v1\/mobile\/patreon\/status/);
  assert.match(account, /Already a member\? Connect Patreon/);
  assert.match(account, /Refresh Patreon access/);
  assert.match(account, /Disconnect Patreon/);
  assert.match(account, /Pack One mobile does not sell or upgrade Elite/);
  assert.match(worker, /MOBILE_STATE_PREFIX='m'/);
  assert.match(worker, /mobileAccountIdentity/);
  assert.match(worker, /provider_oauth_states/);
  assert.match(worker, /entitlement_grants/);
  assert.match(gateway, /\/v1\/mobile\/patreon\/connect/);
  assert.match(gateway, /\/v1\/mobile\/patreon\/disconnect/);
});


test('v1 exposes the approved TCGplayer card destination only inside revealed score analysis', () => {
  const draft = read('mobile/app/draft-run.tsx');
  const helper = read('mobile/src/tcgplayer.ts');

  assert.match(helper, /https:\/\/www\.tcgplayer\.com\/search\/magic\/product/);
  assert.match(helper, /https:\/\/partner\.tcgplayer\.com\/c\/7742974\/1780961\/21018\?u=\{url\}/);
  assert.match(helper, /encodeURIComponent\(tcgplayerDestination\(cardName\)\)/);
  assert.match(draft, /Find on TCGplayer \(affiliate link\)/);
  assert.match(draft, /Pack One may earn a commission from eligible TCGplayer purchases at no added cost to you/);
  assert.match(draft, /<FeedbackAnalysis/);
  assert.doesNotMatch(read('mobile/app/index.tsx'), /TCGplayer/);
});
