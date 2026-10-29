import {observedRoute,tagBackendResponse} from './backend-diagnostics.mjs';
import {releaseMetadata} from './release.mjs';
import {guardIngress} from './ingress-auth.mjs';
import {readJson} from './request-json.mjs';
import { GAME_TIME_ZONE, gameDateKey } from './core.mjs';
import { isRetiredLegacyRoute, RETIRED_MODES_MESSAGE } from './retired-modes.mjs';
import { PLACEHOLDER_USERNAME, normalizeDisplayName } from './username.mjs';

const ALLOWED_ORIGINS = new Set(['https://packone.pro', 'https://killjoy00.github.io']);
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

const normalizeName = normalizeDisplayName;

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

async function playerSecret() {
  await query("INSERT INTO settings(key,value) VALUES('player_secret',$1) ON CONFLICT(key) DO NOTHING",[Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')]);
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


// Legacy identity updates may contain a name from an old client. An owned username is off limits to
// that: it would replace an account's public identity, or collide with the
// player who owns the name. The stored name wins and is echoed back.
async function upsertPlayer(playerId, displayName) {
  const name = normalizeName(displayName || PLACEHOLDER_USERNAME);
  const result = await query(
    `INSERT INTO players(id,display_name) VALUES($1::uuid,$2)
     ON CONFLICT(id) DO UPDATE SET
       display_name=CASE WHEN players.username_owned THEN players.display_name ELSE EXCLUDED.display_name END,
       updated_at=now()
     RETURNING display_name`,
    [playerId, name],
  );
  return result.rows[0]?.display_name || name;
}

async function handleSession(request) {
  const payload = await readJson(request);
  const token = await issueToken();
  const playerId = await verifyToken(token);
  const displayName = await upsertPlayer(playerId, payload.displayName || 'Pack Player');
  return json({ token, playerId, displayName });
}

async function handlePlayer(request) {
  const playerId = await authPlayer(request);
  const payload = await readJson(request);
  const displayName = await upsertPlayer(playerId, payload.displayName);
  return json({ ok: true, displayName });
}

async function route(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, ...releaseMetadata(), service: 'pack1-api', version: 5, scoring: null, retiredModes: ['full', 'top3'], date: gameDateKey(), timeZone: GAME_TIME_ZONE });
  if (request.method === 'POST' && url.pathname === '/v1/session') return handleSession(request);
  if (request.method === 'PATCH' && url.pathname === '/v1/player') return handlePlayer(request);
  if (isRetiredLegacyRoute(url.pathname, request.method)) return json({ error: RETIRED_MODES_MESSAGE, code: 'mode_retired' }, 410);
  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request) {
    const denied=guardIngress(request);if(denied)return denied;
    try {
      return withCors(await observedRoute(request,'legacy',route), request);
    } catch (error) {
      console.error(error);
      const status=Number(error?.status||500);
      return withCors(tagBackendResponse(json({ error: status===500?'Request failed. Please try again.':error.message },status),error), request);
    }
  },
};
