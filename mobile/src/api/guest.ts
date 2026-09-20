import { requestJson } from '@/src/api/client';
import { readSession, writeSession, type MobileSession } from '@/src/storage/session';

type GuestSessionResponse = {
  token: string;
  playerId: string;
  displayName: string;
  profileKey?: string | null;
};

function validGuestToken(value: string) {
  return /^p1_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/i.test(value);
}

export async function ensureGuestSession(): Promise<MobileSession> {
  const existing = await readSession();
  if (existing?.kind === 'guest' && validGuestToken(existing.token)) return existing;

  const created = await requestJson<GuestSessionResponse>('/growth/v1/session', {
    method: 'POST',
    body: { displayName: 'Pack Player' },
  });
  if (!validGuestToken(created.token)) throw new Error('Pack One returned an invalid guest session.');

  const session: MobileSession = {
    kind: 'guest',
    token: created.token,
    subjectId: created.playerId,
  };
  await writeSession(session);
  return session;
}
