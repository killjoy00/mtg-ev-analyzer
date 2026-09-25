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
    assert.match(workflow, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/, path);
    assert.match(workflow, /environment: pack-one-mobile-release/, path);
    assert.match(workflow, /git fetch --no-tags --depth=1 origin main/, path);
    assert.match(workflow, /git rev-parse FETCH_HEAD/, path);
  }

  const ios = read('.github/workflows/ios-testflight.yml');
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
