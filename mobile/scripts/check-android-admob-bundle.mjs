#!/usr/bin/env node
/**
 * Inspect the Expo runtime configuration embedded in the ACTUAL Android AAB.
 *
 * expo prebuild validates native configuration but Gradle separately runs
 * Expo's configuration generator to package base/assets/app.config. Without
 * PACKONE_BUILD_PROFILE in Gradle's environment, the embedded runtime flag
 * silently falls back to development and disables all native ad placements.
 *
 * The expected advertising mode is a required independent argument derived
 * from the reviewed release request, never from the embedded configuration.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const [bundlePath, expectedMode] = process.argv.slice(2);
if (!bundlePath || !['enabled', 'disabled'].includes(expectedMode)) {
  throw new Error('Usage: node scripts/check-android-admob-bundle.mjs <release.aab> <enabled|disabled>');
}

let raw;
try {
  raw = execFileSync('unzip', ['-p', bundlePath, 'base/assets/app.config'], {
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch {
  throw new Error('Release AAB must contain readable base/assets/app.config.');
}
assert.ok(raw.trim(), 'Embedded Android Expo app.config must not be empty');

let runtime;
try {
  runtime = JSON.parse(raw);
} catch {
  throw new Error('Embedded Android Expo app.config is not valid JSON.');
}

assert.equal(runtime.name, 'Pack One', 'AAB embedded non-production app name (Pack One Dev?)');
assert.equal(runtime.extra?.buildProfile, 'production', 'AAB embedded Expo runtime profile must be production');
assert.equal(runtime.android?.package, 'pro.packone.app', 'AAB embedded package name is not Pack One Production');
assert.equal(runtime.extra?.adMob?.iosEnabled, false, 'Android AAB must not enable the iOS AdMob unit');
assert.equal(runtime.extra?.adMob?.testBanners, false, 'Production AAB must not include test AdMob banners');

const ad = runtime.extra?.adMob;
if (expectedMode === 'enabled') {
  assert.equal(ad?.androidEnabled, true, 'AAB embedded Android AdMob runtime switch must be true');
  assert.equal(ad?.androidBannerUnitId, 'ca-app-pub-1217971050094766/8963799298',
    'AAB embedded Android banner must use the registered Pack One Daily unit');
} else {
  assert.equal(ad?.androidEnabled, false, 'AAB embedded Android AdMob runtime switch must remain false');
  assert.equal(ad?.androidBannerUnitId, undefined,
    'Ad-disabled AAB must not embed a runnable Android banner unit');
}
assert.equal(ad?.iosBannerUnitId, undefined, 'Android AAB must not embed a live iOS banner unit');

console.log(`Verified embedded AAB runtime config: production profile, Android AdMob ${expectedMode}, correct banner policy.`);
