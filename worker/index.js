import {
  challengeIndex,
  featuredSetId,
  firstPackPicks,
  gradeFullPack,
  gradeTopThree,
  periodStart,
} from './core.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const TOKEN_PREFIX = 'p1_';
const MAX_NAME = 24;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function cleanOrigin(value) {
  return String(value || '').replace(/\/$/, '');
}

function allowedOrigins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || 'https://magic.planitnow.us').split(',').map((value) => value.trim()).filter(Boolean));
}

function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const allowed = allowedOrigins(env);
  if (!origin || !allowed.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function normalizeName(value) {
  const cleaned = String(value || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
  if (cleaned.length < 2) throw new Error('Display name must be 2-24 characters.');
  return cleaned;
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function playerSecret(env) {
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('player_secret', lower(hex(randomblob(32))))").run();
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'player_secret'").first();
  if (!row?.value) throw new Error('Player token secret is unavailable.');
  return String(row.value);
}

async function signature(env, playerId) {
  const secret = await playerSecret(env);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(playerId)));
}

async function issueToken(env) {
  const playerId = crypto.randomUUID();
  return `${TOKEN_PREFIX}${playerId}.${await signature(env, playerId)}`;
}

async function verifyToken(env, token) {
  const raw = String(token || '').trim();
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const [playerId, supplied] = raw.slice(TOKEN_PREFIX.length).split('.');
  if (!playerId || !supplied) return null;
  const expected = await signature(env, playerId);
  if (expected.length !== supplied.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return mismatch === 0 ? playerId : null;
}

async function authPlayer(request, env, required = true) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const playerId = await verifyToken(env, token);
  if (required && !playerId) throw Object.assign(new Error('Player session required.'), { status: 401 });
  return playerId;
}

async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw Object.assign(new Error('JSON body required.'), { status: 415 });
  return request.json();
}

async function cachedJson(url, ttlSeconds = 300) {
  const request = new Request(url, { method: 'GET' });
  try {
    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached.json();
    const response = await fetch(request);
    if (!response.ok) throw new Error(`Static data request failed (${response.status}).`);
    const copy = new Response(response.body, response);
    copy.headers.set('cache-control', `public, max-age=${ttlSeconds}`);
    await cache.put(request, copy.clone());
    return copy.json();
  } catch (error) {
    if (error instanceof TypeError || String(error?.message || '').includes('cache')) {
      const response = await fetch(request);
      if (!response.ok) throw new Error(`Static data request failed (${response.status}).`);
      return response.json();
    }
    throw error;
  }
}

function absoluteStaticUrl(env, path) {
  return new URL(String(path || '').replace(/^\.\//, ''), `${cleanOrigin(env.STATIC_ORIGIN)}/`).toString();
}

async function catalog(env) {
  return cachedJson(absoluteStaticUrl(env, 'data/catalog.json'), 300);
}

async function loadDailyReplay(env, dateKey, setId, mode) {
  const allSets = await catalog(env);
  const setEntry = (allSets.sets || []).find((set) => set.id === setId);
  if (!setEntry) throw Object.assign(new Error('Unknown set.'), { status: 400 });
  const setData = await cachedJson(absoluteStaticUrl(env, setEntry.manifest_path || setEntry.data_path), 300);
  if (Array.isArray(setData.shards) && setData.shards.length) {
    const total = setData.shards.reduce((sum, shard) => sum + Number(shard.replay_count || 0), 0);
    if (!total) throw new Error('Set has no replay shards.');
    let index = challengeIndex(dateKey, setId, mode, total);
    for (const shardMeta of setData.shards) {
      const count = Number(shardMeta.replay_count || 0);
      if (index < count) {
        const shard = await cachedJson(absoluteStaticUrl(env, shardMeta.path), 900);
        const replay = shard.replays?.[index];
        if (!replay) throw new Error('Daily Challenge replay is unavailable.');
        return { replay, setEntry, setData, featured: featuredSetId(allSets) === setId };
      }
      index -= count;
    }
  }
  const replays = setData.replays || [];
  if (!replays.length) throw new Error('Set has no replay drafts.');
  const index = challengeIndex(dateKey, setId, mode, replays.length);
  return { replay: replays[index], setEntry, setData, featured: featuredSetId(allSets) === setId };
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function validMode(value) {
  if (!['top3', 'full'].includes(value)) throw Object.assign(new Error('Invalid mode.'), { status: 400 });
  return value;
}

function validSetId(value) {
  const setId = String(value || '').toLowerCase();
  if (!/^[a-z0-9_-]{2,24}$/.test(setId)) throw Object.assign(new Error('Invalid set.'), { status: 400 });
  return setId;
}

function sanitizeSelections(value, max = 20) {
  if (!Array.isArray(value) || !value.length || value.length > max) throw Object.assign(new Error('Invalid selections.'), { status: 400 });
  return value.map((id) => {
    const clean = String(id || '').slice(0, 160);
    if (!clean) throw Object.assign(new Error('Invalid selection.'), { status: 400 });
    return clean;
  });
}

async function upsertPlayer(env, playerId, displayName) {
  const name = normalizeName(displayName || 'Pack Player');
  await env.DB.prepare(`
    INSERT INTO players (id, display_name, created_at, updated_at)
    VALUES (?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = datetime('now')
  `).bind(playerId, name).run();
  return name;
}

async function handleSession(request, env) {
  const token = await issueToken(env);
  const playerId = await verifyToken(env, token);
  const body = await readJson(request).catch(() => ({}));
  const displayName = normalizeName(body.displayName || 'Pack Player');
  await upsertPlayer(env, playerId, displayName);
  return json({ token, playerId, displayName });
}

async function handlePlayer(request, env) {
  const playerId = await authPlayer(request, env);
  const body = await readJson(request);
  const displayName = await upsertPlayer(env, playerId, body.displayName);
  return json({ ok: true, displayName });
}

async function leaderboardPosition(env, { date, setId, mode, score }) {
  const totalRow = await env.DB.prepare('SELECT count(*) AS total FROM scores WHERE challenge_date = ? AND set_id = ? AND mode = ?')
    .bind(date, setId, mode).first();
  const rankRow = await env.DB.prepare('SELECT 1 + count(DISTINCT score) AS rank FROM scores WHERE challenge_date = ? AND set_id = ? AND mode = ? AND score > ?')
    .bind(date, setId, mode, score).first();
  const total = Number(totalRow?.total || 0);
  const rank = Number(rankRow?.rank || 1);
  const percentile = total ? Math.max(1, Math.ceil((rank / total) * 100)) : 100;
  return { rank, total, percentile };
}

async function handleScore(request, env) {
  const playerId = await authPlayer(request, env);
  const body = await readJson(request);
  const setId = validSetId(body.setId);
  const mode = validMode(body.mode);
  const challengeDate = String(body.challengeDate || '');
  if (challengeDate !== utcToday()) throw Object.assign(new Error("Only today's Daily Challenge can be ranked."), { status: 400 });
  const selections = sanitizeSelections(body.selections, 50);
  const displayName = await upsertPlayer(env, playerId, body.displayName);
  const loaded = await loadDailyReplay(env, challengeDate, setId, mode);
  let result;
  let top1 = null;
  let top2 = null;
  let top3 = null;
  let details = {};
  if (mode === 'top3') {
    const pick = firstPackPicks(loaded.replay)[0];
    if (!pick) throw new Error('Opening pack is unavailable.');
    result = gradeTopThree(pick.candidates, selections, pick.historical_pick_id);
    [top1, top2, top3] = selections;
    details = { overlap: result.overlap, exactPositions: result.exactPositions };
  } else {
    result = gradeFullPack(loaded.replay, selections);
    details = { consensusAgreement: result.consensusAgreement, topThreeAgreement: result.topThreeAgreement };
  }
  const insert = await env.DB.prepare(`
    INSERT OR IGNORE INTO scores
      (player_id, challenge_date, set_id, mode, score, grade, top1, top2, top3, selections_json, details_json, is_featured, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    playerId,
    challengeDate,
    setId,
    mode,
    result.score,
    result.grade,
    top1,
    top2,
    top3,
    JSON.stringify(selections),
    JSON.stringify(details),
    loaded.featured ? 1 : 0,
  ).run();
  const accepted = Number(insert?.meta?.changes || 0) > 0;
  let score = result.score;
  let grade = result.grade;
  if (!accepted) {
    const existing = await env.DB.prepare('SELECT score, grade FROM scores WHERE player_id = ? AND challenge_date = ? AND set_id = ? AND mode = ?')
      .bind(playerId, challengeDate, setId, mode).first();
    score = Number(existing?.score ?? score);
    grade = String(existing?.grade ?? grade);
  }
  const position = await leaderboardPosition(env, { date: challengeDate, setId, mode, score });
  return json({ accepted, challengeDate, setId, mode, score, grade, displayName, ...position });
}

async function handleLeaderboard(request, env) {
  const url = new URL(request.url);
  const period = ['daily', 'weekly', 'monthly', 'all'].includes(url.searchParams.get('period')) ? url.searchParams.get('period') : 'daily';
  const mode = validMode(url.searchParams.get('mode') || 'top3');
  const requestedSet = url.searchParams.get('set') || 'all';
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 50)));
  const startDate = periodStart(period);
  const playerId = await authPlayer(request, env, false);
  const where = ['s.challenge_date >= ?', 's.mode = ?'];
  const binds = [startDate, mode];
  if (requestedSet === 'all') {
    where.push('s.is_featured = 1');
  } else {
    where.push('s.set_id = ?');
    binds.push(validSetId(requestedSet));
  }
  const query = `
    WITH grouped AS (
      SELECT s.player_id,
             p.display_name,
             sum(s.score) AS points,
             round(avg(s.score), 1) AS average_score,
             count(*) AS plays,
             sum(CASE WHEN s.score = 100 THEN 1 ELSE 0 END) AS perfects
      FROM scores s
      JOIN players p ON p.id = s.player_id
      WHERE ${where.join(' AND ')}
      GROUP BY s.player_id, p.display_name
    )
    SELECT dense_rank() OVER (ORDER BY points DESC, average_score DESC, plays DESC) AS rank,
           player_id, display_name, points, average_score, plays, perfects
    FROM grouped
    ORDER BY rank ASC, display_name ASC
    LIMIT ?
  `;
  binds.push(limit);
  const result = await env.DB.prepare(query).bind(...binds).all();
  const rows = (result.results || []).map((row) => ({
    rank: Number(row.rank),
    display_name: row.display_name,
    points: Number(row.points),
    average_score: Number(row.average_score),
    plays: Number(row.plays),
    perfects: Number(row.perfects),
    is_me: Boolean(playerId && row.player_id === playerId),
  }));
  return json(rows);
}

async function handleDistribution(request, env) {
  const url = new URL(request.url);
  const date = String(url.searchParams.get('date') || utcToday());
  const setId = validSetId(url.searchParams.get('set'));
  const mode = validMode(url.searchParams.get('mode') || 'top3');
  if (mode !== 'top3') return json({ total: 0, rows: [] });
  const totalRow = await env.DB.prepare('SELECT count(*) AS total FROM scores WHERE challenge_date = ? AND set_id = ? AND mode = ?')
    .bind(date, setId, mode).first();
  const result = await env.DB.prepare(`
    SELECT top1 AS card_id, count(*) AS count
    FROM scores
    WHERE challenge_date = ? AND set_id = ? AND mode = 'top3' AND top1 IS NOT NULL
    GROUP BY top1
    ORDER BY count DESC, top1 ASC
    LIMIT 12
  `).bind(date, setId).all();
  const total = Number(totalRow?.total || 0);
  return json({
    total,
    rows: (result.results || []).map((row) => ({ card_id: row.card_id, count: Number(row.count), pct: total ? Number(row.count) / total : 0 })),
  });
}

function sanitizeChallengeCard(card) {
  const id = String(card?.id || '').slice(0, 160);
  const name = String(card?.name || '').slice(0, 120);
  const probability = Number(card?.model_probability || 0);
  if (!id || !name || !Number.isFinite(probability) || probability < 0 || probability > 1) throw Object.assign(new Error('Invalid challenge pack.'), { status: 400 });
  let image_url = String(card?.image_url || '').slice(0, 600);
  if (image_url) {
    try {
      const parsed = new URL(image_url);
      if (parsed.protocol !== 'https:') image_url = '';
    } catch { image_url = ''; }
  }
  return { id, name, model_probability: probability, image_url };
}

async function handleCreateChallenge(request, env) {
  const playerId = await authPlayer(request, env);
  const body = await readJson(request);
  const setId = validSetId(body.setId);
  const setName = String(body.setName || setId.toUpperCase()).slice(0, 40);
  const pack = Array.isArray(body.pack) ? body.pack.slice(0, 20).map(sanitizeChallengeCard) : [];
  if (pack.length < 3) throw Object.assign(new Error('Challenge pack is incomplete.'), { status: 400 });
  const selectedIds = sanitizeSelections(body.selectedIds, 3);
  if (selectedIds.length !== 3) throw Object.assign(new Error('Challenge requires a Top 3.'), { status: 400 });
  const result = gradeTopThree(pack, selectedIds, String(body.historicalId || ''));
  const displayName = await upsertPlayer(env, playerId, body.displayName);
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  await env.DB.prepare(`
    INSERT INTO share_challenges
      (id, player_id, display_name, set_id, set_name, pack_json, historical_id, selected_json, score, grade, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(id, playerId, displayName, setId, setName, JSON.stringify(pack), String(body.historicalId || ''), JSON.stringify(selectedIds), result.score, result.grade).run();
  return json({ id, score: result.score, grade: result.grade, displayName });
}

async function handleGetChallenge(id, env) {
  const row = await env.DB.prepare(`
    SELECT id, display_name, set_id, set_name, pack_json, historical_id, selected_json, score, grade, created_at
    FROM share_challenges WHERE id = ?
  `).bind(id).first();
  if (!row) return json({ error: 'Challenge not found.' }, 404);
  return json({
    id: row.id,
    setId: row.set_id,
    setName: row.set_name,
    pack: JSON.parse(row.pack_json),
    historicalId: row.historical_id || '',
    creator: {
      displayName: row.display_name,
      selectedIds: JSON.parse(row.selected_json),
      score: Number(row.score),
      grade: row.grade,
    },
    createdAt: row.created_at,
  });
}

async function route(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'pack1-api', version: 1, date: utcToday() });
  if (request.method === 'POST' && url.pathname === '/v1/session') return handleSession(request, env);
  if (request.method === 'PATCH' && url.pathname === '/v1/player') return handlePlayer(request, env);
  if (request.method === 'POST' && url.pathname === '/v1/scores') return handleScore(request, env);
  if (request.method === 'GET' && url.pathname === '/v1/leaderboard') return handleLeaderboard(request, env);
  if (request.method === 'GET' && url.pathname === '/v1/distribution') return handleDistribution(request, env);
  if (request.method === 'POST' && url.pathname === '/v1/challenges') return handleCreateChallenge(request, env);
  const challengeMatch = url.pathname.match(/^\/v1\/challenges\/([a-f0-9]{12})$/);
  if (request.method === 'GET' && challengeMatch) return handleGetChallenge(challengeMatch[1], env);
  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return withCors(await route(request, env), request, env);
    } catch (error) {
      console.error(error);
      return withCors(json({ error: error?.message || 'Request failed.' }, Number(error?.status || 500)), request, env);
    }
  },
};
