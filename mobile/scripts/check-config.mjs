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
  for (const key of [
    'PACKONE_ADMOB_IOS_ENABLED', 'PACKONE_ADMOB_ANDROID_ENABLED',
    'PACKONE_ADMOB_IOS_APP_ID', 'PACKONE_ADMOB_IOS_BANNER_ID',
    'PACKONE_ADMOB_ANDROID_APP_ID', 'PACKONE_ADMOB_ANDROID_BANNER_ID',
    'PACKONE_ADMOB_TEST_BANNERS',
  ]) delete env[key];
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
assert.equal(development.extra.adMob.iosEnabled, false);
assert.equal(development.extra.adMob.androidEnabled, false);
assert.equal(development.plugins.some(plugin => Array.isArray(plugin) && plugin[0] === 'react-native-google-mobile-ads'), true);
assert.ok(development.plugins.includes('./plugins/with-admob-rdp.cjs'), 'native builds must install the RDP startup plugin');

const preview = loadConfig('preview');
assert.equal(preview.name, 'Pack One Preview');
assert.equal(preview.ios.bundleIdentifier, 'pro.packone.preview');
assert.equal(preview.android.package, 'pro.packone.preview');

const production = loadConfig('production');
const productionBuildProperties = production.plugins.find(plugin =>
  Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
assert.equal(productionBuildProperties?.[1]?.android?.enableMinifyInReleaseBuilds, true,
  'Android Production must enable R8 obfuscation for Play DEX optimization');
assert.equal(productionBuildProperties?.[1]?.android?.enableShrinkResourcesInReleaseBuilds, true,
  'Android Production must shrink resources with R8');
const previewBuildProperties = preview.plugins.find(plugin =>
  Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
assert.equal(previewBuildProperties?.[1]?.android?.enableMinifyInReleaseBuilds, undefined,
  'R8 should not slow down preview or make native diagnostics opaque');
assert.equal(production.name, 'Pack One');
assert.equal(production.version, storeRelease.playVersionName);
assert.equal(production.ios.bundleIdentifier, 'pro.packone.app');
assert.equal(production.android.package, 'pro.packone.app');
const productionAppLinks = (production.android.intentFilters || [])
  .filter(filter => filter.action === 'VIEW' && filter.autoVerify === true
    && filter.category?.includes('BROWSABLE') && filter.category?.includes('DEFAULT'))
  .flatMap(filter => filter.data || [])
  .filter(link => link.scheme === 'https' && link.host === 'packone.pro');
assert.deepEqual(productionAppLinks.filter(link => link.path).map(link => link.path).sort(),
  ['/d/', '/d/c/', '/d/l/'], 'production Android must register the exact short Daily paths');
assert.deepEqual(productionAppLinks.filter(link => link.pathPrefix).map(link => link.pathPrefix).sort(),
  ['/creator/', '/open/daily/', '/open/profile/', '/open/shared/'],
  'existing Android App Links must remain narrow');

assert.equal(production.icon, './assets/images/icon.png');
assert.deepEqual(production.android.adaptiveIcon, {
  foregroundImage: './assets/images/adaptive-icon-foreground.png',
  monochromeImage: './assets/images/adaptive-icon-monochrome.png',
  backgroundColor: '#1E4D7A',
});
assert.equal(production.android.edgeToEdgeEnabled, undefined);
assert.equal(production.extra.buildProfile, 'production');
assert.equal(production.extra.adMob.iosEnabled, false, 'production AdMob is opt-in');
assert.equal(production.extra.adMob.androidEnabled, false, 'production AdMob is opt-in');
const productionAdsPlugin = production.plugins.find(plugin =>
  Array.isArray(plugin) && plugin[0] === 'react-native-google-mobile-ads');
assert.equal(productionAdsPlugin?.[1]?.iosAppId, 'ca-app-pub-1217971050094766~3792911821',
  'iOS native Info.plist must use Pack One, not the Google sample App ID');
assert.equal(productionAdsPlugin?.[1]?.androidAppId, 'ca-app-pub-1217971050094766~5084711148',
  'Android production embeds the verified Android App ID, even while live ads are disabled');
assert.equal(production.extra.adMob.iosBannerUnitId, undefined,
  'disabled production builds must not publish any iOS banner unit');
assert.equal(production.extra.adMob.androidBannerUnitId, undefined,
  'disabled production builds must not publish any Android banner unit');
assert.equal(readFileSync(new URL('../../app-ads.txt', import.meta.url), 'utf8').trim(),
  'google.com, pub-1217971050094766, DIRECT, f08c47fec0942fa0',
  'Pack One app-ads.txt must match the registered iOS AdMob publisher');
const testAdsPreview = loadConfig('preview', { PACKONE_ADMOB_TEST_BANNERS: '1' });
assert.equal(testAdsPreview.extra.adMob.testBanners, true);
assert.equal(testAdsPreview.extra.adMob.iosEnabled, true);
assert.match(testAdsPreview.extra.adMob.iosBannerUnitId, /^ca-app-pub-3940256099942544\//);
const liveIos = loadConfig('production', { PACKONE_ADMOB_IOS_ENABLED: '1' });
assert.equal(liveIos.extra.adMob.iosEnabled, true);
assert.equal(liveIos.extra.adMob.androidEnabled, false);
assert.equal(liveIos.extra.adMob.iosBannerUnitId, 'ca-app-pub-1217971050094766/8989398185');
assert.equal(liveIos.plugins.find(plugin => Array.isArray(plugin)
  && plugin[0] === 'react-native-google-mobile-ads')?.[1]?.iosAppId,
  'ca-app-pub-1217971050094766~3792911821');
assert.equal(liveIos.extra.adMob.testBanners, false);
assert.equal(production.plugins.some(plugin => Array.isArray(plugin)
  && plugin[0] === 'react-native-google-mobile-ads'
  && plugin[1].delayAppMeasurementInit === true), true);

const fakeAndroidAppId = 'ca-app-pub-1234567890123456~0123456789';
const fakeAndroidBannerId = 'ca-app-pub-1234567890123456/0123456789';
const androidAds = loadConfig('production', {
  PACKONE_ADMOB_ANDROID_ENABLED: '1',
  PACKONE_ADMOB_ANDROID_APP_ID: fakeAndroidAppId,
  PACKONE_ADMOB_ANDROID_BANNER_ID: fakeAndroidBannerId,
});
assert.equal(androidAds.extra.adMob.androidEnabled, true);
assert.equal(androidAds.extra.adMob.iosEnabled, false);
assert.equal(androidAds.extra.adMob.androidBannerUnitId, fakeAndroidBannerId);
assert.equal(androidAds.extra.adMob.iosBannerUnitId, undefined);
assert.equal(androidAds.extra.adMob.testBanners, false);
assert.equal(androidAds.plugins.find(plugin => Array.isArray(plugin)
  && plugin[0] === 'react-native-google-mobile-ads')?.[1]?.androidAppId, fakeAndroidAppId);
assert.equal(androidAds.android.blockedPermissions.includes('com.google.android.gms.permission.AD_ID'), false,
  'Google advertising ID is permitted only in explicitly enabled Android AdMob builds');
assert.equal(production.android.blockedPermissions.includes('com.google.android.gms.permission.AD_ID'), true);
const registeredAndroid = loadConfig('production', { PACKONE_ADMOB_ANDROID_ENABLED: '1' });
assert.equal(registeredAndroid.extra.adMob.androidEnabled, true);
assert.equal(registeredAndroid.extra.adMob.iosEnabled, false);
assert.equal(registeredAndroid.extra.adMob.androidBannerUnitId,
  'ca-app-pub-1217971050094766/8963799298',
  'enabled Android production uses the owner-registered banner unit');
assert.equal(registeredAndroid.plugins.find(plugin => Array.isArray(plugin)
  && plugin[0] === 'react-native-google-mobile-ads')?.[1]?.androidAppId,
  'ca-app-pub-1217971050094766~5084711148');
assert.equal(registeredAndroid.android.blockedPermissions.includes('com.google.android.gms.permission.AD_ID'), false);
assert.throws(() => loadConfig('production', {
  PACKONE_ADMOB_ANDROID_ENABLED: '1',
  PACKONE_ADMOB_ANDROID_APP_ID: 'ca-app-pub-3940256099942544~3347511713',
  PACKONE_ADMOB_ANDROID_BANNER_ID: 'ca-app-pub-3940256099942544/6300978111',
}), /Live AdMob requires matching, non-demo/,
'production must never use Google test AdMob IDs');
assert.throws(() => loadConfig('production', {
  PACKONE_ADMOB_ANDROID_ENABLED: '1',
  PACKONE_ADMOB_ANDROID_APP_ID: fakeAndroidAppId,
  PACKONE_ADMOB_ANDROID_BANNER_ID: 'ca-app-pub-9999999999999999/0123456789',
}), /Live AdMob requires matching, non-demo/, 'App and banner must share a publisher');
assert.equal(testAdsPreview.extra.adMob.androidEnabled, true);
assert.equal(testAdsPreview.extra.adMob.androidBannerUnitId, 'ca-app-pub-3940256099942544/6300978111');
assert.throws(() => loadConfig('production', {
  PACKONE_ADMOB_ANDROID_ENABLED: '1',
  PACKONE_ADMOB_ANDROID_APP_ID: 'ca-app-pub-1217971050094766~3792911821',
  PACKONE_ADMOB_ANDROID_BANNER_ID: 'ca-app-pub-1217971050094766/8989398185',
}), /Android AdMob App ID must not reuse/, 'a native Android app needs its own AdMob App ID');

assert.equal(production.extra?.eas?.projectId, undefined);
assert.deepEqual(
  new Set(production.android.blockedPermissions || []),
  new Set([
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'com.google.android.gms.permission.AD_ID',
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

console.log('Expo native release config checks passed with platform-specific AdMob privacy gates, store marketing versions, iOS-only IAP autolinking and without EAS project linkage.');
