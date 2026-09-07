const nativeFetch = globalThis.fetch?.bind(globalThis);
const responseCache = new Map();
let installed = false;
let catalogSnapshot = null;

function urlOf(input) {
  try {
    if (typeof input === 'string') return new URL(input, globalThis.location?.href || 'https://magic.planitnow.us/');
    if (input?.url) return new URL(input.url, globalThis.location?.href || 'https://magic.planitnow.us/');
  } catch {}
  return null;
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

function isStaticReplayJson(url) {
  if (!url || url.origin !== globalThis.location?.origin) return false;
  return /\/data\/(?:catalog\.json|[^/]+\/manifest\.json|[^/]+\/shards\/[^/]+\.json)$/.test(url.pathname);
}

async function fetchStaticJson(input, init, url) {
  const key = url.href;
  if (!responseCache.has(key)) {
    const promise = (async () => {
      const response = await nativeFetch(input, { ...(init || {}), cache: 'force-cache' });
      const text = await response.text();
      let body = text;
      if (response.ok) {
        try {
          const normalized = normalizeReplayPayload(url.pathname, JSON.parse(text));
          if (/\/data\/catalog\.json$/.test(url.pathname)) catalogSnapshot = normalized;
          body = JSON.stringify(normalized);
        } catch {}
      }
      return {
        body,
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
      };
    })().catch((error) => {
      responseCache.delete(key);
      throw error;
    });
    responseCache.set(key, promise);
  }

  const stored = await responseCache.get(key);
  return new Response(stored.body, {
    status: stored.status,
    statusText: stored.statusText,
    headers: stored.headers,
  });
}

function warmSelectedManifest() {
  if (!catalogSnapshot || typeof document === 'undefined') return;
  const selectedId = document.querySelector('#set-select')?.value || catalogSnapshot.featured_set;
  const set = catalogSnapshot.sets?.find((entry) => entry.id === selectedId);
  const manifest = set?.manifest || set?.manifest_path;
  if (!manifest) return;
  void globalThis.fetch(manifest, { cache: 'force-cache' }).catch(() => null);
}

function scheduleWarm() {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(warmSelectedManifest, { timeout: 800 });
  else setTimeout(warmSelectedManifest, 100);
}

export function installReplayRuntime() {
  if (installed || !nativeFetch || typeof window === 'undefined') return;
  installed = true;

  globalThis.fetch = function packOneFetch(input, init) {
    const url = urlOf(input);
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    if (method === 'GET' && isStaticReplayJson(url)) return fetchStaticJson(input, init, url);
    return nativeFetch(input, init);
  };

  document.addEventListener('change', (event) => {
    if (event.target?.id === 'set-select') scheduleWarm();
  });

  const app = document.querySelector('#app');
  if (app) new MutationObserver(scheduleWarm).observe(app, { childList: true, subtree: false });
  scheduleWarm();
}
