import type { ConfigContext, ExpoConfig } from 'expo/config';

type BuildProfile = 'development' | 'preview' | 'production';

const NON_STORE_IDENTIFIERS: Record<Exclude<BuildProfile, 'production'>, string> = {
  development: 'pro.packone.development',
  preview: 'pro.packone.preview',
};

function buildProfile(): BuildProfile {
  const value = process.env.PACKONE_BUILD_PROFILE?.trim() || 'development';
  if (value === 'development' || value === 'preview' || value === 'production') return value;
  throw new Error(`Unsupported PACKONE_BUILD_PROFILE: ${value}`);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required for Pack One production builds. Configure it in the EAS production environment before building.`,
    );
  }
  return value;
}

function validAppleBundleIdentifier(value: string) {
  return /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value);
}

function validAndroidPackage(value: string) {
  return /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(value);
}

function validProjectId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const profile = buildProfile();
  const production = profile === 'production';

  const bundleIdentifier = production
    ? required('PACKONE_IOS_BUNDLE_IDENTIFIER')
    : NON_STORE_IDENTIFIERS[profile];
  const androidPackage = production
    ? required('PACKONE_ANDROID_PACKAGE')
    : NON_STORE_IDENTIFIERS[profile];

  if (!validAppleBundleIdentifier(bundleIdentifier)) {
    throw new Error(`Invalid iOS bundle identifier: ${bundleIdentifier}`);
  }
  if (!validAndroidPackage(androidPackage)) {
    throw new Error(`Invalid Android package: ${androidPackage}`);
  }

  const projectId = production
    ? required('PACKONE_EXPO_PROJECT_ID')
    : process.env.PACKONE_EXPO_PROJECT_ID?.trim();

  if (projectId && !validProjectId(projectId)) {
    throw new Error('PACKONE_EXPO_PROJECT_ID must be a UUID.');
  }

  const displayName = profile === 'production'
    ? 'Pack One'
    : profile === 'preview'
      ? 'Pack One Preview'
      : 'Pack One Dev';

  const extra = {
    ...config.extra,
    buildProfile: profile,
    ...(projectId
      ? {
          eas: {
            ...(typeof config.extra?.eas === 'object' && config.extra.eas ? config.extra.eas : {}),
            projectId,
          },
        }
      : {}),
  };

  return {
    ...config,
    name: displayName,
    backgroundColor: '#f7f8fa',
    ios: {
      ...config.ios,
      bundleIdentifier,
    },
    android: {
      ...config.android,
      package: androidPackage,
    },
    extra,
  };
};
