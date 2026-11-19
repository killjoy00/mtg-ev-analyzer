import type { ConfigContext, ExpoConfig } from 'expo/config';

type BuildProfile = 'development' | 'preview' | 'production';

const STORE_IDENTIFIER = 'pro.packone.app';

// Google's publicly documented sample App IDs are used for preview/test builds.
// Production embeds the registered platform-specific IDs even while requests
// are disabled. Only an explicitly enabled, reviewed build requests live ads.
const ADMOB_DEMO = {
  iosAppId: 'ca-app-pub-3940256099942544~1458002511',
  androidAppId: 'ca-app-pub-3940256099942544~3347511713',
  iosBannerId: 'ca-app-pub-3940256099942544/2934735716',
  androidBannerId: 'ca-app-pub-3940256099942544/6300978111',
} as const;
// Public AdMob identifiers for Pack One's registered iOS app. These are not
// credentials. Ad requests remain disabled unless the release gate is enabled.
const ADMOB_IOS_PRODUCTION = {
  appId: 'ca-app-pub-1217971050094766~3792911821',
  bannerUnitId: 'ca-app-pub-1217971050094766/8989398185',
} as const;
// Registered Pack One Android app and Daily-home banner: these are public SDK
// identifiers, not credentials. Google AdMob app review may still limit fill.
const ADMOB_ANDROID_PRODUCTION = {
  appId: 'ca-app-pub-1217971050094766~5084711148',
  bannerUnitId: 'ca-app-pub-1217971050094766/8963799298',
} as const;
const ADMOB_APP_ID = /^ca-app-pub-\d{16}~\d{10}$/;
const ADMOB_UNIT_ID = /^ca-app-pub-\d{16}\/\d{10}$/;

function adMobPlatformConfig(
  production: boolean,
  enabledName: string,
  appIdName: string,
  bannerName: string,
  testBanners: boolean,
  demoAppId: string,
  demoBannerId: string,
  defaultProductionAppId: string = demoAppId,
  defaultProductionBannerId: string = demoBannerId,
) {
  const enabled = production ? process.env[enabledName] === '1' : testBanners;
  // Production always embeds the registered native App ID. Runtime cannot
  // request an ad until the independently reviewed enabled gate is set.
  // Development/preview uses Google's demo IDs only.
  const appId = production ? (process.env[appIdName]?.trim() || defaultProductionAppId) : demoAppId;
  const bannerUnitId = production ? (process.env[bannerName]?.trim() || defaultProductionBannerId) : demoBannerId;
  if (enabled && production && (!appId || !ADMOB_APP_ID.test(appId)
    || !bannerUnitId || !ADMOB_UNIT_ID.test(bannerUnitId)
    || appId === demoAppId || bannerUnitId === demoBannerId
    || appId.split('~')[0] !== bannerUnitId.split('/')[0])) {
    throw new Error(`Live AdMob requires matching, non-demo ${appIdName} and ${bannerName}.`);
  }
  return { enabled, appId: appId!, bannerUnitId: bannerUnitId! };
}
// Block unrelated native permissions in every production build. The Google
// Mobile Ads SDK can contribute AD_ID to Android manifests; keep it blocked
// unless a separately reviewed Android AdMob production build is enabled.
const PRODUCTION_BLOCKED_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
];
const MAX_ANDROID_VERSION_CODE = 2_100_000_000;
const NON_STORE_IDENTIFIERS: Record<Exclude<BuildProfile, 'production'>, string> = {
  development: 'pro.packone.development',
  preview: 'pro.packone.preview',
};

function buildProfile(): BuildProfile {
  const value = process.env.PACKONE_BUILD_PROFILE?.trim() || 'development';
  if (value === 'development' || value === 'preview' || value === 'production') return value;
  throw new Error(`Unsupported PACKONE_BUILD_PROFILE: ${value}`);
}

function optionalPositiveIntegerString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function optionalMarketingVersion(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`${name} must be a dotted numeric marketing version.`);
  }
  return value;
}

function optionalAndroidVersionCode(): number | undefined {
  const value = optionalPositiveIntegerString('PACKONE_ANDROID_VERSION_CODE');
  if (!value) return undefined;
  const versionCode = Number(value);
  if (!Number.isSafeInteger(versionCode) || versionCode > MAX_ANDROID_VERSION_CODE) {
    throw new Error(
      `PACKONE_ANDROID_VERSION_CODE must be <= ${MAX_ANDROID_VERSION_CODE}.`,
    );
  }
  return versionCode;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const profile = buildProfile();
  const screenshotFixtures = process.env.EXPO_PUBLIC_PACKONE_SCREENSHOT_FIXTURES === '1';
  if (screenshotFixtures && profile !== 'preview') {
    throw new Error('Store screenshot fixtures may only be built with PACKONE_BUILD_PROFILE=preview.');
  }

  const production = profile === 'production';
  const identifier = production ? STORE_IDENTIFIER : NON_STORE_IDENTIFIERS[profile];
  const displayName = production
    ? 'Pack One'
    : profile === 'preview'
      ? 'Pack One Preview'
      : 'Pack One Dev';
  const iosBuildNumber = production
    ? optionalPositiveIntegerString('PACKONE_IOS_BUILD_NUMBER')
    : undefined;
  const iosMarketingVersion = production
    ? optionalMarketingVersion('PACKONE_IOS_MARKETING_VERSION')
    : undefined;
  const androidVersionCode = production ? optionalAndroidVersionCode() : undefined;
  const notificationProjectId=process.env.EXPO_PUBLIC_PACKONE_EXPO_PROJECT_ID?.trim();
  if(notificationProjectId&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(notificationProjectId))throw Error('Notification project ID must be a UUID.');
  const googleServicesFile=process.env.PACKONE_ANDROID_GOOGLE_SERVICES_FILE?.trim();
  const testBanners = !production && process.env.PACKONE_ADMOB_TEST_BANNERS === '1';
  const iosAds = adMobPlatformConfig(production,
    'PACKONE_ADMOB_IOS_ENABLED', 'PACKONE_ADMOB_IOS_APP_ID',
    'PACKONE_ADMOB_IOS_BANNER_ID', testBanners,
    ADMOB_DEMO.iosAppId, ADMOB_DEMO.iosBannerId,
    ADMOB_IOS_PRODUCTION.appId, ADMOB_IOS_PRODUCTION.bannerUnitId);
  const androidAds = adMobPlatformConfig(production,
    'PACKONE_ADMOB_ANDROID_ENABLED', 'PACKONE_ADMOB_ANDROID_APP_ID',
    'PACKONE_ADMOB_ANDROID_BANNER_ID', testBanners,
    ADMOB_DEMO.androidAppId, ADMOB_DEMO.androidBannerId,
    ADMOB_ANDROID_PRODUCTION.appId, ADMOB_ANDROID_PRODUCTION.bannerUnitId);
  if (production && androidAds.enabled && androidAds.appId === ADMOB_IOS_PRODUCTION.appId) {
    throw new Error('The Android AdMob App ID must not reuse Pack One\'s registered iOS App ID.');
  }

  return {
    ...config,
    name: displayName,
    slug: 'pack-one',
    plugins: [
      ...(config.plugins?.map(plugin => Array.isArray(plugin)&&plugin[0]==='expo-notifications'
        ? [plugin[0], {...plugin[1], mode:production?'production':'development', enableBackgroundRemoteNotifications:false}]
        : plugin) || []),
      // iOS 27 requires UIKit scenes; SDK 57 uses an explicit, supported opt-in.
      // Google Play Android vitals requires real DEX obfuscation. Expo's
      // config plugin sets the generated release Gradle flags; keep preview
      // and development builds unchanged so native QA remains debuggable.
      ['expo-build-properties', {
        ...(production
          ? { android: {
              enableMinifyInReleaseBuilds: true,
              enableShrinkResourcesInReleaseBuilds: true,
            } }
          : {}),
        ios: { enableSceneSupport: true },
      }],
      ['react-native-google-mobile-ads', {
        iosAppId: iosAds.appId,
        androidAppId: androidAds.appId,
        delayAppMeasurementInit: true,
      }],
      // The bundled Google Ads SDK declares Device ID tracking. Always include
      // ATT authorization and its truthful system explanation in iOS builds;
      // AdMobDailyBanner will fail closed unless authorization is granted.
      ['expo-tracking-transparency', {
        userTrackingPermission: 'Allow Pack One to use your device identifier for advertising measurement across apps and websites.',
      }],
    ] as ExpoConfig['plugins'],
    ...(iosMarketingVersion ? { version: iosMarketingVersion } : {}),
    description: 'Practice real draft decisions, compare trophy picks, and track your Pack One career.',
    backgroundColor: '#f7f8fa',
    ...(production ? { icon: './assets/images/icon.png' } : {}),
    extra: {
      ...config.extra,
      buildProfile: profile,
      notifications: {projectId: notificationProjectId || null, androidConfigured: Boolean(googleServicesFile)},
      adMob: {
        iosEnabled: iosAds.enabled,
        androidEnabled: androidAds.enabled,
        // Omit inactive ad units. Expo's public-config JSON otherwise turns
        // a null value into an empty object, which is misleading on device.
        ...(iosAds.enabled ? { iosBannerUnitId: iosAds.bannerUnitId } : {}),
        ...(androidAds.enabled ? { androidBannerUnitId: androidAds.bannerUnitId } : {}),
        testBanners: !production && testBanners,
      },
    },
    ios: {
      ...config.ios,
      bundleIdentifier: identifier,
      ...(production
        ? {
            config: {
              ...config.ios?.config,
              usesNonExemptEncryption: false,
            },
          }
        : {}),
      ...(iosBuildNumber ? { buildNumber: iosBuildNumber } : {}),
    },
    android: {
      ...config.android,
      package: identifier,
      ...(googleServicesFile ? {googleServicesFile} : {}),
      ...(production
        ? {
            blockedPermissions: [
              ...(config.android?.blockedPermissions || []),
              ...(androidAds.enabled ? [] : ['com.google.android.gms.permission.AD_ID']),
              ...PRODUCTION_BLOCKED_PERMISSIONS,
            ],
            // Glyph sized inside the 66dp adaptive-icon safe zone, on the website's brand blue.
            adaptiveIcon: {
              foregroundImage: './assets/images/adaptive-icon-foreground.png',
              monochromeImage: './assets/images/adaptive-icon-monochrome.png',
              backgroundColor: '#1E4D7A',
            },
          }
        : {}),
      ...(androidVersionCode ? { versionCode: androidVersionCode } : {}),
    },
  };
};
