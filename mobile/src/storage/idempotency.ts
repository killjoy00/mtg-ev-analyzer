import * as SecureStore from 'expo-secure-store';

const PRACTICE_KEY = 'packone.mobile.practice.idempotency.v1';
const VALID_KEY = /^[A-Za-z0-9_-]{16,128}$/;

type PendingPractice = {
  fingerprint: string;
  key: string;
};

function makeIdempotencyKey() {
  const random = () => Math.random().toString(36).slice(2, 12);
  return `practice_${Date.now().toString(36)}_${random()}_${random()}`;
}

function decodePending(raw: string | null): PendingPractice | null {
  if (!raw) return null;
  if (VALID_KEY.test(raw)) return { fingerprint: 'mixed:', key: raw };
  try {
    const parsed = JSON.parse(raw) as Partial<PendingPractice>;
    if (typeof parsed.fingerprint !== 'string' || !VALID_KEY.test(parsed.key ?? '')) return null;
    return { fingerprint: parsed.fingerprint, key: parsed.key as string };
  } catch {
    return null;
  }
}

export async function practiceIdempotencyKey(fingerprint: string) {
  const existing = decodePending(await SecureStore.getItemAsync(PRACTICE_KEY));
  if (existing?.fingerprint === fingerprint) return existing.key;

  const pending: PendingPractice = { fingerprint, key: makeIdempotencyKey() };
  await SecureStore.setItemAsync(PRACTICE_KEY, JSON.stringify(pending), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return pending.key;
}

export async function clearPracticeIdempotencyKey() {
  await SecureStore.deleteItemAsync(PRACTICE_KEY);
}
