import type { MobileSession } from '@/src/storage/session';
import * as SecureStore from 'expo-secure-store';

const PLAYER_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const PLAYER_SIGNATURE = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ACCOUNT_TOKEN = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

export const screenshotSession: MobileSession = Object.freeze({
  playerToken: `p1_${PLAYER_ID}.${PLAYER_SIGNATURE}`,
  subjectId: PLAYER_ID,
  accountToken: ACCOUNT_TOKEN,
  accountExpiresAt: '2099-12-31T23:59:59.000Z',
  accountUser: Object.freeze({
    id: ACCOUNT_ID,
    email: 'reviewer@packone.example',
    name: 'Pack One Reviewer',
  }),
});

const PREVIEW_SESSION = 'packone.preview.session.v1';
export async function readScreenshotSession(): Promise<MobileSession> {
  const raw = await SecureStore.getItemAsync(PREVIEW_SESSION);
  return raw ? JSON.parse(raw) : screenshotSession;
}
export async function writeScreenshotSession(session: MobileSession) {
  await SecureStore.setItemAsync(PREVIEW_SESSION, JSON.stringify(session));
}
