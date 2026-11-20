#!/usr/bin/env node
/**
 * Assert actual unsigned Android preview APK contains the Google sample
 * AdMob runtime config, not merely the intended prebuild environment.
 * This prevents a false "ad broken" diagnosis if Gradle embeds dev defaults.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const [apkPath] = process.argv.slice(2);
if (!apkPath) throw new Error('Usage: node scripts/check-android-preview-admob-apk.mjs <preview.apk>');

let raw;
try {
  raw = execFileSync('unzip', ['-p', apkPath, 'assets/app.config'], {
    encoding: 'utf8', maxBuffer: 5 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch {
  throw new Error('Android preview APK must contain readable assets/app.config.');
}

let runtime;
try {
  runtime = JSON.parse(raw);
} catch {
  throw new Error('Android preview APK embedded assets/app.config is not valid JSON.');
}

assert.equal(runtime.name, 'Pack One Preview', 'Preview test APK embedded an unexpected app name');
assert.equal(runtime.extra?.buildProfile, 'preview', 'Preview APK embedded the wrong runtime build profile');
assert.equal(runtime.android?.package, 'pro.packone.preview', 'Preview APK package is not isolated');
const ad = runtime.extra?.adMob;
assert.equal(ad?.androidEnabled, true, 'Preview APK must actually enable sample Android ads');
assert.equal(ad?.testBanners, true, 'Preview APK must use sample ads');
assert.equal(ad?.androidBannerUnitId, 'ca-app-pub-3940256099942544/6300978111',
  'Preview APK must embed the official Google Android sample banner unit');
assert.equal(ad?.iosEnabled, true, 'Expected existing all-platform preview sample ads');
assert.notEqual(ad.androidBannerUnitId, 'ca-app-pub-1217971050094766/8963799298',
  'Preview APK must never request the real Pack One Android banner');
console.log('Verified actual preview APK: preview profile, isolated package, Google sample AdMob enabled.');
