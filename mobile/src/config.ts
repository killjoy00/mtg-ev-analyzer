export type MobileEnvironment = 'development' | 'preview' | 'production';

function environment(): MobileEnvironment {
  const value = process.env.EXPO_PUBLIC_PACKONE_ENV;
  if (value === 'preview' || value === 'production') return value;
  return 'development';
}

function cleanOrigin(value: string) {
  return value.replace(/\/$/, '');
}

const apiOrigin = cleanOrigin(
  process.env.EXPO_PUBLIC_PACKONE_API_ORIGIN ?? 'https://api.packone.pro',
);

export const config = Object.freeze({
  environment: environment(),
  api: Object.freeze({
    origin: apiOrigin,
    growthBaseUrl: `${apiOrigin}/growth`,
    draftBaseUrl: `${apiOrigin}/draft`,
    legacyBaseUrl: `${apiOrigin}/legacy`,
  }),
});
