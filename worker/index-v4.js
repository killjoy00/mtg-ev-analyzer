import baseWorker from './index.js';

const ALLOWED_ORIGINS = new Set(['https://magic.planitnow.us', 'https://killjoy00.github.io', 'http://127.0.0.1:4173', 'http://localhost:4173']);
const TOKEN_KEY = 'player_secret';
const TOKEN_PREFIX = 'p1_';

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function corsHeaders(request) {
  const origin = request.headers.get('origin');
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-pack1-auth-session',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}
function withCors(response, request) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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
    body: JSON.stringify({ query: sql, params: params.map((value) => value == null ? null : String(value)) }),
  });
  if (!response.ok) throw new Error(`Database query failed (${response.status}): ${await response.text()}`);
  const data = await response.json();
  const names = (data.fields || []).map((field) => field.name);
  return {
    rows: (data.rows || []).map((row) => Object.fromEntries(row.map((value, index) => [names[index], value]))),
    rowCount: Number(data.rowCount || 0),
  };
}
async function readJson(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) throw Object.assign(new Error('JSON body required.'), { status: 415 });
  return request.json();
}
function base64Url(buffer) { return Buffer.from(buffer).toString('base64url'); }
async function playerSecret() {
  const result = await query('SELECT value FROM settings WHERE key=$1', [TOKEN_KEY]);
  if (!result.rows[0]?.value) throw new Error('Player token secret unavailable.');
  return result.rows[0].value;
}
async function signature(playerId) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(await playerSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(playerId)));
}
async function playerToken(playerId) { return `${TOKEN_PREFIX}${playerId}.${await signature(playerId)}`; }
async function verifyPackToken(token) {
  const raw = String(token || '');
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const [playerId, supplied] = raw.slice(TOKEN_PREFIX.length).split('.');
  if (!playerId || !supplied) return null;
  return (await signature(playerId)) === supplied ? playerId : null;
}
async function packPlayer(request, required = true) {
  const header = request.headers.get('authorization') || '';
  const playerId = await verifyPackToken(header.startsWith('Bearer ') ? header.slice(7) : '');
  if (required && !playerId) throw Object.assign(new Error('Player session required.'), { status: 401 });
  return playerId;
}
async function authUser(request) {
  const token = String(request.headers.get('x-pack1-auth-session') || '').slice(0, 512);
  if (!token) throw Object.assign(new Error('Account session required.'), { status: 401 });
  const result = await query(`SELECT s."userId" user_id,u.email,u.name FROM neon_auth.session s JOIN neon_auth."user" u ON u.id=s."userId" WHERE s.token=$1 AND s."expiresAt">now() LIMIT 1`, [token]);
  if (!result.rows[0]) throw Object.assign(new Error('Account session expired.'), { status: 401 });
  return result.rows[0];
}
function cleanProps(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value).slice(0, 20)) {
    if (!/^[a-zA-Z0-9_.-]{1,40}$/.test(key)) continue;
    if (['string','number','boolean'].includes(typeof raw) || raw == null) out[key] = typeof raw === 'string' ? raw.slice(0, 240) : raw;
  }
  return out;
}
async function handleEvents(request) {
  const playerId = await packPlayer(request, false);
  const payload = await readJson(request);
  const events = (Array.isArray(payload.events) ? payload.events : [payload]).slice(0, 20);
  let accepted = 0;
  for (const event of events) {
    const name = String(event?.name || '').trim().slice(0, 64);
    if (!/^[a-z0-9_.-]{2,64}$/i.test(name)) continue;
    await query('INSERT INTO analytics_events(player_id,event_name,event_props) VALUES($1::uuid,$2,$3::jsonb)', [playerId, name, JSON.stringify(cleanProps(event.props))]);
    accepted += 1;
  }
  return json({ ok: true, accepted });
}
function cleanMode(value) { if (!['top3','full'].includes(value)) throw Object.assign(new Error('Invalid mode.'), { status: 400 }); return value; }
function cleanSet(value) { const setId=String(value||'').toLowerCase(); if(!/^[a-z0-9_-]{2,24}$/.test(setId)) throw Object.assign(new Error('Invalid set.'),{status:400}); return setId; }
async function handleResult(request) {
  const playerId = await packPlayer(request);
  const p = await readJson(request);
  const score = Math.max(0, Math.min(100, Math.round(Number(p.score))));
  if (!Number.isFinite(score)) throw Object.assign(new Error('Invalid score.'), { status: 400 });
  const id = String(p.clientResultId || '').slice(0, 80);
  if (!/^[a-zA-Z0-9:_-]{6,80}$/.test(id)) throw Object.assign(new Error('Invalid result id.'), { status: 400 });
  const outcome = ['win','tie','loss'].includes(p.outcome) ? p.outcome : null;
  await query(`INSERT INTO game_results(player_id,set_id,mode,score,grade,seed,is_daily,challenge_id,opponent_name,opponent_score,outcome,client_result_id)
    VALUES($1::uuid,$2,$3,$4::int,$5,$6,$7::boolean,$8,$9,$10::int,$11,$12)
    ON CONFLICT(player_id,client_result_id) DO NOTHING`, [playerId, cleanSet(p.setId), cleanMode(p.mode), score, String(p.grade||'').slice(0,12), String(p.seed||'').slice(0,80)||null, Boolean(p.isDaily), String(p.challengeId||'').slice(0,40)||null, String(p.opponentName||'').slice(0,80)||null, Number.isFinite(Number(p.opponentScore)) ? Number(p.opponentScore) : null, outcome, id]);
  return json({ ok: true });
}
async function handleStats(request) {
  const playerId = await packPlayer(request);
  const summary = await query(`SELECT count(*) games,round(avg(score),1) average_score,max(score) best_score,count(*) FILTER (WHERE outcome='win') challenge_wins,count(*) FILTER (WHERE outcome='loss') challenge_losses,count(*) FILTER (WHERE outcome='tie') challenge_ties FROM game_results WHERE player_id=$1::uuid`, [playerId]);
  const bySet = await query(`SELECT set_id,count(*) games,round(avg(score),1) average_score,max(score) best_score FROM game_results WHERE player_id=$1::uuid GROUP BY set_id ORDER BY games DESC,set_id`, [playerId]);
  const byMode = await query(`SELECT mode,count(*) games,round(avg(score),1) average_score,max(score) best_score FROM game_results WHERE player_id=$1::uuid GROUP BY mode ORDER BY mode`, [playerId]);
  const recent = await query(`SELECT played_at,set_id,mode,score,grade,is_daily,challenge_id,opponent_name,opponent_score,outcome,seed,client_result_id FROM game_results WHERE player_id=$1::uuid ORDER BY played_at DESC LIMIT 50`, [playerId]);
  const daily = await query(`SELECT count(*) daily_plays,count(DISTINCT challenge_date) daily_days,max(score) daily_best FROM scores WHERE player_id=$1::uuid`, [playerId]);
  return json({ summary: summary.rows[0] || {}, daily: daily.rows[0] || {}, bySet: bySet.rows, byMode: byMode.rows, recent: recent.rows });
}
async function handleAccountLink(request) {
  const currentPlayer = await packPlayer(request);
  const user = await authUser(request);
  const existing = await query('SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid', [user.user_id]);
  let playerId = existing.rows[0]?.player_id || currentPlayer;
  if (!existing.rows.length) {
    await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid) ON CONFLICT(auth_user_id) DO NOTHING', [user.user_id, currentPlayer]);
  }
  const player = await query('SELECT display_name FROM players WHERE id=$1::uuid', [playerId]);
  return json({ ok: true, playerId, token: await playerToken(playerId), displayName: player.rows[0]?.display_name || user.name || 'Pack Player', email: user.email });
}
async function routeGrowth(request) {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/v1/events') return handleEvents(request);
  if (request.method === 'POST' && url.pathname === '/v1/results') return handleResult(request);
  if (request.method === 'GET' && url.pathname === '/v1/stats') return handleStats(request);
  if (request.method === 'POST' && url.pathname === '/v1/account/link') return handleAccountLink(request);
  return null;
}

export default {
  async fetch(request) {
    try {
      if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), request);
      const growth = await routeGrowth(request);
      if (growth) return withCors(growth, request);
      return baseWorker.fetch(request);
    } catch (error) {
      console.error(error);
      return withCors(json({ error: error?.message || 'Request failed.' }, Number(error?.status || 500)), request);
    }
  },
};
