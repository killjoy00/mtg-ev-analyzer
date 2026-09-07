const TOKEN_KEY = 'pack1-api-session-v1';
const NAME_KEY = 'pack1-player-name-v1';

function config() { return window.PACK1_API || {}; }
function baseUrl() { return String(config().url || '').replace(/\/$/, ''); }
export function isLeaderboardConfigured() { return /^https:\/\//.test(baseUrl()); }

function displayName() {
  try { return window.localStorage.getItem(NAME_KEY) || 'Pack Player'; } catch { return 'Pack Player'; }
}
function loadToken() { try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function saveToken(token) { try { window.localStorage.setItem(TOKEN_KEY, token); } catch {} return token; }

async function request(path, options = {}, { auth = false } = {}) {
  if (!isLeaderboardConfigured()) throw new Error('Global leaderboard is not configured yet.');
  const headers = new Headers(options.headers || {});
  headers.set('content-type', 'application/json');
  if (auth) headers.set('authorization', `Bearer ${await ensureSession()}`);
  const response = await fetch(`${baseUrl()}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Pack 1 API failed (${response.status}).`);
  return data;
}

async function ensureSession() {
  const existing = loadToken();
  if (existing) return existing;
  const data = await request('/v1/session', {
    method: 'POST',
    body: JSON.stringify({ displayName: displayName() }),
  });
  return saveToken(data.token);
}

function captureTopThree() {
  return [...document.querySelectorAll('.card-choice')]
    .map((node) => ({ id: node.dataset.cardId, rank: Number(node.querySelector('.user-rank-badge')?.textContent || 0) }))
    .filter((item) => item.id && item.rank)
    .sort((a, b) => a.rank - b.rank)
    .map((item) => item.id);
}

function captureSelections(mode) {
  if (mode === 'top3') return captureTopThree();
  return Array.isArray(window.PACK1_CAPTURED_PICKS) ? [...window.PACK1_CAPTURED_PICKS] : [];
}

export async function submitLeaderboardScore({ setId, mode, score, grade, challengeDate, displayName: name }) {
  const data = await request('/v1/scores', {
    method: 'POST',
    body: JSON.stringify({
      setId, mode, challengeDate,
      displayName: name || displayName(),
      selections: captureSelections(mode),
      clientScore: score,
      clientGrade: grade,
    }),
  }, { auth: true });
  window.PACK1_LAST_SUBMISSION = data;
  return data;
}

export async function loadLeaderboard({ period = 'daily', setId = null, mode = 'top3', limit = 50 } = {}) {
  const params = new URLSearchParams({ period, set: setId || 'all', mode, limit: String(limit) });
  const token = loadToken();
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return request(`/v1/leaderboard?${params}`, { headers });
}

export async function updateLeaderboardDisplayName(name) {
  return request('/v1/player', { method: 'PATCH', body: JSON.stringify({ displayName: name }) }, { auth: true });
}

export async function createShareChallenge(payload) {
  return request('/v1/challenges', { method: 'POST', body: JSON.stringify(payload) }, { auth: true });
}

export async function loadShareChallenge(id) {
  return request(`/v1/challenges/${encodeURIComponent(id)}`);
}

export async function loadCommunityDistribution({ date, setId, mode = 'top3' }) {
  const params = new URLSearchParams({ date, set: setId, mode });
  return request(`/v1/distribution?${params}`);
}
