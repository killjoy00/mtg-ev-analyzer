#!/usr/bin/env node
/**
 * Confirm that Xcode actually embedded the production AdMob settings in the
 * app archive. Expo generates EXConstants.bundle/app.config during xcodebuild;
 * validating "expo config" before archiving cannot catch a missing build
 * profile in the Xcode subprocess.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const archivePath = process.argv[2];
if (!archivePath) {
  throw new Error('Usage: node scripts/check-ios-admob-archive.mjs <PackOne.xcarchive>');
}
const appPath = path.join(archivePath, 'Products', 'Applications', 'PackOne.app');
const candidates = [
  path.join(appPath, 'EXConstants.bundle', 'app.config'),
  path.join(appPath, 'EXConstants.bundle', 'Contents', 'Resources', 'app.config'),
];
const configPath = candidates.find(existsSync);
if (!configPath) {
  throw new Error('Signed or unsigned iOS archive has no embedded Expo app.config (EXConstants.bundle).');
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
assert.equal(config.extra?.buildProfile, 'production', 'Archived Expo runtime profile must be production');
assert.equal(config.ios?.bundleIdentifier, 'pro.packone.app', 'Archived Expo runtime bundle ID drifted');
assert.equal(config.version, '1.4', 'Archived Expo runtime marketing version drifted');
assert.equal(config.extra?.adMob?.iosEnabled, true, 'Archived iOS AdMob flag must be enabled');
assert.equal(config.extra?.adMob?.androidEnabled, false, 'Archived Android AdMob flag must remain disabled');
assert.equal(config.extra?.adMob?.testBanners, false, 'Archived build must not use sample ads');
assert.equal(
  config.extra?.adMob?.iosBannerUnitId,
  'ca-app-pub-1217971050094766/8989398185',
  'Archived iOS banner unit must be the approved live unit',
);
console.log('Verified archived Expo runtime config: production profile and live iOS AdMob enabled.');
