import { ApiError, requestJson } from '@/src/api/client';
import { config } from '@/src/config';
import { readSession, replaceSessionIfCurrent, type MobileSession } from '@/src/storage/session';

type GuestSessionResponse = {
  token: string;
  playerId: string;
  displayName: string;
  profileKey?: string | null;
};

type GuestIdentityStatus = { ranking_identity?: { eligible: boolean; reason?: string | null } | null };

function validGuestToken(value: string) {
  return /^p1_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/i.test(value);
}

function sameIdentity(a: MobileSession | null, b: MobileSession) {
  return a?.playerToken === b.playerToken && a.accountToken === b.accountToken
    && a.accountUser?.id === b.accountUser?.id;
}

async function newGuestSession(): Promise<MobileSession> {
  const created = await requestJson<GuestSessionResponse>('/growth/v1/session', {
    method: 'POST',
    body: { displayName: 'Pack Player' },
  });
  if (!validGuestToken(created.token)) throw new Error('Pack One returned an invalid guest session.');
  return { playerToken: created.token, subjectId: created.playerId, guestVerified: true };
}

async function createOrReadGuestSession(): Promise<MobileSession> {
  for (;;) {
    const existing = await readSession();
    if (existing?.accountToken || existing?.guestVerified === true || (existing && config.screenshots.fixtures)) return existing;
    if (existing) {
      // Older native versions kept the account-owned player token after logout.
      // The server's ranking identity distinguishes a genuinely unclaimed player
      // even if the account has never selected a rank-eligible username.
      let status: GuestIdentityStatus | null = null;
      let rejected = false;
      try {
        status = await requestJson<GuestIdentityStatus>('/draft/v1/daily-status', {
          mobileSessionToken: existing.playerToken,
        });
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error;
        rejected = true;
      }
      if (!rejected && !status?.ranking_identity) throw new Error('Could not verify guest identity. Try again.');
      if (status?.ranking_identity?.reason === 'guest' && status.ranking_identity.eligible === false) {
        const verified: MobileSession = { ...existing, guestVerified: true };
        if (await replaceSessionIfCurrent(existing, verified)) return verified;
        continue;
      }
      // Never send the former account's player token to another gameplay call.
      // Clear it before trying to create a guest, including on network failure.
      if (!(await replaceSessionIfCurrent(existing, null))) continue;
      continue;
    }
    const created = await newGuestSession();
    if (await replaceSessionIfCurrent(null, created)) return created;
  }
}

// Multiple root tabs may mount together. They must share one guest identity.
let pendingSession: Promise<MobileSession> | null = null;
export async function ensureGuestSession(): Promise<MobileSession> {
  for (;;) {
    if (!pendingSession) pendingSession = createOrReadGuestSession().finally(() => { pendingSession = null; });
    const result = await pendingSession;
    const current = await readSession();
    if (current && sameIdentity(current, result)) return current;
  }
}

/** Detach the old account locally before creating a new, independent guest. */
export async function resetGuestSession(previous: MobileSession): Promise<MobileSession> {
  const cleared = await replaceSessionIfCurrent(previous, null);
  if (!cleared && (await readSession())?.accountToken) {
    throw new Error('Account changed. Try again.');
  }
  const next = await ensureGuestSession();
  if (next.accountToken) throw new Error('Account changed. Try again.');
  return next;
}
