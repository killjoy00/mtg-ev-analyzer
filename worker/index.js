import { challengeIndex, featuredSetId, firstPackPicks, gameDateKey, gradeFullPack, gradeTopThree, periodStart } from './core.mjs';

const STATIC_ORIGIN = 'https://magic.planitnow.us';
const ALLOWED_ORIGINS = new Set(['https://magic.planitnow.us', 'https://killjoy00.github.io']);
const TOKEN_PREFIX = 'p1_';

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function corsHeaders(request) {
  const origin = request.headers.get('origin');
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function databaseHttpUrl() {
  const url = new URL(process.env.DATABASE_URL);
  const parts = url.hostname.split('.');
  parts[0] = 'api';
  return `https://${parts.join('.')}/sql`;
}

async function query(sql, params = []) {
  const response = await fetch(databaseHttpUrl(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Neon-Connection-String': process.env.DATABASE_URL,
      'Neon-Raw-Text-Output': 'true',
      'Neon-Array-Mode': 'true',
    },
    body: JSON.stringify({
      query: sql,
      params: params.map((value) => (value == null ? null : String(value))),
    }),
  });
  if (!response.ok) throw new Error(`Database query failed (${response.status}): ${await response.text()}`);
  const data = await response.json();
  const names = (data.fields || []).map((field) => field.name);
  return {
    rows: (data.rows || []).map((row) => Object.fromEntries(row.map((value, index) => [names[index], value]))),
    rowCount: Number(data.rowCount || 0),
  };
}

function normalizeName(value) {
  const cleaned = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  if (cleaned.length < 2) throw Object.assign(new Error('Display name must be 2-24 characters.'), { status: 400 });
  return cleaned;
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

async function playerSecret() {
  await query("INSERT INTO settings(key,value) VALUES('player_secret',md5(random()::text||clock_timestamp()::text)||md5(random()::text||clock_timestamp()::text)) ON CONFLICT(key) DO NOTHING");
  const result = await query("SELECT value FROM settings WHERE key='player_secret'");
  if (!result.rows[0]?.value) throw new Error('Player token secret unavailable.');
  return result.rows[0].value;
}

async function signature(playerId) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(await playerSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(playerId)));
}

async function issueToken() {
  const playerId = crypto.randomUUID();
  return `${TOKEN_PREFIX}${playerId}.${await signature(playerId)}`;
}

async function verifyToken(token) {
  const raw = String(token || '');
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const [playerId, supplied] = raw.slice(TOKEN_PREFIX.length).split('.');
  if (!playerId || !supplied) return null;
  return (await signature(playerId)) === supplied ? playerId : null;
}

async function authPlayer(request, required = true) {
  const header = request.headers.get('authorization') || '';
  const playerId = await verifyToken(header.startsWith('Bearer ') ? header.slice(7) : '');
  if (required && !playerId) throw Object.assign(new Error('Player session required.'), { status: 401 });
  return playerId;
}

async function readJson(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    throw Object.assign(new Error('JSON body required.'), { status: 415 });
  }
  return request.json();
}

async function upsertPlayer(playerId, displayName) {
  const name = normalizeName(displayName || 'Pack Player');
  await query(
    'INSERT INTO players(id,display_name) VALUES($1::uuid,$2) ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,updated_at=now()',
    [playerId, name],
  );
  return name;
}

async function staticJson(path) {
  const response = await fetch(new URL(String(path).replace(/^\.\//, ''), `${STATIC_ORIGIN}/`));
  if (!response.ok) throw new Error(`Static data request failed (${response.status}).`);
  return response.json();
}

async function loadDailyReplay(date, setId, mode) {
  const catalog = await staticJson('data/catalog.json');
  const setEntry = (catalog.sets || []).find((set) => set.id === setId);
  if (!setEntry) throw Object.assign(new Error('Unknown set.'), { status: 400 });
  const setData = await staticJson(setEntry.manifest_path || setEntry.data_path);
  const pathModel = mode === 'full'
    ? await staticJson(setEntry.path_model_path || `data/${setId}/path-model.json`)
    : null;
  if (setData.shards?.length) {
    const total = setData.shards.reduce((sum, shard) => sum + Number(shard.replay_count || 0), 0);
    let index = challengeIndex(date, setId, mode, total);
    for (const shardMeta of setData.shards) {
      const count = Number(shardMeta.replay_count || 0);
      if (index < count) {
        const shard = await staticJson(shardMeta.path);
        return { replay: shard.replays?.[index], featured: featuredSetId(catalog) === setId, pathModel };
      }
      index -= count;
    }
  }
  const replays = setData.replays || [];
  return {
    replay: replays[challengeIndex(date, setId, mode, replays.length)],
    featured: featuredSetId(catalog) === setId,
    pathModel,
  };
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

function sanitizeSelections(value, max = 50) {
  if (!Array.isArray(value) || !value.length || value.length > max) {
    throw Object.assign(new Error('Invalid selections.'), { status: 400 });
  }
  return value.map((id) => String(id || '').slice(0, 160));
}

async function handleSession(request) {
  const token = await issueToken();
  const playerId = await verifyToken(token);
  const payload = await readJson(request).catch(() => ({}));
  const displayName = await upsertPlayer(playerId, payload.displayName || 'Pack Player');
  return json({ token, playerId, displayName });
}

async function handlePlayer(request) {
  const playerId = await authPlayer(request);
  const payload = await readJson(request);
  const displayName = await upsertPlayer(playerId, payload.displayName);
  return json({ ok: true, displayName });
}

async function leaderboardPosition(date, setId, mode, score) {
  const totalResult = await query(
    'SELECT count(*) total FROM scores WHERE challenge_date=$1::date AND set_id=$2 AND mode=$3',
    [date, setId, mode],
  );
  const rankResult = await query(
    'SELECT 1+count(DISTINCT score) rank FROM scores WHERE challenge_date=$1::date AND set_id=$2 AND mode=$3 AND score>$4::int',
    [date, setId, mode, score],
  );
  const total = Number(totalResult.rows[0]?.total || 0);
  const rank = Number(rankResult.rows[0]?.rank || 1);
  const percentile = total >= 10 ? Math.max(1, Math.ceil((rank / total) * 100)) : null;
  return { rank, total, percentile };
}

async function handleScore(request) {
  const playerId = await authPlayer(request);
  const payload = await readJson(request);
  const setId = validSetId(payload.setId);
  const mode = validMode(payload.mode);
  const challengeDate = String(payload.challengeDate || '');
  if (challengeDate !== gameDateKey()) {
    throw Object.assign(new Error("Only today's Daily Challenge can be ranked."), { status: 400 });
  }
  const selections = sanitizeSelections(payload.selections);
  const displayName = await upsertPlayer(playerId, payload.displayName);
  const loaded = await loadDailyReplay(challengeDate, setId, mode);
  if (!loaded.replay) throw new Error('Daily Challenge replay unavailable.');

  let result;
  let top = [null, null, null];
  let details;
  if (mode === 'top3') {
    const pick = firstPackPicks(loaded.replay)[0];
    result = gradeTopThree(pick.candidates, selections, pick.historical_pick_id);
    top = selections;
    details = { overlap: result.overlap, exactPositions: result.exactPositions };
  } else {
    result = gradeFullPack(loaded.replay, selections, loaded.pathModel);
    details = {
      consensusAgreement: result.consensusAgreement,
      topThreeAgreement: result.topThreeAgreement,
    };
  }

  const inserted = await query(
    `INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,top1,top2,top3,selections_json,details_json,is_featured)
     VALUES($1::uuid,$2::date,$3,$4,$5::int,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::boolean)
     ON CONFLICT(player_id,challenge_date,set_id,mode) DO NOTHING
     RETURNING score,grade`,
    [
      playerId,
      challengeDate,
      setId,
      mode,
      result.score,
      result.grade,
      top[0],
      top[1],
      top[2],
      JSON.stringify(selections),
      JSON.stringify(details),
      loaded.featured,
    ],
  );

  let accepted = inserted.rowCount > 0;
  let score = result.score;
  let grade = result.grade;
  if (!accepted) {
    const existing = await query(
      'SELECT score,grade FROM scores WHERE player_id=$1::uuid AND challenge_date=$2::date AND set_id=$3 AND mode=$4',
      [playerId, challengeDate, setId, mode],
    );
    score = Number(existing.rows[0]?.score ?? score);
    grade = existing.rows[0]?.grade || grade;
  }

  return json({
    accepted,
    challengeDate,
    setId,
    mode,
    score,
    grade,
    displayName,
    ...(await leaderboardPosition(challengeDate, setId, mode, score)),
  });
}

async function handleLeaderboard(request) {
  const url = new URL(request.url);
  const period = ['daily', 'weekly', 'monthly', 'all'].includes(url.searchParams.get('period'))
    ? url.searchParams.get('period')
    : 'daily';
  const mode = validMode(url.searchParams.get('mode') || 'top3');
  const requestedSet = url.searchParams.get('set') || 'all';
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 50)));
  const startDate = periodStart(period);
  const currentPlayer = await authPlayer(request, false);

  const featured = requestedSet === 'all';
  const extraWhere = featured ? 'AND s.is_featured=true' : 'AND s.set_id=$3';
  const params = featured
    ? [startDate, mode, limit]
    : [startDate, mode, validSetId(requestedSet), limit];
  const limitParam = featured ? '$3' : '$4';

  const result = await query(
    `WITH grouped AS (
       SELECT s.player_id,
              p.display_name,
              sum(s.score) points,
              round(avg(s.score),1) average_score,
              count(*) plays,
              sum(CASE WHEN s.score=100 THEN 1 ELSE 0 END) perfects
       FROM scores s
       JOIN players p ON p.id=s.player_id
       WHERE s.challenge_date >= $1::date AND s.mode=$2 ${extraWhere}
       GROUP BY s.player_id,p.display_name
     )
     SELECT dense_rank() OVER(ORDER BY points DESC,average_score DESC,plays DESC) rank,
            player_id,display_name,points,average_score,plays,perfects
     FROM grouped
     ORDER BY rank,display_name
     LIMIT ${limitParam}::int`,
    params,
  );

  return json(result.rows.map((row) => ({
    rank: Number(row.rank),
    display_name: row.display_name,
    points: Number(row.points),
    average_score: Number(row.average_score),
    plays: Number(row.plays),
    perfects: Number(row.perfects),
    is_me: Boolean(currentPlayer && row.player_id === currentPlayer),
  })));
}

async function handleDistribution(request) {
  const url = new URL(request.url);
  const date = String(url.searchParams.get('date') || gameDateKey());
  const setId = validSetId(url.searchParams.get('set'));
  const mode = validMode(url.searchParams.get('mode') || 'top3');
  if (mode !== 'top3') return json({ total: 0, rows: [] });

  const totalResult = await query(
    "SELECT count(*) total FROM scores WHERE challenge_date=$1::date AND set_id=$2 AND mode='top3'",
    [date, setId],
  );
  const distribution = await query(
    "SELECT top1 card_id,count(*) count FROM scores WHERE challenge_date=$1::date AND set_id=$2 AND mode='top3' AND top1 IS NOT NULL GROUP BY top1 ORDER BY count DESC,top1 LIMIT 12",
    [date, setId],
  );
  const total = Number(totalResult.rows[0]?.total || 0);
  return json({
    total,
    rows: distribution.rows.map((row) => ({
      card_id: row.card_id,
      count: Number(row.count),
      pct: total ? Number(row.count) / total : 0,
    })),
  });
}

function sanitizeChallengeCard(card) {
  const id = String(card?.id || '').slice(0, 160);
  const name = String(card?.name || '').slice(0, 120);
  const probability = Number(card?.model_probability || 0);
  const image_url = String(card?.image_url || '').slice(0, 600);
  if (!id || !name || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw Object.assign(new Error('Invalid challenge pack.'), { status: 400 });
  }
  return { id, name, model_probability: probability, image_url };
}

async function handleCreateChallenge(request) {
  const playerId = await authPlayer(request);
  const payload = await readJson(request);
  const setId = validSetId(payload.setId);
  const setName = String(payload.setName || setId.toUpperCase()).slice(0, 40);
  const pack = Array.isArray(payload.pack) ? payload.pack.slice(0, 20).map(sanitizeChallengeCard) : [];
  const selectedIds = sanitizeSelections(payload.selectedIds, 3);
  if (pack.length < 3 || selectedIds.length !== 3) {
    throw Object.assign(new Error('Challenge requires a complete pack and Top 3.'), { status: 400 });
  }
  const result = gradeTopThree(pack, selectedIds, String(payload.historicalId || ''));
  const displayName = await upsertPlayer(playerId, payload.displayName);
  const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);

  await query(
    'INSERT INTO share_challenges(id,player_id,display_name,set_id,set_name,pack_json,historical_id,selected_json,score,grade) VALUES($1,$2::uuid,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::int,$10)',
    [
      id,
      playerId,
      displayName,
      setId,
      setName,
      JSON.stringify(pack),
      String(payload.historicalId || ''),
      JSON.stringify(selectedIds),
      result.score,
      result.grade,
    ],
  );

  return json({ id, score: result.score, grade: result.grade, displayName });
}

async function handleGetChallenge(id) {
  const result = await query(
    'SELECT id,display_name,set_id,set_name,pack_json,historical_id,selected_json,score,grade,created_at FROM share_challenges WHERE id=$1',
    [id],
  );
  const row = result.rows[0];
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

async function route(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'pack1-api', version: 3, date: gameDateKey(), timeZone: 'America/New_York' });
  if (request.method === 'POST' && url.pathname === '/v1/session') return handleSession(request);
  if (request.method === 'PATCH' && url.pathname === '/v1/player') return handlePlayer(request);
  if (request.method === 'POST' && url.pathname === '/v1/scores') return handleScore(request);
  if (request.method === 'GET' && url.pathname === '/v1/leaderboard') return handleLeaderboard(request);
  if (request.method === 'GET' && url.pathname === '/v1/distribution') return handleDistribution(request);
  if (request.method === 'POST' && url.pathname === '/v1/challenges') return handleCreateChallenge(request);
  const challengeMatch = url.pathname.match(/^\/v1\/challenges\/([a-f0-9]{12})$/);
  if (request.method === 'GET' && challengeMatch) return handleGetChallenge(challengeMatch[1]);
  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request) {
    try {
      return withCors(await route(request), request);
    } catch (error) {
      console.error(error);
      return withCors(json({ error: error?.message || 'Request failed.' }, Number(error?.status || 500)), request);
    }
  },
};
