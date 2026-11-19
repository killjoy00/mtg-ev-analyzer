import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGradleCacheKey, normalizeGradleConfig } from '../scripts/gradle-cache-key.mjs';

const baseFiles = ({ versionCode = 100123, versionName = '1.0', lock = '{"lockfileVersion":3}', wrapper = 'distributionUrl=gradle-9.0-bin.zip' } = {}) => [
  { path: 'package-lock.json', content: lock },
  { path: 'android/gradle/wrapper/gradle-wrapper.properties', content: wrapper },
  { path: 'android/settings.gradle', content: 'pluginManagement { repositories { google(); mavenCentral() } }' },
  { path: 'android/build.gradle', content: 'plugins { id "com.android.application" version "8.9.1" apply false }' },
  { path: 'android/app/build.gradle', content: `android { defaultConfig { versionCode ${versionCode}; versionName "${versionName}" } }\n` },
];

const key = (files) => computeGradleCacheKey({ runnerOs: 'Linux', javaVersion: '17', files });

test('versionCode and versionName are normalized out of the Gradle cache key', () => {
  assert.match(normalizeGradleConfig('android/app/build.gradle', 'versionCode 123\nversionName "1.0"'), /<RUN_VERSION_CODE>/);
  assert.equal(key(baseFiles({ versionCode: 100111, versionName: '1.0' })), key(baseFiles({ versionCode: 300999, versionName: '9.9' })));
});

test('lockfile and Gradle wrapper changes invalidate the cache key', () => {
  assert.notEqual(key(baseFiles()), key(baseFiles({ lock: '{"lockfileVersion":4}' })));
  assert.notEqual(key(baseFiles()), key(baseFiles({ wrapper: 'distributionUrl=gradle-9.1-bin.zip' })));
});

test('PR smoke and exact-main RC settings for the same source tree produce the same key', () => {
  const pr = baseFiles({ versionCode: 100777, versionName: '1.0' });
  const mainRc = baseFiles({ versionCode: 300042, versionName: '1.0' });
  assert.equal(key(pr), key(mainRc));
});
