import * as SecureStore from 'expo-secure-store';

const PRACTICE_KEY = 'packone.mobile.practice.idempotency.v1';

function makeIdempotencyKey() {
  const random = () => Math.random().toString(36).slice(2, 12);
  return `practice_${Date.now().toString(36)}_${random()}_${random()}`;
}

export async function practiceIdempotencyKey() {
  const existing = await SecureStore.getItemAsync(PRACTICE_KEY);
  if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing;
  const created = makeIdempotencyKey();
  await SecureStore.setItemAsync(PRACTICE_KEY, created, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return created;
}

export async function clearPracticeIdempotencyKey() {
  await SecureStore.deleteItemAsync(PRACTICE_KEY);
}
