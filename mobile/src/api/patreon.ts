import { requestJson } from '@/src/api/client';
import type { MobileSession } from '@/src/storage/session';

export type NativePatreonStatus = {
  configured: boolean;
  connected: boolean;
  capabilities: string[];
  account_capabilities: string[];
  account_user_id: string;
  player_id: string;
  checked_at: string;
  membership: null | {
    status?: string | null;
    effective_state: string;
    sync_pending: boolean;
    last_synced_at?: string | null;
  };
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function membershipSessionKey(session: MobileSession | null) {
  if (!session || !/^[A-Za-z0-9_-]{43}$/.test(session.accountToken ?? '')) return null;
  const player = session.playerToken.match(/^p1_([a-f0-9-]{36})\.[A-Za-z0-9_-]{43}$/i)?.[1];
  const account = session.accountUser?.id;
  if (!player || !UUID.test(player) || !account || !UUID.test(account)) return null;
  if (session.subjectId && session.subjectId.toLowerCase() !== player.toLowerCase()) return null;
  return `${player.toLowerCase()}:${account.toLowerCase()}:${session.playerToken}:${session.accountToken}`;
}

export function checkedPatreonStatus(value: unknown, session: MobileSession): NativePatreonStatus {
  if (!membershipSessionKey(session) || !value || typeof value !== 'object') throw new Error('Membership status could not be verified.');
  const data = value as Partial<NativePatreonStatus>;
  const player = session.playerToken.slice(3).split('.')[0].toLowerCase();
  const strings = (items: unknown): items is string[] => Array.isArray(items)
    && items.every((item) => typeof item === 'string' && /^[a-z_]{3,60}$/.test(item));
  if (typeof data.configured !== 'boolean' || typeof data.connected !== 'boolean'
    || !strings(data.capabilities) || !strings(data.account_capabilities)
    || data.player_id?.toLowerCase() !== player
    || data.account_user_id?.toLowerCase() !== session.accountUser?.id.toLowerCase()
    || typeof data.checked_at !== 'string' || !Number.isFinite(Date.parse(data.checked_at))
    || !data.account_capabilities.includes('account')
    || !data.account_capabilities.includes('unlimited_regular_practice')
    || (data.connected ? (!data.membership || typeof data.membership.effective_state !== 'string'
      || typeof data.membership.sync_pending !== 'boolean') : data.membership !== null)) {
    throw new Error('Membership status did not match the current account. Check status again.');
  }
  return data as NativePatreonStatus;
}

export function checkedPatreonAuthorizeUrl(value: unknown) {
  if (typeof value !== 'string') throw new Error('Patreon did not return a valid authorization URL.');
  const url = new URL(value);
  const callback = new URL(url.searchParams.get('redirect_uri') ?? '');
  const callbacks = new Set([
    'https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech/v1/patreon/callback',
    'https://api.packone.pro/growth/v1/patreon/callback',
  ]);
  const keys = new Set(['response_type', 'client_id', 'redirect_uri', 'scope', 'state']);
  if (url.origin !== 'https://www.patreon.com' || url.pathname !== '/oauth2/authorize'
    || url.username || url.password || url.hash
    || url.searchParams.get('response_type') !== 'code' || !url.searchParams.get('client_id')
    || url.searchParams.get('scope') !== 'identity'
    || !/^m_[a-f0-9]{64}$/.test(url.searchParams.get('state') ?? '')
    || !callbacks.has(callback.toString())
    || [...url.searchParams.keys()].some((key) => !keys.has(key) || url.searchParams.getAll(key).length !== 1)) {
    throw new Error('Patreon authorization destination could not be verified.');
  }
  return url.toString();
}

export async function loadNativePatreonStatus(session: MobileSession) {
  const data = await requestJson<unknown>('/growth/v1/patreon/mobile/status', {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 15_000,
  });
  return checkedPatreonStatus(data, session);
}

export async function connectNativePatreon(session: MobileSession) {
  const data = await requestJson<{ url: string }>('/growth/v1/patreon/mobile/connect', {
    method: 'POST', mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken, body: {}, timeoutMs: 15_000,
  });
  return checkedPatreonAuthorizeUrl(data.url);
}

export async function mutateNativePatreon(session: MobileSession, action: 'refresh' | 'disconnect') {
  const data = await requestJson<{ ok: boolean; requested?: boolean }>(`/growth/v1/patreon/mobile/${action}`, {
    method: 'POST', mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken, body: { confirm: true }, timeoutMs: 15_000,
  });
  if (data.ok !== true || (action === 'refresh' && data.requested !== true)) {
    throw new Error('The Patreon action could not be verified. Check status before retrying.');
  }
  return data;
}
