const config = () => window.PACK1_SUPABASE || {};
const SESSION_PREFIX = 'pack1-supabase-session:';

export function isLeaderboardConfigured() {
  const { url, key } = config();
  return /^https:\/\/[^/]+\.supabase\.co\/?$/i.test(String(url || '')) && String(key || '').length > 20;
}

function baseUrl() {
  return String(config().url || '').replace(/\/$/, '');
}

function storageKey() {
  return `${SESSION_PREFIX}${baseUrl()}`;
}

function parseJwtExpiry(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return Number(JSON.parse(atob(payload)).exp || 0);
  } catch {
    return 0;
  }
}

function loadStoredSession() {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey()) || 'null');
  } catch {
    return null;
  }
}

function saveSession(session) {
  try { window.localStorage.setItem(storageKey(), JSON.stringify(session)); } catch { /* optional */ }
  return session;
}

async function authPost(path, body) {
  const { key } = config();
  const response = await fetch(`${baseUrl()}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || `Auth failed (${response.status}).`);
  return data;
}

async function refreshSession(session) {
  if (!session?.refresh_token) return null;
  try {
    return saveSession(await authPost('token?grant_type=refresh_token', { refresh_token: session.refresh_token }));
  } catch {
    return null;
  }
}

export async function getLeaderboardSession({ create = false } = {}) {
  if (!isLeaderboardConfigured()) return null;
  let session = loadStoredSession();
  const expiry = parseJwtExpiry(session?.access_token || '');
  if (session?.access_token && expiry > (Date.now() / 1000) + 90) return session;
  if (session?.refresh_token) session = await refreshSession(session);
  if (session?.access_token) return session;
  if (!create) return null;
  const created = await authPost('signup', { data: { app: 'pack1' } });
  return saveSession(created);
}

async function rpc(name, args, { authenticated = false } = {}) {
  if (!isLeaderboardConfigured()) throw new Error('Global leaderboard is not configured yet.');
  const { key } = config();
  const session = await getLeaderboardSession({ create: authenticated });
  const token = session?.access_token || key;
  const response = await fetch(`${baseUrl()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args || {}),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) throw new Error(data?.message || data?.hint || `Leaderboard request failed (${response.status}).`);
  return data;
}

export async function submitLeaderboardScore({ setId, mode, score, grade, challengeDate, displayName, details = {} }) {
  const data = await rpc('pack1_submit_score', {
    p_set_id: setId,
    p_mode: mode,
    p_score: score,
    p_grade: grade,
    p_challenge_date: challengeDate,
    p_display_name: displayName,
    p_details: details,
  }, { authenticated: true });
  return Array.isArray(data) ? data[0] : data;
}

export async function updateLeaderboardDisplayName(displayName) {
  await rpc('pack1_set_display_name', { p_display_name: displayName }, { authenticated: true });
}

export async function loadLeaderboard({ period = 'daily', setId = null, mode = 'top3', limit = 50 } = {}) {
  const data = await rpc('pack1_leaderboard', {
    p_period: period,
    p_set_id: setId || null,
    p_mode: mode,
    p_limit: limit,
  });
  return Array.isArray(data) ? data : [];
}
