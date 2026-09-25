import type { ConfigContext, ExpoConfig } from 'expo/config';

type BuildProfile = 'development' | 'preview' | 'production';

const STORE_IDENTIFIER = 'pro.packone.app';
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
  const androidVersionCode = production ? optionalAndroidVersionCode() : undefined;

  return {
    ...config,
    name: displayName,
    slug: 'pack-one',
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
      ...(iosBuildNumber ? { buildNumber: iosBuildNumber } : {}),
    },
    android: {
      ...config.android,
      package: identifier,
      ...(androidVersionCode ? { versionCode: androidVersionCode } : {}),
    },
  };
};
