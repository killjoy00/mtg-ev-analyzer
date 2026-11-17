export type MobileEnvironment = 'development' | 'preview' | 'production';

function environment(): MobileEnvironment {
  const value = process.env.EXPO_PUBLIC_PACKONE_ENV;
  if (value === 'preview' || value === 'production') return value;
  return 'development';
}

function cleanOrigin(value: string) {
  return value.replace(/\/$/, '');
}

const resolvedEnvironment = environment();
const screenshotFixtures = process.env.EXPO_PUBLIC_PACKONE_SCREENSHOT_FIXTURES === '1';
if (screenshotFixtures && resolvedEnvironment !== 'preview') {
  throw new Error('Store screenshot fixtures are allowed only in the preview mobile environment.');
}

type NativeAdMobOptions = {
  iosEnabled?: boolean;
  androidEnabled?: boolean;
  iosBannerUnitId?: string | null;
  androidBannerUnitId?: string | null;
  testBanners?: boolean;
};

// Native Expo config is available on device. Non-native test harnesses may not
// provide expo-constants, so a missing module must leave advertising disabled.
function readAdMobOptions(): NativeAdMobOptions | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- test-only runtimes may lack Expo native modules.
    const module = require('expo-constants') as typeof import('expo-constants');
    return module.default?.expoConfig?.extra?.adMob as NativeAdMobOptions | undefined;
  } catch {
    return undefined;
  }
}
const nativeAdMob = readAdMobOptions();

const apiOrigin = cleanOrigin(
  process.env.EXPO_PUBLIC_PACKONE_API_ORIGIN ?? 'https://api.packone.pro',
);

export const config = Object.freeze({
  environment: resolvedEnvironment,
  screenshots: Object.freeze({
    fixtures: screenshotFixtures,
  }),
  adMob: Object.freeze({
    iosEnabled: nativeAdMob?.iosEnabled === true && !screenshotFixtures,
    androidEnabled: nativeAdMob?.androidEnabled === true && !screenshotFixtures,
    iosBannerUnitId: nativeAdMob?.iosBannerUnitId || null,
    androidBannerUnitId: nativeAdMob?.androidBannerUnitId || null,
    testBanners: nativeAdMob?.testBanners === true,
  }),
  api: Object.freeze({
    origin: apiOrigin,
    growthBaseUrl: `${apiOrigin}/growth`,
    draftBaseUrl: `${apiOrigin}/draft`,
    legacyBaseUrl: `${apiOrigin}/legacy`,
  }),
});
