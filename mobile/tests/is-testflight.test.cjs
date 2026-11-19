const test = require('node:test');
const assert = require('node:assert/strict');
const { compileModule } = require('./support/compile-module.cjs');

function fixture({ platform = 'ios', releaseType = 5, environment = 'Sandbox', throws = false } = {}) {
  const calls = [];
  const module = compileModule('src/ads/isTestFlight.ts', {
    'react-native': { Platform: { OS: platform } },
    'expo-application': {
      ApplicationReleaseType: { APP_STORE: 5 },
      getIosApplicationReleaseTypeAsync: async () => {
        calls.push('release-type');
        if (throws) throw Error('not available');
        return releaseType;
      },
    },
    'expo-iap': {
      getAppTransactionIOS: async () => {
        calls.push('app-transaction');
        return environment === null ? null : { environment, appTransactionId: 'must-not-log' };
      },
    },
  });
  return { check: module.isTestFlightEnvironment, calls };
}

test('iOS TestFlight StoreKit sandbox enables optional diagnostics', async () => {
  const h = fixture();
  assert.equal(await h.check(), true);
  assert.deepEqual(h.calls, ['release-type', 'app-transaction']);
});

test('public App Store never shows ad diagnostics in production StoreKit', async () => {
  for (const environment of ['Production', 'production', null, 'Xcode', 'unknown']) {
    const h = fixture({ environment });
    assert.equal(await h.check(), false, String(environment));
  }
});

test('development/ad-hoc builds are not mistaken for TestFlight', async () => {
  for (const releaseType of [1, 2, 3, 4, 0]) {
    const h = fixture({ releaseType });
    assert.equal(await h.check(), false, String(releaseType));
    assert.deepEqual(h.calls, ['release-type']);
  }
});

test('Android never imports StoreKit and cannot enable iOS diagnostics', async () => {
  const h = fixture({ platform: 'android' });
  assert.equal(await h.check(), false);
  assert.deepEqual(h.calls, []);
});

test('StoreKit verification errors hide diagnostic UI without changing ad behavior', async () => {
  const h = fixture({ throws: true });
  assert.equal(await h.check(), false);
  assert.deepEqual(h.calls, ['release-type']);
});
