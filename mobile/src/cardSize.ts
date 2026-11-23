import { config } from '@/src/config';

export type CardSize = 'compact' | 'standard' | 'large';
export const CARD_SIZES: readonly CardSize[] = ['compact', 'standard', 'large'];
const STORAGE_KEY = 'packone.mobile.card-size.v1';

export function normalizeCardSize(value: unknown): CardSize {
  return value === 'compact' || value === 'large' ? value : 'standard';
}

export function cardColumnCount(size: CardSize, tablet: boolean, largeText: boolean) {
  if (size === 'large') return tablet ? 2 : 1;
  if (size === 'compact') return tablet ? (largeText ? 3 : 4) : (largeText ? 2 : 3);
  return tablet ? 3 : 2;
}

async function store() {
  // Unsigned iOS simulator screenshot builds cannot use the Keychain.
  return config.screenshots.fixtures
    ? import('@/src/screenshots/storage')
    : import('expo-secure-store');
}

export async function readCardSize(): Promise<CardSize> {
  try { return normalizeCardSize(await (await store()).getItemAsync(STORAGE_KEY)); }
  catch { return 'standard'; } // Preferences never block the game.
}

export async function writeCardSize(size: CardSize) {
  try { await (await store()).setItemAsync(STORAGE_KEY, normalizeCardSize(size)); }
  catch { /* Non-critical preference; keep the current in-memory choice. */ }
}
