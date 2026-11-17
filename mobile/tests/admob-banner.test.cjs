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

async function fixture(t, { consent, eligible = false, att = 'granted', attRequest = 'granted' } = {}) {
  const calls = [];
  const native = {
    Platform: { OS: 'ios' },
    Pressable: host('Pressable'),
    Text: host('Text'),
    View: host('View'),
    StyleSheet: { create: x => x },
  };
  const ads = {
    __esModule: true,
    BannerAd: host('BannerAd'),
    BannerAdSize: { BANNER: 'BANNER' },
    MaxAdContentRating: { G: 'G' },
    AdsConsent: {
      gatherConsent: async () => {
        calls.push('consent');
        return consent ? consent() : { canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' };
      },
      showPrivacyOptionsForm: async () => { calls.push('privacy'); },
      getConsentInfo: async () => ({ canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' }),
    },
    default: () => ({
      setRequestConfiguration: async () => { calls.push('configure'); },
      initialize: async () => { calls.push('initialize'); },
    }),
  };
  const { AdMobDailyBanner } = compileModule('src/components/AdMobDailyBanner.tsx', {
    'react-native': native,
    'react-native-google-mobile-ads': ads,
    'expo-tracking-transparency': {
      PermissionStatus: { UNDETERMINED: 'undetermined' },
      getTrackingPermissionsAsync: async () => {
        calls.push('att-check');
        return { status: att, granted: att === 'granted' };
      },
      requestTrackingPermissionsAsync: async () => {
        calls.push('att-request');
        return { status: attRequest, granted: attRequest === 'granted' };
      },
    },
    '@/src/components/Text': { Text: host('Text') },
    '@/src/config': { config: { adMob: { iosEnabled: true, androidEnabled: false,
      iosBannerUnitId: 'ca-app-pub-3940256099942544/2934735716' }, screenshots: { fixtures: false } } },
    '@/src/theme': { colors: {}, spacing: { sm: 8, md: 16 } },
  });
  let root;
  await act(async () => { root = Renderer.create(React.createElement(AdMobDailyBanner, { eligible })); await drain(); });
  t.after(async () => { await act(async () => root.unmount()); });
  return {
    calls, root,
    async setEligible(value) {
      await act(async () => { root.update(React.createElement(AdMobDailyBanner, { eligible: value })); await drain(); await drain(); });
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

test('iOS ATT denied or restricted: free play continues but no SDK or ad request', async t => {
  const h = await fixture(t, { eligible: true, att: 'denied' });
  await act(async () => { await drain(); await drain(); });
  assert.deepEqual(h.calls, ['consent', 'att-check']);
  assert.equal(h.root.root.findAllByType('BannerAd').length, 0);
});

test('undetermined ATT prompts once; denied choice blocks ad initialization', async t => {
  const h = await fixture(t, { eligible: true, att: 'undetermined', attRequest: 'denied' });
  await act(async () => { await drain(); await drain(); });
  assert.deepEqual(h.calls, ['consent', 'att-check', 'att-request']);
  assert.equal(h.root.root.findAllByType('BannerAd').length, 0);
});

test('undetermined ATT granted allows only non-personalized G-rated ads', async t => {
  const h = await fixture(t, { eligible: true, att: 'undetermined', attRequest: 'granted' });
  await act(async () => { await drain(); await drain(); });
  assert.deepEqual(h.calls, ['consent', 'att-check', 'att-request', 'configure', 'initialize']);
  const banners = h.root.root.findAllByType('BannerAd');
  assert.equal(banners.length, 1);
  assert.equal(banners[0].props.requestOptions.requestNonPersonalizedAdsOnly, true);
});
