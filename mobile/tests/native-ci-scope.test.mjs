import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyNativeChanges, filterNativeChangedPaths } from '../scripts/native-ci-scope.mjs';

const full = (paths) => assert.equal(classifyNativeChanges(paths).nativeFull, true, paths.join(', '));
const fast = (paths) => assert.equal(classifyNativeChanges(paths).nativeFull, false, paths.join(', '));

test('JS and TS-only mobile changes use the native fast path', () => {
  fast([
    'mobile/app/index.tsx',
    'mobile/app/account.tsx',
    'mobile/src/api/client.ts',
    'mobile/src/components/Card.tsx',
    'mobile/tests/profile-browsing.test.cjs',
  ]);
});

test('native inputs and classifier infrastructure force the full path', () => {
  for (const path of [
    'mobile/package.json',
    'mobile/package-lock.json',
    'mobile/.node-version',
    'mobile/app.json',
    'mobile/app.config.ts',
    'mobile/store-release.json',
    'mobile/assets/images/icon.png',
    'mobile/scripts/audit-ios-archive.py',
    'mobile/scripts/configure-android-upload-signing.mjs',
    'mobile/plugins/with-pack-one.js',
    'mobile/config-plugins/with-pack-one.js',
    'mobile/scripts/native-ci-scope.mjs',
    'mobile/tests/native-ci-scope.test.mjs',
    'mobile/tests/gradle-cache-key.test.mjs',
    'scripts/audit-android-manifest.py',
    '.github/scripts/app-store-finalize-release-candidate.mjs',
    '.github/scripts/app-store-next-build-number.mjs',
    '.github/workflows/android-production-bundle.yml',
    '.github/workflows/android-internal-testing.yml',
    '.github/workflows/ios-testflight.yml',
    '.github/workflows/mobile-exact-main-rc.yml',
    '.github/workflows/mobile.yml',
  ]) full([path]);
});

test('mixed PR noise outside native inputs is filtered before classification', () => {
  const paths = ['mobile/app/index.tsx', 'docs/mobile.md', 'worker/account-session.mjs', 'tests/unit.test.mjs', 'web-only.mjs'];
  assert.deepEqual(filterNativeChangedPaths(paths), ['mobile/app/index.tsx']);
  fast(paths);
});

test('unknown mobile paths and empty or fully-filtered diffs fail closed to full native validation', () => {
  full(['mobile/metro.config.js']);
  full(['mobile/native-plugin/custom.js']);
  full([]);
  full(['docs/release.md', 'worker/account-session.mjs']);
});
