const nativeFetch = globalThis.fetch?.bind(globalThis);
const shardCache = new Map();
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

function isSameOriginData(url) {
  return Boolean(url && url.origin === globalThis.location?.origin && /\/data\//.test(url.pathname));
}

function isCatalog(url) {
  return isSameOriginData(url) && /\/data\/catalog\.json$/.test(url.pathname);
}

function isManifest(url) {
  return isSameOriginData(url) && /\/data\/[^/]+\/manifest\.json$/.test(url.pathname);
}

function isShard(url) {
  return isSameOriginData(url) && /\/data\/[^/]+\/shards\/[^/]+\.json$/.test(url.pathname);
}

async function fetchNormalizedShard(input, init, url) {
  const key = url.href;
  if (!shardCache.has(key)) {
    const promise = (async () => {
      const response = await nativeFetch(input, { ...(init || {}), cache: 'default' });
      if (!response.ok) {
        return {
          body: await response.text(),
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get('content-type') || 'application/json',
        };
      }
      const normalized = normalizeReplayPayload(url.pathname, await response.json());
      return {
        body: JSON.stringify(normalized),
        status: response.status,
        statusText: response.statusText,
        contentType: 'application/json; charset=utf-8',
      };
    })().catch((error) => {
      shardCache.delete(key);
      throw error;
    });
    shardCache.set(key, promise);
  }

  const stored = await shardCache.get(key);
  return new Response(stored.body, {
    status: stored.status,
    statusText: stored.statusText,
    headers: { 'content-type': stored.contentType },
  });
}

function rememberCatalog(response) {
  if (!response?.ok) return;
  void response.clone().json().then((data) => {
    catalogSnapshot = normalizeReplayPayload('/data/catalog.json', data);
    scheduleWarm();
  }).catch(() => null);
}

function warmSelectedManifest() {
  if (!catalogSnapshot || typeof document === 'undefined') return;
  const selectedId = document.querySelector('#set-select')?.value || catalogSnapshot.featured_set || catalogSnapshot.sets?.[0]?.id;
  const set = catalogSnapshot.sets?.find((entry) => entry.id === selectedId);
  const manifest = set?.manifest || set?.manifest_path;
  if (!manifest) return;
  void nativeFetch(manifest, { cache: 'default' }).catch(() => null);
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
    if (method !== 'GET') return nativeFetch(input, init);

    if (isShard(url)) return fetchNormalizedShard(input, init, url);

    if (isCatalog(url) || isManifest(url)) {
      const responsePromise = nativeFetch(input, { ...(init || {}), cache: 'default' });
      if (isCatalog(url)) void responsePromise.then(rememberCatalog).catch(() => null);
      return responsePromise;
    }

    return nativeFetch(input, init);
  };

  document.addEventListener('change', (event) => {
    if (event.target?.id === 'set-select') scheduleWarm();
  });
}
