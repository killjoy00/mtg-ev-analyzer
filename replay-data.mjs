const responseCache = new Map();
let catalogSnapshot = null;
let warmupInstalled = false;

function urlOf(input) {
  try {
    return new URL(String(input), globalThis.location?.href || 'https://magic.planitnow.us/');
  } catch {
    return null;
  }
}

export function rarityBucket(rarity) {
  const value = String(rarity || '').toLowerCase();
  if (value === 'mythic' || value === 'rare') return 0;
  if (value === 'uncommon') return 1;
  if (value === 'common') return 2;
  return 3;
}

export function sortPackByRarity(candidates = []) {
  return candidates
    .map((card, index) => ({ card, index }))
    .sort((a, b) => rarityBucket(a.card?.rarity) - rarityBucket(b.card?.rarity) || a.index - b.index)
    .map(({ card }) => card);
}

export function sortCatalogSets(sets = []) {
  return sets
    .map((set, index) => ({ set, index, date: Date.parse(set?.data_date || '') || 0 }))
    .sort((a, b) => b.date - a.date || a.index - b.index)
    .map(({ set }) => set);
}

export function normalizeReplayPayload(pathname, data) {
  if (!data || typeof data !== 'object') return data;

  if (/\/data\/catalog\.json$/.test(pathname) && Array.isArray(data.sets)) {
    return { ...data, sets: sortCatalogSets(data.sets) };
  }

  if (/\/data\/[^/]+\/shards\/[^/]+\.json$/.test(pathname) && Array.isArray(data.replays)) {
    return {
      ...data,
      replays: data.replays.map((replay) => ({
        ...replay,
        picks: Array.isArray(replay.picks)
          ? replay.picks.map((pick) => ({ ...pick, candidates: sortPackByRarity(pick.candidates || []) }))
          : replay.picks,
      })),
    };
  }

  return data;
}

function isCatalog(url) {
  return Boolean(url && /\/data\/catalog\.json$/.test(url.pathname));
}

function isManifest(url) {
  return Boolean(url && /\/data\/[^/]+\/manifest\.json$/.test(url.pathname));
}

function isReplayResource(url) {
  return Boolean(url && /\/data\/.+\.json$/.test(url.pathname));
}

export async function loadReplayJson(path, label = 'data') {
  const url = urlOf(path);
  if (!url) throw new Error(`Could not load ${label}: invalid URL.`);
  const key = url.href;
  if (!isReplayResource(url)) throw new Error(`Could not load ${label}: unsupported replay resource.`);

  if (!responseCache.has(key)) {
    const request = fetch(url.href, { cache: 'default' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load ${label} (${response.status}).`);
        const data = normalizeReplayPayload(url.pathname, await response.json());
        if (isCatalog(url)) {
          catalogSnapshot = data;
          scheduleWarm();
        }
        return data;
      })
      .catch((error) => {
        responseCache.delete(key);
        throw error;
      });
    responseCache.set(key, request);
  }
  return responseCache.get(key);
}

export function clearReplayCache() {
  responseCache.clear();
  catalogSnapshot = null;
}

function selectedSetId() {
  if (typeof document === 'undefined') return null;
  const requested = new URLSearchParams(globalThis.location?.search || '').get('set');
  return requested || document.querySelector('#set-select')?.value || catalogSnapshot?.sets?.[0]?.id || null;
}

function warmSelectedManifest() {
  if (!catalogSnapshot) return;
  const set = catalogSnapshot.sets?.find((entry) => entry.id === selectedSetId());
  const manifest = set?.manifest || set?.manifest_path;
  const url = urlOf(manifest);
  if (!url || !isManifest(url)) return;
  void loadReplayJson(manifest, set?.name || 'set manifest').catch(() => null);
}

function scheduleWarm() {
  if (typeof document === 'undefined') return;
  if (typeof requestIdleCallback === 'function') requestIdleCallback(warmSelectedManifest, { timeout: 800 });
  else setTimeout(warmSelectedManifest, 100);
}

export function installReplayDataWarmup() {
  if (warmupInstalled || typeof document === 'undefined') return;
  warmupInstalled = true;
  document.addEventListener('change', (event) => {
    if (event.target?.id === 'set-select') scheduleWarm();
  });
}
