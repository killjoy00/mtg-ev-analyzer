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

// CI latency probe for #844; comment-only, no behavior change.
