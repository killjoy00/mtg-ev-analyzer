import * as SecureStore from 'expo-secure-store';

const SESSION_KEY = 'packone.mobile.session.v1';

export type MobileSession = {
  kind: 'guest' | 'account';
  token: string;
  subjectId?: string;
  expiresAt?: string;
};

function validSession(value: unknown): value is MobileSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<MobileSession>;
  return (session.kind === 'guest' || session.kind === 'account')
    && typeof session.token === 'string'
    && session.token.length > 0;
}

export async function readSession(): Promise<MobileSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return validSession(value) ? value : null;
  } catch {
    return null;
  }
}

export async function writeSession(session: MobileSession) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
