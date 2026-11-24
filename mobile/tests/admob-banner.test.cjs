const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const Renderer = require('react-test-renderer');
const { compileModule } = require('./support/compile-module.cjs');
const { act } = Renderer;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const drain = () => new Promise(resolve => setImmediate(resolve));
const host = name => function MockNativeHost(props) { return React.createElement(name, props, props.children); };

test('Daily-home monetization is mutually exclusive and fails closed', () => {
  const { dailyHomePromotion } = compileModule('src/ads/placement.ts', {});
  assert.equal(dailyHomePromotion(null, true), 'none');
  assert.equal(dailyHomePromotion(false, true), 'none');
  assert.equal(dailyHomePromotion(true, true), 'admob');
  assert.equal(dailyHomePromotion(true, false, 'ios'), 'none', 'iOS never falls back to TCGplayer');
  assert.equal(dailyHomePromotion(true, false, 'android'), 'affiliate', 'Android keeps its existing home slot');
  assert.equal(dailyHomePromotion(true, true, 'ios'), 'admob');
  assert.equal(dailyHomePromotion(false, false, 'android'), 'none');
});

async function fixture(t, {
  consent, storedConsent, eligible = false, enabled = true, initError, att = 'granted', platform = 'ios',
  privacyQa = false, privacyModule,
} = {}) {
  const calls = [];
  const diagnostics = [];
  const onStatus = event => diagnostics.push(event);
  const native = {
    Platform: { OS: platform },
    Pressable: host('Pressable'),
    Text: host('Text'),
    View: host('View'),
    StyleSheet: { create: x => x },
  };
  const ads = {
    __esModule: true,
    BannerAd: host('BannerAd'),
    BannerAdSize: { BANNER: 'BANNER', ANCHORED_ADAPTIVE_BANNER: 'ANCHORED_ADAPTIVE_BANNER' },
    MaxAdContentRating: { G: 'G' },
    AdsConsent: {
      gatherConsent: async () => {
        calls.push('consent');
        return consent ? consent() : { canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' };
      },
      showPrivacyOptionsForm: async () => { calls.push('privacy'); },
      getConsentInfo: async () => { calls.push('cached-consent'); return storedConsent ? storedConsent() : { canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' }; },
    },
    default: () => ({
      setRequestConfiguration: async options => {
        assert.equal(options.maxAdContentRating, 'G');
        calls.push('configure');
      },
      initialize: async () => { calls.push('initialize'); if (initError) throw initError; },
    }),
  };
  const { AdMobDailyBanner } = compileModule('src/components/AdMobDailyBanner.tsx', {
    'react-native': native,
    'react-native-google-mobile-ads': ads,
    expo: { requireOptionalNativeModule: () => privacyModule?.(calls) ?? null },
    'expo-tracking-transparency': {
      getTrackingPermissionsAsync: async () => {
        calls.push('att-check');
        return { status: att, granted: att === 'granted' };
      },
      requestTrackingPermissionsAsync: async () => { throw Error('Pack One must not prompt for ATT'); },
    },
    '@/src/components/Text': { Text: host('Text') },
    '@/src/config': { config: { adMob: { privacyQa, iosEnabled: enabled && platform === 'ios', androidEnabled: enabled && platform === 'android',
      iosBannerUnitId: 'ca-app-pub-3940256099942544/2934735716',
      androidBannerUnitId: 'ca-app-pub-3940256099942544/6300978111' }, screenshots: { fixtures: false } } },
    '@/src/theme': { colors: {}, spacing: { sm: 8, md: 16 } },
  });
  let root;
  await act(async () => { root = Renderer.create(React.createElement(AdMobDailyBanner, { eligible, onStatus })); await drain(); });
  t.after(async () => { await act(async () => root.unmount()); });
  return {
    calls, diagnostics, root,
    async setEligible(value) {
      await act(async () => { root.update(React.createElement(AdMobDailyBanner, { eligible: value, onStatus })); await drain(); await drain(); });
    },
  };
}

test('AdMob never requests consent or loads an ad before membership eligibility', async t => {
  const h = await fixture(t);
  assert.deepEqual(h.calls, []);
  assert.equal(h.root.toJSON(), null);
  await h.setEligible(true);
  assert.deepEqual(h.calls, ['consent', 'att-check', 'configure', 'initialize']);
  const banners = h.root.root.findAllByType('BannerAd');
  assert.equal(banners.length, 1);
  assert.equal(banners[0].props.requestOptions.requestNonPersonalizedAdsOnly, true);
  await h.setEligible(false);
  assert.equal(h.root.root.findAllByType('BannerAd').length, 0);
});

test('denied UMP permission prevents SDK initialization and ad load', async t => {
  const h = await fixture(t, { eligible: true, consent: async () =>
    ({ canRequestAds: false, privacyOptionsRequirementStatus: 'NOT_REQUIRED' }) });
  await act(async () => { await drain(); await drain(); });
  assert.deepEqual(h.calls, ['consent']);
  assert.equal(h.root.root.findAllByType('BannerAd').length, 0);
});

test('privacy preview with an authorized iOS device or absent module does not call UMP', async t => {
  for (const privacyModule of [undefined, () => ({ mayStart: () => false })]) {
    const h = await fixture(t, { eligible: true, privacyQa: true, privacyModule });
    assert.deepEqual(h.calls, []);
    assert.equal(h.root.root.findAllByType('BannerAd').length, 0);
    assert.equal(h.diagnostics.at(-1).code, 'privacy-qa-blocked');
  }
});

test('privacy preview applies native controls before creating an Android banner', async t => {
  for (const allowed of [true, false]) {
    const h = await fixture(t, {
      eligible: true, privacyQa: true, platform: 'android',
      privacyModule: calls => ({
        mayStart: () => true,
        prepare: () => { calls.push('prepare'); return true; },
        allowBanner: () => { calls.push('allow-banner'); return allowed; },
      }),
    });
    assert.deepEqual(h.calls, ['consent', 'prepare', 'configure', 'initialize', 'allow-banner']);
    assert.equal(h.root.root.findAllByType('BannerAd').length, Number(allowed));
  }
});

test('becoming ad-free during UMP consent prevents late SDK initialization', async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = await fixture(t, { eligible: true, consent: () => pending });
  await h.setEligible(false);
  await act(async () => {
    finish({ canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' });
    await drain(); await drain();
  });
  assert.deepEqual(h.calls, ['consent']);
  assert.equal(h.root.root.findAllByType('BannerAd').length, 0);
});

test('privacy-options requirement is visible alongside eligible ads', async t => {
  const h = await fixture(t, { eligible: true, consent: async () =>
    ({ canRequestAds: true, privacyOptionsRequirementStatus: 'REQUIRED' }) });
  await act(async () => { await drain(); await drain(); });
  const button = h.root.root.findAllByType('Pressable').find(x => x.props.accessibilityLabel === 'Ad privacy choices');
  assert.ok(button);
  await act(async () => { button.props.onPress(); await drain(); await drain(); });
  assert.ok(h.calls.includes('privacy'));
});

for (const att of ['denied', 'restricted']) {
  test(`iOS ATT ${att}: UMP-eligible guests get a non-personalized banner without an ATT prompt`, async t => {
    const h = await fixture(t, { eligible: true, att });
    await act(async () => { await drain(); await drain(); });
    assert.deepEqual(h.calls, ['consent', 'att-check', 'configure', 'initialize']);
    const banners = h.root.root.findAllByType('BannerAd');
    assert.equal(banners.length, 1);
    assert.equal(banners[0].props.requestOptions.requestNonPersonalizedAdsOnly, true);
  });
}

test('undetermined iOS ATT never prompts and requests only non-personalized ads', async t => {
  const h = await fixture(t, { eligible: true, att: 'undetermined' });
  await act(async () => { await drain(); await drain(); });
  assert.deepEqual(h.calls, ['consent', 'att-check', 'configure', 'initialize']);
  const banners = h.root.root.findAllByType('BannerAd');
  assert.equal(banners.length, 1);
  assert.equal(banners[0].props.requestOptions.requestNonPersonalizedAdsOnly, true);
});

test('UMP refresh failure reuses only previously permitted consent', async t => {
  const h = await fixture(t, {
    eligible: true,
    consent: async () => { throw Error('offline'); },
    storedConsent: async () => ({ canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' }),
  });
  await act(async () => { await drain(); await drain(); });
  assert.deepEqual(h.calls, ['consent', 'cached-consent', 'att-check', 'configure', 'initialize']);
  assert.equal(h.root.root.findAllByType('BannerAd').length, 1);
  assert.ok(h.diagnostics.some(event => event.consent === 'reused'));
});

test('UMP refresh failure cannot bypass missing or denied previous consent', async t => {
  const h = await fixture(t, {
    eligible: true,
    consent: async () => { throw Error('offline'); },
    storedConsent: async () => ({ canRequestAds: false, privacyOptionsRequirementStatus: 'NOT_REQUIRED' }),
  });
  await act(async () => { await drain(); await drain(); });
  assert.deepEqual(h.calls, ['consent', 'cached-consent']);
  assert.equal(h.root.root.findAllByType('BannerAd').length, 0);
  assert.equal(h.diagnostics.at(-1).stage, 'consent-error');
});

test('AdMob initialization failure is diagnosed without exposing raw error messages', async t => {
  const h = await fixture(t, {
    eligible: true, initError: { code: 'googleMobileAds/error-code-internal', message: 'personal-data-must-not-leak' },
  });
  await act(async () => { await drain(); await drain(); });
  assert.equal(h.root.root.findAllByType('BannerAd').length, 0);
  assert.equal(h.diagnostics.at(-1).stage, 'sdk-error');
  assert.equal(h.diagnostics.at(-1).code, 'googleMobileAds/error-code-internal');
  assert.doesNotMatch(JSON.stringify(h.diagnostics), /personal-data-must-not-leak/);
});

test('Google no-fill and banner load states are visible without duplicate ad requests', async t => {
  const h = await fixture(t, { eligible: true });
  await act(async () => { await drain(); await drain(); });
  const banner = h.root.root.findByType('BannerAd');
  await act(async () => { banner.props.onAdLoaded(); });
  assert.equal(h.diagnostics.at(-1).stage, 'banner-loaded');
  await act(async () => { banner.props.onAdFailedToLoad({ code: 'googleMobileAds/error-code-no-fill', message: 'sensitive-data' }); });
  assert.equal(h.diagnostics.at(-1).stage, 'banner-no-fill');
  assert.equal(h.diagnostics.at(-1).code, 'googleMobileAds/error-code-no-fill');
  assert.equal(h.root.root.findAllByType('BannerAd').length, 0);
  assert.doesNotMatch(JSON.stringify(h.diagnostics), /sensitive-data/);
  assert.equal(h.calls.filter(call => call === 'initialize').length, 1);
});

test('unknown ad failure formats are redacted in diagnostics', async t => {
  const h = await fixture(t, { eligible: true });
  await act(async () => { await drain(); await drain(); });
  const banner = h.root.root.findByType('BannerAd');
  await act(async () => { banner.props.onAdFailedToLoad({ code: 'private:user@mail.com' }); });
  assert.equal(h.diagnostics.at(-1).stage, 'banner-error');
  assert.equal(h.diagnostics.at(-1).code, 'unknown');
});

test('disabled AdMob never starts UMP or the SDK', async t => {
  const h = await fixture(t, { eligible: true, enabled: false });
  await act(async () => { await drain(); await drain(); });
  assert.deepEqual(h.calls, []);
  assert.equal(h.root.toJSON(), null);
});


test('Android banner uses adaptive sizing and consent, without iOS ATT', async t => {
  const h = await fixture(t, { eligible: true, platform: 'android' });
  await act(async () => { await drain(); await drain(); });
  assert.deepEqual(h.calls, ['consent', 'configure', 'initialize']);
  const banner = h.root.root.findByType('BannerAd');
  assert.equal(banner.props.size, 'ANCHORED_ADAPTIVE_BANNER');
  assert.equal(banner.props.unitId, 'ca-app-pub-3940256099942544/6300978111');
  assert.equal(banner.props.requestOptions.requestNonPersonalizedAdsOnly, true);
  await h.setEligible(false);
  assert.equal(h.root.root.findAllByType('BannerAd').length, 0,
    'ad-free account changes must immediately unmount the Android ad');
});

test('Android denied consent and disabled flag never start Google ads', async t => {
  const denied = await fixture(t, {
    platform: 'android', eligible: true,
    consent: async () => ({ canRequestAds: false, privacyOptionsRequirementStatus: 'NOT_REQUIRED' }),
  });
  await act(async () => { await drain(); await drain(); });
  assert.deepEqual(denied.calls, ['consent']);
  assert.equal(denied.root.root.findAllByType('BannerAd').length, 0);
  const disabled = await fixture(t, { platform: 'android', eligible: true, enabled: false });
  assert.deepEqual(disabled.calls, []);
  assert.equal(disabled.root.toJSON(), null);
});

test('Android live AdMob manifest audit requires opted-in real IDs and advertising ID disclosure', () => {
  const { spawnSync } = require('node:child_process');
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'packone-android-admob-'));
  const appId = 'ca-app-pub-1234567890123456~0123456789';
  const bannerId = 'ca-app-pub-1234567890123456/0123456789';
  const runAudit = ({ enabled = false, adId = false, manifestAppId = appId, envAppId = appId, envBannerId = bannerId }) => {
    const manifest = [
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="pro.packone.app">',
      adId ? '  <uses-permission android:name="com.google.android.gms.permission.AD_ID" />' : '',
      '  <application>',
      '    <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="' + manifestAppId + '" />',
      '  </application>',
      '</manifest>',
    ].join('\n');
    const manifestPath = join(dir, 'AndroidManifest.xml');
    const reportPath = join(dir, 'audit.json');
    writeFileSync(manifestPath, manifest);
    const env = { ...process.env, PACKONE_ADMOB_ANDROID_ENABLED: enabled ? '1' : '0',
      PACKONE_ADMOB_ANDROID_APP_ID: envAppId, PACKONE_ADMOB_ANDROID_BANNER_ID: envBannerId };
    const result = spawnSync('python3', ['scripts/audit-android-manifest.py', manifestPath, '--output', reportPath], {
      cwd: process.cwd(), env, encoding: 'utf8',
    });
    return { result, report: JSON.parse(readFileSync(reportPath, 'utf8')) };
  };
  try {
    const disabled = runAudit({ enabled: false });
    assert.equal(disabled.result.status, 0, disabled.result.stderr);
    assert.equal(disabled.report.android_admob_enabled, false);
    const undeclared = runAudit({ enabled: false, adId: true });
    assert.notEqual(undeclared.result.status, 0);
    assert.ok(undeclared.report.forbidden_permissions_present.includes('com.google.android.gms.permission.AD_ID'));

    const enabled = runAudit({ enabled: true, adId: true });
    assert.equal(enabled.result.status, 0, enabled.result.stderr);
    assert.equal(enabled.report.android_admob_enabled, true);
    assert.equal(enabled.report.android_admob_app_id_matches, true);
    assert.deepEqual(enabled.report.android_admob_policy_errors, []);

    const wrongApp = runAudit({ enabled: true, adId: true, manifestAppId: 'ca-app-pub-3940256099942544~3347511713' });
    assert.notEqual(wrongApp.result.status, 0);
    assert.match(wrongApp.result.stderr, /App ID does not match/);
    const missingAdId = runAudit({ enabled: true, adId: false });
    assert.notEqual(missingAdId.result.status, 0);
    assert.match(missingAdId.result.stderr, /missing the expected AD_ID/);
    const demoIds = runAudit({ enabled: true, adId: true,
      envAppId: 'ca-app-pub-3940256099942544~3347511713',
      envBannerId: 'ca-app-pub-3940256099942544/6300978111',
      manifestAppId: 'ca-app-pub-3940256099942544~3347511713' });
    assert.notEqual(demoIds.result.status, 0);
    assert.match(demoIds.result.stderr, /non-demo App ID/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
