const ALLOWED_ORIGINS = new Set([
  'https://packone.pro',
  'https://killjoy00.github.io',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
]);
const TOKEN_PREFIX = 'p1_';
let signingKeyCache = { at: 0, key: null };

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function cors(request) {
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
  for (const [key, value] of Object.entries(cors(request))) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function dbUrl() {
  const url = new URL(process.env.DATABASE_URL);
  const parts = url.hostname.split('.');
  parts[0] = 'api';
  return `https://${parts.join('.')}/sql`;
}

async function query(sql, params = []) {
  const response = await fetch(dbUrl(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Neon-Connection-String': process.env.DATABASE_URL,
      'Neon-Raw-Text-Output': 'true',
      'Neon-Array-Mode': 'true',
    },
    body: JSON.stringify({ query: sql, params: params.map((value) => (value == null ? null : String(value))) }),
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
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    throw Object.assign(new Error('JSON body required.'), { status: 415 });
  }
  const text = await request.text();
  if (text.length > 131072) throw Object.assign(new Error('Request too large.'), { status: 413 });
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}

function normalizeName(value) {
  const cleaned = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  if (cleaned.length < 2) throw Object.assign(new Error('Display name must be 2-24 characters.'), { status: 400 });
  return cleaned;
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

async function secret() {
  const result = await query("SELECT value FROM settings WHERE key='player_secret'");
  if (!result.rows[0]?.value) throw new Error('Player token secret unavailable.');
  return result.rows[0].value;
}

async function signingKey() {
  if (signingKeyCache.key && Date.now() - signingKeyCache.at < 60000) return signingKeyCache.key;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(await secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  signingKeyCache = { at: Date.now(), key };
  return key;
}

async function signature(id) {
  return base64Url(await crypto.subtle.sign('HMAC', await signingKey(), new TextEncoder().encode(id)));
}

async function tokenFor(id) {
  return `${TOKEN_PREFIX}${id}.${await signature(id)}`;
}

async function verifyToken(value) {
  const raw = String(value || '');
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const [id, supplied] = raw.slice(TOKEN_PREFIX.length).split('.');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || '') || !/^[A-Za-z0-9_-]{43}$/.test(supplied || '')) return null;
  return await crypto.subtle.verify(
    'HMAC',
    await signingKey(),
    Buffer.from(supplied, 'base64url'),
    new TextEncoder().encode(id),
  ) ? id : null;
}

async function player(request, required = true) {
  const header = request.headers.get('authorization') || '';
  const id = await verifyToken(header.startsWith('Bearer ') ? header.slice(7) : '');
  if (required && !id) throw Object.assign(new Error('Player session required.'), { status: 401 });
  return id;
}

async function upsertPlayer(id, name) {
  const displayName = normalizeName(name || 'Pack Player');
  await query(
    'INSERT INTO players(id,display_name) VALUES($1::uuid,$2) ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,updated_at=now()',
    [id, displayName],
  );
  return displayName;
}

async function profileMetaByPlayer(playerId) {
  const result = await query(
    `SELECT p.display_name,p.profile_key,p.profile_public,p.favorite_set_id,p.showcase_achievement,
            EXISTS(SELECT 1 FROM account_links a WHERE a.player_id=p.id) claimed
     FROM players p
     WHERE p.id=$1::uuid
     LIMIT 1`,
    [playerId],
  );
  return result.rows[0] || null;
}

function gameDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

async function handleSession(request) {
  const id = crypto.randomUUID();
  const token = await tokenFor(id);
  const payload = await readJson(request).catch(() => ({}));
  const displayName = await upsertPlayer(id, payload.displayName || 'Pack Player');
  const meta = await profileMetaByPlayer(id);
  return json({ token, playerId: id, displayName, profileKey: meta?.profile_key || null });
}

async function route(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'draft-run-runtime' });
  if (request.method === 'POST' && url.pathname === '/v1/session') return handleSession(request);
  return json({ error: 'Not found.' }, 404);
}

const sessionRuntime = {
  async fetch(request) {
    try {
      return withCors(await route(request), request);
    } catch (error) {
      console.error(error);
      const status = Number(error?.status || 500);
      return withCors(json({ error: status === 500 ? 'Request failed. Please try again.' : error.message }, status), request);
    }
  },
};

export default sessionRuntime;
export { query, player, readJson, json, withCors, gameDateKey };
