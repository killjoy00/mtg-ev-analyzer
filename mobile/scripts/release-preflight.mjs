import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const production = process.argv.includes('--production')
  || process.env.PACKONE_BUILD_PROFILE === 'production';

if (!production) {
  console.log('Non-production build: release artwork preflight skipped.');
  process.exit(0);
}

const requiredEnvironment = [
  'PACKONE_IOS_BUNDLE_IDENTIFIER',
  'PACKONE_ANDROID_PACKAGE',
  'PACKONE_EXPO_PROJECT_ID',
];

const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]?.trim());

const requiredArtwork = [
  'assets/images/icon.png',
  'assets/images/splash-icon.png',
  'assets/images/adaptive-icon.png',
  'assets/images/monochrome-icon.png',
];

const missingArtwork = requiredArtwork.filter((path) => !existsSync(resolve(process.cwd(), path)));

if (missingEnvironment.length || missingArtwork.length) {
  const problems = [
    missingEnvironment.length ? `Missing production EAS values: ${missingEnvironment.join(', ')}` : null,
    missingArtwork.length ? `Missing release artwork: ${missingArtwork.join(', ')}` : null,
  ].filter(Boolean);
  throw new Error(`Pack One production preflight failed. ${problems.join('. ')}.`);
}

console.log('Pack One production release preflight passed.');
