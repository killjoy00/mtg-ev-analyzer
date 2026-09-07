const TOKEN_KEY = 'pack1-api-session-v1';
const AUTH_TOKEN_KEY = 'pack1-auth-session-v1';
const AUTH_USER_KEY = 'pack1-auth-user-v1';
const AUTH_BASE = 'https://ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth';

function baseUrl() { return String(window.PACK1_API?.url || '').replace(/\/$/, ''); }
function loadPackToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function loadAuthToken() { try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; } }
function saveAuth(data) {
  if (!data?.token) return data;
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    if (data.user) localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
  } catch {}
  return data;
}
function clearAuth() { try { localStorage.removeItem(AUTH_TOKEN_KEY); localStorage.removeItem(AUTH_USER_KEY); } catch {} }
export function savePackToken(token) { try { localStorage.setItem(TOKEN_KEY, token); } catch {} return token; }
export function packApiConfigured() { return /^https:\/\//.test(baseUrl()); }

async function api(path, { method='GET', body, auth=true, authSession=null } = {}) {
  if (!packApiConfigured()) throw new Error('Pack 1 API unavailable.');
  const headers = new Headers({ 'content-type': 'application/json' });
  if (auth) {
    const token = loadPackToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
  }
  if (authSession) headers.set('x-pack1-auth-session', authSession);
  const response = await fetch(`${baseUrl()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Pack 1 API failed (${response.status}).`);
  return data;
}

export async function sendEvents(events) {
  if (!packApiConfigured()) return null;
  try { return await api('/v1/events', { method:'POST', body:{ events }, auth:true }); } catch { return null; }
}
export async function saveGameResult(result) {
  if (!packApiConfigured() || !loadPackToken()) return null;
  try { return await api('/v1/results', { method:'POST', body:result, auth:true }); } catch { return null; }
}
export async function loadRemoteStats() {
  if (!packApiConfigured() || !loadPackToken()) return null;
  try { return await api('/v1/stats', { auth:true }); } catch { return null; }
}
export async function linkAccount(authSessionToken = loadAuthToken()) {
  if (!authSessionToken) throw new Error('Account session required.');
  const data = await api('/v1/account/link', { method:'POST', body:{}, auth:true, authSession:authSessionToken });
  if (data.token) savePackToken(data.token);
  return data;
}

export async function authRequest(path, { method='GET', body } = {}) {
  const response = await fetch(`${AUTH_BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type':'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Account request failed (${response.status}).`);
  return data;
}
export async function getAuthSession() {
  const token = loadAuthToken();
  if (!token || !packApiConfigured()) return null;
  try {
    const data = await api('/v1/account/session', { auth:false, authSession:token });
    if (data?.user) {
      try { localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user)); } catch {}
      return data;
    }
  } catch { clearAuth(); }
  return null;
}
export async function signUpAccount({ name, email, password }) {
  return saveAuth(await authRequest('/sign-up/email', { method:'POST', body:{ name, email, password } }));
}
export async function signInAccount({ email, password }) {
  return saveAuth(await authRequest('/sign-in/email', { method:'POST', body:{ email, password, rememberMe:true } }));
}
export async function signOutAccount() {
  const token = loadAuthToken();
  if (token && packApiConfigured()) {
    try { await api('/v1/account/signout', { method:'POST', body:{}, auth:false, authSession:token }); } catch {}
  }
  clearAuth();
  return { ok:true };
}
