import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('native source and intended store marketing versions stay aligned', () => {
  const app = JSON.parse(read('mobile/app.json'));
  const release = JSON.parse(read('mobile/store-release.json'));
  assert.equal(app.expo.version, '1.1');
  assert.equal(release.appStoreVersion, '1.1');
  assert.equal(release.playVersionName, release.appStoreVersion);

  const preflight = read('mobile/scripts/release-preflight.mjs');
  assert.match(preflight, /config\.version !== storeRelease\.appStoreVersion/);
  assert.match(preflight, /App Store and Play marketing versions must match/);
});

test('store workflows cannot publish or use store credentials from arbitrary refs', () => {
  const workflowPaths = [
    '.github/workflows/ios-testflight.yml',
    '.github/workflows/android-internal-testing.yml',
    '.github/workflows/android-production-bundle.yml',
    '.github/workflows/android-closed-testing.yml',
    '.github/workflows/android-exact-aab-release.yml',
    '.github/workflows/google-play-access.yml',
    '.github/workflows/google-play-listing-assets.yml',
    '.github/workflows/google-play-feature-graphic.yml',
    '.github/workflows/google-play-data-safety.yml',
    '.github/workflows/app-store-subscription-access-probe.yml',
    '.github/workflows/app-store-app-availability.yml',
    '.github/workflows/ios-testflight-status.yml',
    '.github/workflows/android-internal-status.yml',
  ];
  for (const path of workflowPaths) {
    const workflow = read(path);
    assert.doesNotMatch(workflow, /chatgpt\/pack-one-mobile-v2-(?:ios-testflight|android-internal-testing)/, path);
    if (path === '.github/workflows/ios-testflight.yml') {
      assert.match(workflow, /github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'\)/, path);
      assert.match(workflow, /push:\s+branches: \[main\]\s+paths:\s+- '\.github\/testflight-release-request\.json'/s, path);
      assert.match(workflow, /request\.get\('operation'\) != 'upload-testflight-app-store-eligible'/, path);
      // Each fresh runner's automatic-signing certificate must be revoked, or the
      // team certificate limit eventually blocks archiving.
      assert.match(workflow, /app-store-runner-certificates\.mjs snapshot[\s\S]+- name: Archive signed Pack One app/, path);
      assert.match(workflow, /- name: Revoke the development certificate this runner created\s+if: always\(\)\s+continue-on-error: true\s+run: node \.\.\/\.github\/scripts\/app-store-runner-certificates\.mjs revoke/, path);
    } else if (path === '.github/workflows/android-internal-testing.yml') {
      assert.match(workflow, /github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'\)/, path);
      assert.match(workflow, /push:\s+branches: \[main\]\s+paths:\s+- '\.github\/android-internal-release-request\.json'/s, path);
      assert.match(workflow, /request\.get\('operation'\) != 'upload-android-internal'/, path);
    } else if (path === '.github/workflows/android-production-bundle.yml') {
      assert.match(workflow, /github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'\)/, path);
      assert.match(workflow, /push:\s+branches: \[main\]\s+paths:\s+- '\.github\/android-production-bundle-request\.json'/s, path);
      assert.match(workflow, /request\.get\('operation'\) != 'build-play-signed-aab'/, path);
      assert.match(workflow, /packone-android-upload-keystore-b64/, path);
      assert.match(workflow, /configure-android-upload-signing\.mjs/, path);
      assert.match(workflow, /83:BB:D7:ED:15:27:BA:BE:18:B6:E7:FD:92:F5:A3:50:BD:62:7B:2B/, path);
      assert.match(workflow, /pack-one-play-signed-aab/, path);
    } else if (path === '.github/workflows/android-closed-testing.yml') {
      assert.match(workflow, /github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'\)/, path);
      assert.match(workflow, /push:\s+branches: \[main\]\s+paths:\s+- '\.github\/android-closed-release-request\.json'/s, path);
      assert.match(workflow, /request\.get\('operation'\) != 'promote-android-closed'/, path);
      assert.match(workflow, /Verify live Universal Links and App Links associations/);
      assert.match(workflow, /Verify Google Play app-signing certificate matches assetlinks\.json/);
      assert.match(workflow, /track != 'production-access'/);
    } else if (path === '.github/workflows/android-exact-aab-release.yml') {
      assert.match(workflow, /github\.ref == 'refs\/heads\/main' && github\.event_name == 'push'/, path);
      assert.match(workflow, /push:\s+branches: \[main\]\s+paths:\s+- '\.github\/android-exact-aab-release-request\.json'/s, path);
      assert.match(workflow, /upload-promote-existing-android-aab/, path);
      assert.match(workflow, /actions: read/, path);
      assert.match(workflow, /git diff --name-only "\$source_sha" HEAD -- mobile\//, path);
      assert.match(workflow, /actions\/artifacts\/\$SOURCE_ARTIFACT_ID\/zip/, path);
      assert.match(workflow, /sha256sum "\$zip"/, path);
      assert.match(workflow, /83:BB:D7:ED:15:27:BA:BE:18:B6:E7:FD:92:F5:A3:50:BD:62:7B:2B/, path);
      assert.match(workflow, /play-exact-internal-release\.mjs/, path);
      assert.match(workflow, /verify-play-signing\.mjs/, path);
      assert.match(workflow, /play-closed-release\.mjs/, path);
      assert.doesNotMatch(workflow, /gradlew|expo prebuild|bundleRelease/, path);
      assert.doesNotMatch(workflow, /workflow_dispatch:/, path);
      assert.doesNotMatch(workflow, /pull_request:/, path);
    } else if (path === '.github/workflows/google-play-access.yml') {
      assert.match(workflow, /github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'\)/, path);
      assert.match(workflow, /push:\s+branches: \[main\]\s+paths:\s+- '\.github\/google-play-access-request\.json'/s, path);
      assert.match(workflow, /request\.get\('operation'\) != 'check-google-play-access'/, path);
      assert.doesNotMatch(workflow, /pull_request:/, path);
    } else if (path === '.github/workflows/google-play-feature-graphic.yml') {
      assert.ok(workflow.includes("github.ref == 'refs/heads/main' && github.event_name == 'push'"), path);
      assert.ok(workflow.includes(".github/google-play-feature-graphic-request.json"), path);
      assert.ok(workflow.includes("upload-google-play-feature-graphic"), path);
      assert.ok(workflow.includes("Pillow==11.3.0"), path);
      assert.ok(workflow.includes("ImageFile.LOAD_TRUNCATED_IMAGES = True"), path);
      assert.ok(workflow.includes("featureGraphic?uploadType=resumable"), path);
      assert.ok(workflow.includes("X-Upload-Content-Type: image/jpeg"), path);
      assert.ok(workflow.includes("Resumable session initialized successfully."), path);
      assert.ok(workflow.includes("Verified committed Google Play feature graphic count:"), path);
      assert.doesNotMatch(workflow, /phoneScreenshots/, path);
      assert.doesNotMatch(workflow, /\/tracks/, path);
      assert.doesNotMatch(workflow, /pull_request:/, path);
    } else if (path === '.github/workflows/google-play-data-safety.yml') {
      assert.ok(workflow.includes("github.ref == 'refs/heads/main' && github.event_name == 'push'"), path);
      assert.ok(workflow.includes(".github/google-play-data-safety-request.json"), path);
      assert.ok(workflow.includes("configure-google-play-data-safety"), path);
      assert.ok(workflow.includes("DATA_SAFETY_MODE"), path);
      assert.ok(workflow.includes("pack-one-data-safety.csv"), path);
      assert.ok(workflow.includes("https://www.googleapis.com/auth/androidpublisher"), path);
      assert.doesNotMatch(workflow, /\/tracks/, path);
      assert.doesNotMatch(workflow, /pull_request:/, path);
    } else if (path === '.github/workflows/google-play-listing-assets.yml') {
      assert.ok(workflow.includes("github.ref == 'refs/heads/main' && github.event_name == 'push'"), path);
      assert.ok(workflow.includes(".github/google-play-listing-assets-request.json"), path);
      assert.ok(workflow.includes("upload-google-play-listing-assets"), path);
      assert.ok(workflow.includes("phoneScreenshots"), path);
      assert.ok(workflow.includes("/icon"), path);
      assert.ok(workflow.includes("pack-one-p1-icon-512.png.b64"), path);
      assert.ok(workflow.includes("e44233fe8cab56f5de4f891bc04450411122b4c592d68228dd37f486de361640"), path);
      assert.ok(workflow.includes("SOURCE_ARTIFACT_ID"), path);
      assert.ok(workflow.includes("ARTIFACT_DIGEST"), path);
      assert.ok(workflow.includes("x.image?.id"), path);
      assert.ok(workflow.includes("Committed reviewed en-US Play icon and five phone screenshots."), path);
      assert.ok(workflow.includes("Verified committed Google Play phone screenshot count:"), path);
      assert.ok(workflow.includes("Verified committed Google Play app icon count:"), path);
      assert.doesNotMatch(workflow, /featureGraphic/, path);
      assert.doesNotMatch(workflow, /\/tracks/, path);
      assert.doesNotMatch(workflow, /pull_request:/, path);
    } else if (path === '.github/workflows/app-store-subscription-access-probe.yml') {
      assert.match(workflow, /github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'\)/, path);
      assert.match(workflow, /push:\s+branches: \[main\]\s+paths:\s+- '\.github\/app-store-subscription-access-request\.json'/s, path);
      assert.match(workflow, /request\.get\('operation'\) != 'probe-app-store-subscription-access'/, path);
      assert.doesNotMatch(workflow, /pull_request:/, path);
    } else if (path === '.github/workflows/app-store-app-availability.yml') {
      assert.match(workflow, /github\.ref == 'refs\/heads\/main' && github\.event_name == 'push'/, path);
      assert.match(workflow, /push:\s+branches: \[main\]\s+paths:\s+- '\.github\/app-store-app-availability-request\.json'/s, path);
      assert.match(workflow, /verify-app-store-availability/, path);
      assert.doesNotMatch(workflow, /workflow_dispatch:/, path);
      assert.doesNotMatch(workflow, /pull_request:/, path);
    } else if (path === '.github/workflows/android-internal-status.yml') {
      assert.match(workflow, /github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'\)/, path);
      assert.match(workflow, /push:\s+branches: \[main\]\s+paths:\s+- '\.github\/android-internal-status-request\.json'/s, path);
      assert.match(workflow, /request\.get\('operation'\) != 'check-android-internal-status'/, path);
    } else if (path === '.github/workflows/ios-testflight-status.yml') {
      assert.match(workflow, /github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'\)/, path);
      assert.match(workflow, /push:\s+branches: \[main\]\s+paths: \['\.github\/testflight-status-request\.json'\]/s, path);
      assert.match(workflow, /request\.operation !== 'read-pack-one-testflight-status'/, path);
      assert.match(workflow, /app-store-build-status\.mjs "\$\{\{ steps\.request\.outputs\.build_number \}\}"/, path);
      assert.doesNotMatch(workflow, /pull_request:|app-store-finalize-release-candidate|app-store-upload|xcodebuild/, path);
      const request = JSON.parse(read('.github/testflight-status-request.json'));
      assert.deepEqual(Object.keys(request).sort(), ['build_number', 'operation', 'reason']);
      assert.equal(request.operation, 'read-pack-one-testflight-status');
      assert.match(request.build_number, /^[1-9][0-9]*$/);
      assert.ok(request.reason.trim());
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
  assert.equal(iosRequest.operation, 'upload-testflight-app-store-eligible');
  assert.equal(typeof iosRequest.reason, 'string');
  assert.ok(iosRequest.reason.trim().length > 0);

  const androidRequest = JSON.parse(read('.github/android-internal-release-request.json'));
  assert.deepEqual(Object.keys(androidRequest).sort(), ['operation','reason']);
  assert.equal(androidRequest.operation, 'upload-android-internal');
  assert.equal(typeof androidRequest.reason, 'string');
  assert.ok(androidRequest.reason.trim().length > 0);

  const androidBundleRequest = JSON.parse(read('.github/android-production-bundle-request.json'));
  assert.deepEqual(Object.keys(androidBundleRequest).sort(), ['operation','reason']);
  assert.equal(androidBundleRequest.operation, 'build-play-signed-aab');
  assert.equal(typeof androidBundleRequest.reason, 'string');
  assert.ok(androidBundleRequest.reason.trim().length > 0);

  const androidClosedRequest = JSON.parse(read('.github/android-closed-release-request.json'));
  assert.deepEqual(Object.keys(androidClosedRequest).sort(), ['operation','reason','track','version_code']);
  assert.equal(androidClosedRequest.operation, 'promote-android-closed');
  assert.equal(androidClosedRequest.track, 'production-access');
  assert.match(String(androidClosedRequest.version_code), /^[1-9][0-9]*$/);
  assert.equal(typeof androidClosedRequest.reason, 'string');
  assert.ok(androidClosedRequest.reason.trim().length > 0);

  const exactAndroidRequest = JSON.parse(read('.github/android-exact-aab-release-request.json'));
  assert.deepEqual(Object.keys(exactAndroidRequest).sort(), ['artifact_digest','artifact_name','operation','reason','source_artifact_id','source_run_id','source_sha','track','version_code']);
  assert.equal(exactAndroidRequest.operation, 'upload-promote-existing-android-aab');
  assert.equal(exactAndroidRequest.source_run_id, 36957485029);
  assert.equal(exactAndroidRequest.source_artifact_id, 11206639352);
  assert.equal(exactAndroidRequest.source_sha, 'fa588b40bc380946735385abfac0ff52586e1873');
  assert.equal(exactAndroidRequest.artifact_name, 'pack-one-play-signed-aab');
  assert.equal(exactAndroidRequest.artifact_digest, 'sha256:9aa25360201435a68facc6ed25c21d965e883bcd1ae42204b2b7e4e0d219c20d');
  assert.equal(exactAndroidRequest.version_code, '100444');
  assert.equal(exactAndroidRequest.track, 'production-access');
  assert.equal(typeof exactAndroidRequest.reason, 'string');
  assert.ok(exactAndroidRequest.reason.trim().length > 0);

  const exactAndroidUpload = read('.github/scripts/play-exact-internal-release.mjs');
  assert.match(exactAndroidUpload, /expectedVersionCode/);
  assert.match(exactAndroidUpload, /versionCode!==expectedVersionCode/);
  assert.match(exactAndroidUpload, /Refusing to commit unexpected uploaded versionCode/);
  assert.match(exactAndroidUpload, /exactVersionVerified:true/);
  assert.match(exactAndroidUpload, /:commit/);
  assert.match(exactAndroidUpload, /method:'DELETE'/);

  const closedRelease = read('mobile/scripts/play-closed-release.mjs');
  assert.match(closedRelease, /releaseStatus = 'completed'/);
  assert.match(closedRelease, /releaseStatus = 'draft'/);
  assert.match(closedRelease, /requiresConsoleRollout = true/);
  assert.match(closedRelease, /Only releases with status draft may be created on draft app/);
  assert.match(closedRelease, /:validate/);
  assert.doesNotMatch(closedRelease, /upload\/androidpublisher/);
  const liveLinks = read('scripts/verify-live-mobile-links.mjs');
  assert.match(liveLinks, /app-site-association\.cdn-apple\.com\/a\/v1\/packone\.pro/);
  assert.match(liveLinks, /3564X3VTDB\.pro\.packone\.app/);
  assert.match(liveLinks, /7C:4F:B9:F7:0F:C6:A3:3C:94:F4:F9:29:93:22:65:77:34:CB:C0:4E:0B:F9:25:A7:A0:B8:42:51:30:72:3E:8B/);

  const playAccessRequest = JSON.parse(read('.github/google-play-access-request.json'));
  assert.deepEqual(Object.keys(playAccessRequest).sort(), ['operation','reason']);
  assert.equal(playAccessRequest.operation, 'check-google-play-access');
  assert.equal(typeof playAccessRequest.reason, 'string');
  assert.ok(playAccessRequest.reason.trim().length > 0);

  const appAvailabilityRequest = JSON.parse(read('.github/app-store-app-availability-request.json'));
  assert.deepEqual(Object.keys(appAvailabilityRequest).sort(), ['operation','reason','territories']);
  assert.equal(appAvailabilityRequest.operation, 'verify-app-store-availability');
  assert.deepEqual(appAvailabilityRequest.territories, ['USA','CAN']);
  assert.equal(typeof appAvailabilityRequest.reason, 'string');
  assert.ok(appAvailabilityRequest.reason.trim().length > 0);

  const appAvailabilityScript = read('.github/scripts/app-store-app-availability.mjs');
  assert.match(appAvailabilityScript, /appAvailabilityV2/);
  assert.match(appAvailabilityScript, /available\.join\(','\)!=='CAN,USA'/);
  assert.match(appAvailabilityScript, /preOrderEnabled===true/);
  assert.match(appAvailabilityScript, /PREORDER/);
  assert.match(appAvailabilityScript, /readOnly:true/);
  assert.doesNotMatch(appAvailabilityScript, /method:\s*['"]POST['"]/);
  assert.doesNotMatch(appAvailabilityScript, /method:\s*['"]PATCH['"]/);
  assert.doesNotMatch(appAvailabilityScript, /reviewSubmissions/);
  assert.doesNotMatch(appAvailabilityScript, /appStoreVersionReleaseRequests/);

  const dataSafetyRequest = JSON.parse(read('.github/google-play-data-safety-request.json'));
  assert.deepEqual(Object.keys(dataSafetyRequest).sort(), ['mode','operation','reason']);
  assert.equal(dataSafetyRequest.operation, 'configure-google-play-data-safety');
  assert.equal(dataSafetyRequest.mode, 'submit');
  assert.equal(typeof dataSafetyRequest.reason, 'string');
  assert.ok(dataSafetyRequest.reason.trim().length > 0);

  const dataSafetyScript = read('.github/scripts/google-play-data-safety.mjs');
  assert.match(dataSafetyScript, /PSL_DATA_COLLECTION_ENCRYPTED_IN_TRANSIT','TRUE'/);
  assert.match(dataSafetyScript, /PSL_DATA_COLLECTION_USER_REQUEST_DELETE','TRUE'/);
  assert.match(dataSafetyScript, /name:'Other actions'/);
  assert.match(dataSafetyScript, /PSL_DATA_USAGE_ONLY_COLLECTED/);
  assert.match(dataSafetyScript, /PSL_SUPPORTED_ACCOUNT_CREATION_METHODS/);
  assert.match(dataSafetyScript, /PSL_ACM_USER_ID_PASSWORD/);
  assert.match(dataSafetyScript, /PSL_ACM_OAUTH/);
  assert.match(dataSafetyScript, /PSL_ACCOUNT_DELETION_URL/);
  assert.match(dataSafetyScript, /https:\/\/packone\.pro\/privacy\/#delete-account/);
  assert.match(dataSafetyScript, /PSL_SUPPORT_DATA_DELETION_BY_USER/);
  assert.match(dataSafetyScript, /DATA_DELETION_NO/);
  assert.match(dataSafetyScript, /Unexpected sharing declarations/);
  assert.match(dataSafetyScript, /Advertising\/marketing purpose must not be selected/);

  const playFeatureRequest = JSON.parse(read('.github/google-play-feature-graphic-request.json'));
  assert.deepEqual(Object.keys(playFeatureRequest).sort(), ['language','operation','reason','source_png_sha256']);
  assert.equal(playFeatureRequest.operation, 'upload-google-play-feature-graphic');
  assert.equal(playFeatureRequest.language, 'en-US');
  assert.equal(playFeatureRequest.source_png_sha256, '56ef62740b03173123c1d1b0f3dfcb83e4d11227be755acd8202a32989de2e69');
  assert.equal(typeof playFeatureRequest.reason, 'string');
  assert.ok(playFeatureRequest.reason.trim().length > 0);

  const playListingRequest = JSON.parse(read('.github/google-play-listing-assets-request.json'));
  assert.deepEqual(Object.keys(playListingRequest).sort(), ['artifact_digest','language','operation','reason','source_artifact_id','source_run_id','source_sha']);
  assert.equal(playListingRequest.operation, 'upload-google-play-listing-assets');
  assert.equal(playListingRequest.language, 'en-US');
  assert.match(playListingRequest.source_sha, /^[a-f0-9]{40}$/);
  assert.match(playListingRequest.artifact_digest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(Number.isInteger(playListingRequest.source_run_id) && playListingRequest.source_run_id > 0);
  assert.ok(Number.isInteger(playListingRequest.source_artifact_id) && playListingRequest.source_artifact_id > 0);
  assert.equal(typeof playListingRequest.reason, 'string');
  assert.ok(playListingRequest.reason.trim().length > 0);

  const appleSubscriptionAccessRequest = JSON.parse(read('.github/app-store-subscription-access-request.json'));
  assert.deepEqual(Object.keys(appleSubscriptionAccessRequest).sort(), ['operation','reason']);
  assert.equal(appleSubscriptionAccessRequest.operation, 'probe-app-store-subscription-access');
  assert.equal(typeof appleSubscriptionAccessRequest.reason, 'string');
  assert.ok(appleSubscriptionAccessRequest.reason.trim().length > 0);

  const appleSubscriptionProbe = read('.github/scripts/app-store-subscription-access-probe.mjs');
  assert.match(appleSubscriptionProbe, /pro\.packone\.app\.elite\.monthly/);
  assert.match(appleSubscriptionProbe, /subscriptionGroups/);
  assert.match(appleSubscriptionProbe, /canManageSubscriptions/);

  const androidStatusRequest = JSON.parse(read('.github/android-internal-status-request.json'));
  assert.deepEqual(Object.keys(androidStatusRequest).sort(), ['operation','reason']);
  assert.equal(androidStatusRequest.operation, 'check-android-internal-status');
  assert.equal(typeof androidStatusRequest.reason, 'string');
  assert.ok(androidStatusRequest.reason.trim().length > 0);

  assert.match(ios, /CFBundleShortVersionString/);
  assert.match(ios, /testFlightInternalTestingOnly[\s\S]*<false\/>/);
  assert.match(ios, /app-store-finalize-release-candidate\.mjs/);
  const iosFinalize = read('.github/scripts/app-store-finalize-release-candidate.mjs');
  assert.match(iosFinalize, /APP_STORE_ELIGIBLE/);
  assert.match(iosFinalize, /INTERNAL_ONLY/);
  assert.match(iosFinalize, /relationships\/build/);
  assert.match(iosFinalize, /reviewSubmissionCreated: false/);
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


test('v1 cold-start gate keeps navigation mounted across foreground revalidation', () => {
  const layout = read('mobile/app/_layout.tsx');
  const gate = read('mobile/src/components/VersionGate.tsx');
  const boundary = read('mobile/src/components/VersionGateBoundary.js');
  const lifecycle = read('mobile/tests/version-gate-lifecycle.test.cjs');
  const policy = read('mobile/src/versionPolicy.ts');
  const gateway = read('edge/gateway.mjs');
  const releaseWorkflow = read('.github/workflows/secure-auth-release.yml');
  const pkg = JSON.parse(read('mobile/package.json'));

  assert.match(layout, /<VersionGate>/);
  assert.equal(pkg.dependencies['expo-application'], '~57.0.3');
  assert.equal(pkg.devDependencies['react-test-renderer'], '19.2.3');
  assert.match(pkg.scripts['test:lifecycle'], /node --test/);
  assert.match(pkg.scripts.test, /test:lifecycle/);
  assert.match(gate, /Application\.nativeApplicationVersion/);
  assert.match(gate, /Application\.nativeBuildVersion/);
  assert.match(gate, /VersionGateBoundary/);
  assert.match(gate, /initialAppState=\{AppState\.currentState\}/);
  assert.match(boundary, /requestIdRef/);
  assert.match(boundary, /requestId === requestIdRef\.current/);
  assert.match(boundary, /Foreground checks intentionally do not clear the current decision/);
  assert.match(lifecycle, /foreground allowed, delayed, and failed checks preserve mounted child state/);
  assert.match(lifecycle, /newer foreground decision wins over an older overlapping check/);
  assert.match(lifecycle, /validated update-required foreground decision blocks/);
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
  const account = read('mobile/app/account.tsx');
  const deletion = read('mobile/app/account-delete.tsx');
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
  assert.match(deletion, /Verify with Apple and delete account/);
  assert.match(deletion, /appleDeleteHandoff/);
  assert.match(deletion, /Deleting your Pack One account does not cancel subscriptions/);
  assert.match(deletion, /Manage subscription/);
  assert.match(docs, /Private Email Relay/);
  assert.match(docs, /at least as prominent as the Google control/);
  assert.match(account, /appleButton: \{ width: '100%', height: 52 \}/);
  assert.match(account, /googleButton: \{ minHeight: 52/);
});
