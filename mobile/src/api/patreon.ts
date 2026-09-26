import { requestJson } from '@/src/api/client';
import type { MobileSession } from '@/src/storage/session';

export type PatreonStatus = {
  configured: boolean;
  connected: boolean;
  support_url?: string | null;
  webhook_configured?: boolean;
  ad_free?: boolean;
  ads_allowed?: boolean;
  capabilities: string[];
  membership?: {
    status?: string | null;
    entitled_amount_cents?: number;
    is_free_trial?: boolean;
    is_gifted?: boolean;
    tier_ids?: string[];
    connected_at?: string | null;
    last_synced_at?: string | null;
    effective_state?: string | null;
    sync_pending?: boolean;
  } | null;
};

function options(session: MobileSession) {
  if (!session.accountToken) throw new Error('Sign in to manage Patreon access.');
  return {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 20_000,
  };
}

export function loadMobilePatreonStatus(session: MobileSession) {
  return requestJson<PatreonStatus>('/growth/v1/mobile/patreon/status', options(session));
}

export function startMobilePatreonConnect(session: MobileSession) {
  return requestJson<{ url: string }>('/growth/v1/mobile/patreon/connect', {
    ...options(session),
    method: 'POST',
    body: {},
  });
}

export function disconnectMobilePatreon(session: MobileSession) {
  return requestJson<{ ok: boolean }>('/growth/v1/mobile/patreon/disconnect', {
    ...options(session),
    method: 'POST',
    body: {},
  });
}

export function isElitePatreon(status: PatreonStatus | null | undefined) {
  const caps = new Set(status?.capabilities ?? []);
  return caps.has('custom_corpus') && caps.has('unlimited_cube_practice');
}
