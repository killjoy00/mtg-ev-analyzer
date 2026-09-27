import Constants from 'expo-constants';

export type MobileEnvironment = 'development' | 'preview' | 'production';

function validEnvironment(value: unknown): MobileEnvironment | null {
  return value === 'development' || value === 'preview' || value === 'production'
    ? value
    : null;
}

function environment(): MobileEnvironment {
  const publicEnvironment = validEnvironment(process.env.EXPO_PUBLIC_PACKONE_ENV);
  const embeddedEnvironment = validEnvironment(Constants.expoConfig?.extra?.buildProfile);

  if (
    publicEnvironment
    && embeddedEnvironment
    && publicEnvironment !== embeddedEnvironment
  ) {
    throw new Error(
      `Pack One mobile environment mismatch: public=${publicEnvironment}, build=${embeddedEnvironment}.`,
    );
  }

  return embeddedEnvironment ?? publicEnvironment ?? 'development';
}

function cleanOrigin(value: string) {
  return value.replace(/\/$/, '');
}

const resolvedEnvironment = environment();
const screenshotFixtures = process.env.EXPO_PUBLIC_PACKONE_SCREENSHOT_FIXTURES === '1';
if (screenshotFixtures && resolvedEnvironment !== 'preview') {
  throw new Error('Store screenshot fixtures are allowed only in the preview mobile environment.');
}

const apiOrigin = cleanOrigin(
  process.env.EXPO_PUBLIC_PACKONE_API_ORIGIN ?? 'https://api.packone.pro',
);

export const config = Object.freeze({
  environment: resolvedEnvironment,
  screenshots: Object.freeze({
    fixtures: screenshotFixtures,
  }),
  api: Object.freeze({
    origin: apiOrigin,
    growthBaseUrl: `${apiOrigin}/growth`,
    draftBaseUrl: `${apiOrigin}/draft`,
    legacyBaseUrl: `${apiOrigin}/legacy`,
  }),
});
