import type { ConfigContext, ExpoConfig } from 'expo/config';

type BuildProfile = 'development' | 'preview' | 'production';

const STORE_IDENTIFIER = 'pro.packone.app';
const NON_STORE_IDENTIFIERS: Record<Exclude<BuildProfile, 'production'>, string> = {
  development: 'pro.packone.development',
  preview: 'pro.packone.preview',
};

function buildProfile(): BuildProfile {
  const value = process.env.PACKONE_BUILD_PROFILE?.trim() || 'development';
  if (value === 'development' || value === 'preview' || value === 'production') return value;
  throw new Error(`Unsupported PACKONE_BUILD_PROFILE: ${value}`);
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
    },
    android: {
      ...config.android,
      package: identifier,
    },
  };
};
