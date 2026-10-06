import type { ConfigContext, ExpoConfig } from 'expo/config';

type BuildProfile = 'development' | 'preview' | 'production';

const STORE_IDENTIFIER = 'pro.packone.app';
// Added by the React Native template (dev overlays) and expo-secure-store (biometric
// unlock, which Pack One does not use). Store builds never need them.
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

  return {
    ...config,
    name: displayName,
    slug: 'pack-one',
    ...(iosMarketingVersion ? { version: iosMarketingVersion } : {}),
    description: 'Practice real draft decisions, compare trophy picks, and track your Pack One career.',
    backgroundColor: '#f7f8fa',
    ...(production ? { icon: './assets/images/icon.png' } : {}),
    extra: {
      ...config.extra,
      buildProfile: profile,
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
      ...(production
        ? {
            blockedPermissions: [
              ...(config.android?.blockedPermissions || []),
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
