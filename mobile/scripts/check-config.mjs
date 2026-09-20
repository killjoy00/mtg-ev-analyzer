import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function loadConfig(extraEnv) {
  const result = spawnSync(npx, ['expo', 'config', '--type', 'public', '--json'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Expo config failed.');
  }
  return JSON.parse(result.stdout);
}

function configFails(extraEnv) {
  const result = spawnSync(npx, ['expo', 'config', '--type', 'public', '--json'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  });
  return result.status !== 0;
}

const development = loadConfig({
  PACKONE_BUILD_PROFILE: 'development',
  PACKONE_IOS_BUNDLE_IDENTIFIER: '',
  PACKONE_ANDROID_PACKAGE: '',
  PACKONE_EXPO_PROJECT_ID: '',
});
assert.equal(development.name, 'Pack One Dev');
assert.equal(development.ios.bundleIdentifier, 'pro.packone.development');
assert.equal(development.android.package, 'pro.packone.development');
assert.equal(development.scheme, 'packone');

const preview = loadConfig({
  PACKONE_BUILD_PROFILE: 'preview',
  PACKONE_IOS_BUNDLE_IDENTIFIER: '',
  PACKONE_ANDROID_PACKAGE: '',
  PACKONE_EXPO_PROJECT_ID: '',
});
assert.equal(preview.name, 'Pack One Preview');
assert.equal(preview.ios.bundleIdentifier, 'pro.packone.preview');
assert.equal(preview.android.package, 'pro.packone.preview');

const production = loadConfig({
  PACKONE_BUILD_PROFILE: 'production',
  PACKONE_IOS_BUNDLE_IDENTIFIER: 'pro.packone.releasecheck',
  PACKONE_ANDROID_PACKAGE: 'pro.packone.releasecheck',
  PACKONE_EXPO_PROJECT_ID: '123e4567-e89b-42d3-a456-426614174000',
});
assert.equal(production.name, 'Pack One');
assert.equal(production.ios.bundleIdentifier, 'pro.packone.releasecheck');
assert.equal(production.android.package, 'pro.packone.releasecheck');
assert.equal(production.extra.eas.projectId, '123e4567-e89b-42d3-a456-426614174000');
assert.equal(production.extra.buildProfile, 'production');

assert.equal(
  configFails({
    PACKONE_BUILD_PROFILE: 'production',
    PACKONE_IOS_BUNDLE_IDENTIFIER: '',
    PACKONE_ANDROID_PACKAGE: '',
    PACKONE_EXPO_PROJECT_ID: '',
  }),
  true,
  'Production config must fail closed when irreversible store identity is missing.',
);

console.log('Expo release config checks passed.');
