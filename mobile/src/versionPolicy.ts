export type MobilePlatform = 'ios' | 'android';

export type VersionGateDecision =
  | { status: 'allowed' }
  | {
      status: 'required';
      storeUrl: string;
      minimum: { marketingVersion: string; build: number };
    };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function safeStoreUrl(platform: MobilePlatform, value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const expectedHost = platform === 'ios' ? 'apps.apple.com' : 'play.google.com';
    if (url.protocol !== 'https:' || url.hostname !== expectedHost) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseVersionCheckResponse(
  platform: MobilePlatform,
  value: unknown,
): VersionGateDecision | null {
  const body = record(value);
  if (!body || body.ok !== true || typeof body.updateRequired !== 'boolean') return null;
  if (body.platform !== platform) return null;
  if (!body.updateRequired) return { status: 'allowed' };

  const minimum = record(body.minimum);
  const marketingVersion = minimum?.marketingVersion;
  const build = minimum?.build;
  const storeUrl = safeStoreUrl(platform, body.storeUrl);
  if (
    typeof marketingVersion !== 'string' ||
    !/^\d+\.\d+(?:\.\d+)?$/.test(marketingVersion) ||
    typeof build !== 'number' ||
    !Number.isSafeInteger(build) ||
    build < 0 ||
    !storeUrl
  ) {
    return null;
  }

  return {
    status: 'required',
    storeUrl,
    minimum: { marketingVersion, build },
  };
}
