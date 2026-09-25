export function seedHash(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed) {
  let value = seedHash(seed) || 0x6d2b79f5;
  return function random() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cleanSeed(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
}

export function makeGameSeed(randomUUID) {
  const raw = typeof randomUUID === 'function'
    ? randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return cleanSeed(raw) || Date.now().toString(36);
}

export function gameShareUrl({ origin, setId, mode, seed, score = null, name = null }) {
  const url = new URL(origin);
  url.searchParams.set('set', String(setId || ''));
  url.searchParams.set('mode', String(mode || 'top3'));
  url.searchParams.set('seed', cleanSeed(seed));
  const hasScore = score !== null && score !== undefined && score !== '';
  if (hasScore && Number.isFinite(Number(score))) url.searchParams.set('vs', String(Math.round(Number(score))));
  if (name) url.searchParams.set('by', String(name).slice(0, 24));
  return url.toString();
}
