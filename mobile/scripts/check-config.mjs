import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const storeRelease = JSON.parse(readFileSync(new URL('../store-release.json', import.meta.url), 'utf8'));
assert.equal(storeRelease.appStoreVersion, storeRelease.playVersionName);

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function loadConfig(profile, extraEnv = {}) {
  const result = spawnSync(npx, ['expo', 'config', '--type', 'public', '--json'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, ...extraEnv, PACKONE_BUILD_PROFILE: profile },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Expo config failed.');
  }
  return JSON.parse(result.stdout);
}

const development = loadConfig('development');
assert.equal(development.name, 'Pack One Dev');
assert.equal(development.ios.bundleIdentifier, 'pro.packone.development');
assert.equal(development.android.package, 'pro.packone.development');
assert.equal(development.scheme, 'packone');

const preview = loadConfig('preview');
assert.equal(preview.name, 'Pack One Preview');
assert.equal(preview.ios.bundleIdentifier, 'pro.packone.preview');
assert.equal(preview.android.package, 'pro.packone.preview');

const production = loadConfig('production');
assert.equal(production.name, 'Pack One');
assert.equal(production.version, storeRelease.appStoreVersion);
assert.equal(production.ios.bundleIdentifier, 'pro.packone.app');
assert.equal(production.android.package, 'pro.packone.app');
assert.equal(production.icon, './assets/images/icon.png');
assert.equal(production.extra.buildProfile, 'production');
assert.equal(production.extra?.eas?.projectId, undefined);

const numberedProduction = loadConfig('production', {
  PACKONE_IOS_BUILD_NUMBER: '100123',
  PACKONE_ANDROID_VERSION_CODE: '100123',
});
assert.equal(numberedProduction.ios.buildNumber, '100123');
assert.equal(numberedProduction.android.versionCode, 100123);

console.log('Expo native release config checks passed without EAS project linkage.');
