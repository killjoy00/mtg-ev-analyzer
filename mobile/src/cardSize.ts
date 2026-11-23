import { useEffect, useSyncExternalStore } from 'react';
import { config } from '@/src/config';

export type CardSize = 'compact' | 'standard' | 'large';
export const CARD_SIZES: readonly CardSize[] = ['compact', 'standard', 'large'];
const STORAGE_KEY = 'packone.mobile.card-size.v1';
const STORAGE_READ_TIMEOUT_MS = 1200;

// A single device-wide preference, not a per-run value. Screens that mount
// after the first read get the cached value immediately; a cold-start game
// waits for the read rather than drawing Standard and then jumping.
let cached: CardSize | null = null;
let inFlight: Promise<CardSize> | null = null;
const subscribers = new Set<() => void>();
const subscribe = (notify: () => void) => { subscribers.add(notify); return () => { subscribers.delete(notify); }; };
const snapshot = () => cached;
function publish(value: CardSize) {
  cached = value;
  for (const notify of subscribers) notify();
}
export function useCardSizePreference() {
  const size = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { void readCardSize(); }, []);
  return { size: size ?? 'standard', ready: size !== null };
}

export function normalizeCardSize(value: unknown): CardSize {
  return value === 'compact' || value === 'large' ? value : 'standard';
}
export function cardSizeLabel(size: CardSize) {
  return size === 'compact' ? 'Compact' : size === 'large' ? 'Large' : 'Standard';
}
export function nextCardSize(size: CardSize): CardSize {
  return size === 'standard' ? 'compact' : size === 'compact' ? 'large' : 'standard';
}

export function cardColumnCount(size: CardSize, tablet: boolean, largeText: boolean) {
  if (size === 'large') return tablet ? 2 : 1;
  if (size === 'compact') return tablet ? (largeText ? 3 : 4) : (largeText ? 2 : 3);
  return tablet ? 3 : 2;
}

async function store() {
  // Unsigned iOS screenshot simulators cannot use the Keychain.
  return config.screenshots.fixtures
    ? import('@/src/screenshots/storage')
    : import('expo-secure-store');
}

async function loadStoredCardSize(): Promise<CardSize> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Do not block a first pick forever if the OS Keychain/Keystore stalls.
    // A late storage response may not reflow already visible cards.
    const storageRead = (async () => normalizeCardSize(await (await store()).getItemAsync(STORAGE_KEY)))();
    const fallback = new Promise<CardSize>(resolve => {
      timeout = setTimeout(() => resolve('standard'), STORAGE_READ_TIMEOUT_MS);
    });
    return await Promise.race([storageRead, fallback]);
  } catch { return 'standard'; }
  finally { if (timeout !== undefined) clearTimeout(timeout); }
}
export async function readCardSize(): Promise<CardSize> {
  if (cached !== null) return cached;
  if (inFlight !== null) return inFlight;
  inFlight = (async () => {
    const next = await loadStoredCardSize();
    // A user tap during the initial load takes precedence over the disk read.
    if (cached === null) publish(next);
    return cached ?? next;
  })();
  try { return await inFlight; }
  finally { inFlight = null; }
}
export async function writeCardSize(size: CardSize) {
  const next = normalizeCardSize(size);
  publish(next);
  try { await (await store()).setItemAsync(STORAGE_KEY, next); }
  catch { /* Keep the in-memory preference when device storage is unavailable. */ }
}
