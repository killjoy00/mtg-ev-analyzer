import * as SecureStore from 'expo-secure-store';

const SESSION_KEY = 'packone.mobile.session.v2';
const LEGACY_SESSION_KEY = 'packone.mobile.session.v1';

export type MobileAccountUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

export type MobileSession = {
  playerToken: string;
  subjectId?: string;
  accountToken?: string;
  accountExpiresAt?: string;
  accountUser?: MobileAccountUser;
};

function validPlayerToken(value: unknown): value is string {
  return typeof value === 'string'
    && /^p1_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/i.test(value);
}

function validAccountToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function validSession(value: unknown): value is MobileSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<MobileSession>;
  return validPlayerToken(session.playerToken)
    && (session.accountToken === undefined || validAccountToken(session.accountToken));
}

async function migrateLegacy(): Promise<MobileSession | null> {
  const raw = await SecureStore.getItemAsync(LEGACY_SESSION_KEY);
  if (!raw) return null;
  try {
    const legacy = JSON.parse(raw) as {
      kind?: unknown;
      token?: unknown;
      subjectId?: unknown;
      expiresAt?: unknown;
    };
    if (!validPlayerToken(legacy.token)) return null;
    const migrated: MobileSession = {
      playerToken: legacy.token,
      subjectId: typeof legacy.subjectId === 'string' ? legacy.subjectId : undefined,
    };
    await writeSession(migrated);
    await SecureStore.deleteItemAsync(LEGACY_SESSION_KEY);
    return migrated;
  } catch {
    return null;
  }
}

export async function readSession(): Promise<MobileSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return migrateLegacy();
  try {
    const value: unknown = JSON.parse(raw);
    return validSession(value) ? value : null;
  } catch {
    return null;
  }
}

export async function writeSession(session: MobileSession) {
  if (!validSession(session)) throw new Error('Invalid Pack One mobile session.');
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearSession() {
  await Promise.all([
    SecureStore.deleteItemAsync(SESSION_KEY),
    SecureStore.deleteItemAsync(LEGACY_SESSION_KEY),
  ]);
}
