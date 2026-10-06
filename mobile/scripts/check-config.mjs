import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const storeRelease = JSON.parse(readFileSync(new URL('../store-release.json', import.meta.url), 'utf8'));
const appJson = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const secureStorePlugin = appJson.expo?.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-secure-store',
);
assert.ok(secureStorePlugin, 'expo-secure-store must remain explicitly configured');
assert.equal(
  secureStorePlugin[1]?.faceIDPermission,
  false,
  'Pack One does not use biometric SecureStore access; production must not declare Face ID usage',
);
assert.deepEqual(
  new Set(appJson.expo?.android?.blockedPermissions || []),
  new Set([
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
  ]),
  'legacy external-storage permissions must remain blocked from generated Android manifests',
);

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function loadConfig(profile, extraEnv = {}) {
  const env = { ...process.env, PACKONE_BUILD_PROFILE: profile };
  delete env.PACKONE_IOS_MARKETING_VERSION;
  Object.assign(env, extraEnv);
  const result = spawnSync(npx, ['expo', 'config', '--type', 'public', '--json'], {
    cwd: new URL('..', import.meta.url),
    env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Expo config failed.');
  }
  return JSON.parse(result.stdout);
}


function autolinkedPackageNames(platform) {
  const result = spawnSync(npx, ['expo-modules-autolinking', 'resolve', '--platform', platform, '--json'], {
    cwd: new URL('..', import.meta.url),
    env: process.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Expo autolinking failed for ${platform}.`);
  }
  const resolved = JSON.parse(result.stdout);
  return new Set((resolved.modules || []).map((module) => module.packageName));
}

const androidModules = autolinkedPackageNames('android');
const appleModules = autolinkedPackageNames('apple');
assert.equal(androidModules.has('expo-iap'), false, 'expo-iap must stay out of Android native autolinking');
assert.equal(appleModules.has('expo-iap'), true, 'expo-iap must remain linked for Apple StoreKit builds');

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
assert.equal(production.version, storeRelease.playVersionName);
assert.equal(production.ios.bundleIdentifier, 'pro.packone.app');
assert.equal(production.android.package, 'pro.packone.app');
assert.equal(production.icon, './assets/images/icon.png');
assert.deepEqual(production.android.adaptiveIcon, {
  foregroundImage: './assets/images/adaptive-icon-foreground.png',
  monochromeImage: './assets/images/adaptive-icon-monochrome.png',
  backgroundColor: '#1E4D7A',
});
assert.equal(production.android.edgeToEdgeEnabled, undefined);
assert.equal(production.extra.buildProfile, 'production');
assert.equal(production.extra?.eas?.projectId, undefined);
assert.deepEqual(
  new Set(production.android.blockedPermissions || []),
  new Set([
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.USE_BIOMETRIC',
    'android.permission.USE_FINGERPRINT',
  ]),
);

const numberedProduction = loadConfig('production', {
  PACKONE_IOS_BUILD_NUMBER: '100123',
  PACKONE_ANDROID_VERSION_CODE: '100123',
});
assert.equal(numberedProduction.ios.buildNumber, '100123');
assert.equal(numberedProduction.android.versionCode, 100123);

const iosProduction = loadConfig('production', {
  PACKONE_IOS_MARKETING_VERSION: storeRelease.appStoreVersion,
});
assert.equal(iosProduction.version, storeRelease.appStoreVersion);
assert.equal(production.version, storeRelease.playVersionName);

console.log('Expo native release config checks passed with platform-specific store marketing versions, iOS-only IAP autolinking and without EAS project linkage.');
