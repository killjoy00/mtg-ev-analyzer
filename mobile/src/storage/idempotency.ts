import * as SecureStore from 'expo-secure-store';

const PRACTICE_KEY = 'packone.mobile.practice.idempotency.v1';

type PracticeKeyRecord = {
  fingerprint: string;
  key: string;
};

function validKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

function makeIdempotencyKey() {
  const random = () => Math.random().toString(36).slice(2, 12);
  return `practice_${Date.now().toString(36)}_${random()}_${random()}`;
}

export async function practiceIdempotencyKey(fingerprint: string) {
  const raw = await SecureStore.getItemAsync(PRACTICE_KEY);
  if (raw) {
    try {
      const record = JSON.parse(raw) as Partial<PracticeKeyRecord>;
      if (record.fingerprint === fingerprint && validKey(record.key)) return record.key;
    } catch {
      // The first regular-practice slice stored the raw key directly. Keep
      // retry compatibility for that exact configuration while upgrading.
      if (fingerprint === 'mixed:' && validKey(raw)) return raw;
    }
  }

  const key = makeIdempotencyKey();
  const record: PracticeKeyRecord = { fingerprint, key };
  await SecureStore.setItemAsync(PRACTICE_KEY, JSON.stringify(record), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

export async function clearPracticeIdempotencyKey() {
  await SecureStore.deleteItemAsync(PRACTICE_KEY);
}
