const TOKEN_KEY = 'pack1-api-session-v1';
const AUTH_TOKEN_KEY = 'pack1-auth-session-v1';
const NAME_KEY = 'pack1-player-name-v1';
const CSRF_COOKIE = '__Secure-pack1_csrf';
const GOOGLE_RETURN = 'https://packone.pro/?auth=google';
const ACCOUNT_RETURN = 'https://packone.pro/';
let sessionPromise = null, migrationPromise = null;

function baseUrl() { return String(window.PACK1_API?.growthUrl || window.PACK1_API?.url || '').replace(/\/$/, ''); }
function draftUrl() { return String(window.PACK1_API?.draftRunUrl || '').replace(/\/$/, ''); }
function authBase() { return String(window.PACK1_API?.authBase || '').replace(/\/$/, ''); }
export function firstPartyAuthEnabled() { return window.PACK1_API?.firstParty === true; }
function loadPackToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function loadAuthToken() { try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; } }
function displayName() { try { return localStorage.getItem(NAME_KEY) || 'Pack Player'; } catch { return 'Pack Player'; } }
function cookie(name) {
  if(typeof document==='undefined')return null;
  for(const part of String(document.cookie||'').split(';')) {
    const index=part.indexOf('=');
    if(index>=0&&part.slice(0,index).trim()===name)return decodeURIComponent(part.slice(index+1).trim());
  }
  return null;
}
export function accountCsrfToken() { return firstPartyAuthEnabled()?cookie(CSRF_COOKIE):null; }
export function hasAccountSession() { return firstPartyAuthEnabled()?Boolean(accountCsrfToken()):Boolean(loadAuthToken()); }
// Compatibility helper for callers that only need a signed-in hint. In the
// first-party path this never exposes an account credential.
export const storedAccountToken = () => firstPartyAuthEnabled()?(hasAccountSession()?'first-party':''):loadAuthToken();
function clearLegacyAuth() {
  try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch {}
  globalThis.dispatchEvent?.(new Event('packone-account-changed'));
}
export function savePackToken(token) { try { localStorage.setItem(TOKEN_KEY, token); } catch {} return token; }
export function packApiConfigured() { return /^https:\/\//.test(baseUrl()); }

function csrfHeaders(method,headers) {
  if(firstPartyAuthEnabled()&&!['GET','HEAD','OPTIONS'].includes(method)) {
    const csrf=accountCsrfToken();
    if(csrf)headers.set('x-pack1-csrf',csrf);
  }
  return headers;
}

async function raw(path,{method='GET',body,headers=new Headers(),credentials=firstPartyAuthEnabled()?'include':'omit',keepalive=false}={}) {
  const response=await fetch(`${baseUrl()}${path}`,{
    method,
    headers:csrfHeaders(method,new Headers(headers)),
    body:body===undefined?undefined:JSON.stringify(body),
    credentials,
    keepalive,
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.error||data.message||`Pack 1 API failed (${response.status}).`),{status:response.status,code:data.code||null});
  return data;
}

async function migrateLegacyPlayer() {
  const legacy=loadPackToken();
  if(!legacy||!firstPartyAuthEnabled())return false;
  try {
    await raw('/v1/player/migrate',{method:'POST',body:{},headers:new Headers({'content-type':'application/json','x-pack1-player-session':legacy})});
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    return true;
  } catch(error) {
    // Only a 401 proves the stored guest token is unusable, so only then is it
    // safe to drop. Anything else is environmental and must not reject: this
    // runs ahead of every authenticated call, and throwing here would fail the
    // whole client instead of letting the player-session call report the fault.
    if(error?.status===401) { try { localStorage.removeItem(TOKEN_KEY); } catch {} }
    return false;
  }
}

async function ensureBrowserPlayerSession() {
  await migrateLegacyPlayer();
  return raw('/v1/player/session',{method:'POST',body:{displayName:displayName()},headers:new Headers({'content-type':'application/json'})});
}

export async function ensurePackSession() {
  if(firstPartyAuthEnabled()) {
    if(sessionPromise)return sessionPromise;
    sessionPromise=ensureBrowserPlayerSession().catch(error=>{sessionPromise=null;throw error;});
    return sessionPromise;
  }
  const existing=loadPackToken();
  if(existing)return existing;
  if(sessionPromise)return sessionPromise;
  sessionPromise=createLegacyPackSession().finally(()=>{sessionPromise=null;});
  return sessionPromise;
}

async function createLegacyPackSession() {
  if(!packApiConfigured())throw new Error('Pack 1 API unavailable.');
  const response=await fetch(`${baseUrl()}/v1/session`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:displayName()}),
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.token)throw new Error(data.error||'Could not create Pack 1 guest session.');
  return savePackToken(data.token);
}

async function migrateLegacyAccount() {
  if(!firstPartyAuthEnabled())return false;
  const legacy=loadAuthToken();
  if(!legacy)return false;
  await ensurePackSession();
  try {
    await raw('/v1/account/migrate',{method:'POST',body:{},headers:new Headers({'content-type':'application/json','x-pack1-auth-session':legacy})});
    clearLegacyAuth();
    return true;
  } catch(error) {
    if(error?.status===401||error?.status===403) {
      clearLegacyAuth();
      return false;
    }
    throw error;
  }
}

async function ensureMigrations() {
  if(!firstPartyAuthEnabled())return;
  if(migrationPromise)return migrationPromise;
  migrationPromise=(async()=>{await ensurePackSession();await migrateLegacyAccount();})().finally(()=>{migrationPromise=null;});
  return migrationPromise;
}

async function api(path,{method='GET',body,auth=true,authSession=null}={}) {
  if(!packApiConfigured())throw new Error('Pack 1 API unavailable.');
  if(firstPartyAuthEnabled()) {
    if(auth)await ensurePackSession();
    const headers=new Headers({'content-type':'application/json'});
    return raw(path,{method,body,headers,keepalive:path==='/v1/events'});
  }
  const headers=new Headers({'content-type':'application/json'});
  if(auth)headers.set('authorization',`Bearer ${await ensurePackSession()}`);
  if(authSession)headers.set('x-pack1-auth-session',authSession);
  const response=await fetch(`${baseUrl()}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),keepalive:path==='/v1/events'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.error||`Pack 1 API failed (${response.status}).`),{status:response.status});
  return data;
}

export async function sendEvents(events) {
  if(!packApiConfigured())return null;
  try{return await api('/v1/events',{method:'POST',body:{events},auth:true});}catch{return null;}
}
export async function saveGameResult(result) {
  if(!packApiConfigured())return null;
  try{return await api('/v1/results',{method:'POST',body:result,auth:true});}catch{return null;}
}
export async function loadRemoteStats() {
  if(!packApiConfigured())return null;
  try{return await api('/v1/stats',{auth:true});}catch{return null;}
}
export async function loadAccountDailyDates() {
  if(!packApiConfigured())return [];
  if(firstPartyAuthEnabled()) {
    try {await ensureMigrations();const data=await api('/v1/account/daily-dates',{auth:false});return Array.isArray(data.dates)?data.dates:[];} catch{return [];}
  }
  const authSession=loadAuthToken();
  if(!authSession)return [];
  try {const data=await api('/v1/account/daily-dates',{auth:false,authSession});return Array.isArray(data.dates)?data.dates:[];}catch{return [];}
}
export async function linkAccount(authSessionToken=loadAuthToken(),{validateDailyRunId=null}={}) {
  if(firstPartyAuthEnabled()) {
    await ensureMigrations();
    const data=await api('/v1/account/link-browser',{method:'POST',body:{...(validateDailyRunId?{validateDailyRunId}:{})},auth:true});
    return data;
  }
  if(!authSessionToken)throw new Error('Account session required.');
  const data=await api('/v1/account/link',{method:'POST',body:{...(validateDailyRunId?{validateDailyRunId}:{})},auth:true,authSession:authSessionToken});
  if(data.token)savePackToken(data.token);
  return data;
}

export async function loadDailyStatus() {
  const base=draftUrl();
  if(firstPartyAuthEnabled()) {
    await ensureMigrations();
    const response=await fetch(`${base}/v1/daily-status`,{credentials:'include',signal:AbortSignal.timeout(15000)});
    if(response.status===404)return loadMyProfile();
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'Daily progress is unavailable.');
    return data;
  }
  const token=await ensurePackSession(),auth=loadAuthToken();
  const response=await fetch(`${base}/v1/daily-status`,{headers:{authorization:`Bearer ${token}`,...(auth?{'x-pack1-auth-session':auth}:{})},signal:AbortSignal.timeout(15000)});
  if(response.status===404)return loadMyProfile();
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Daily progress is unavailable.');
  return data;
}

export async function loadMyProfile(){return api('/v1/profile/me',{auth:true});}
export async function loadPublicProfile(profileKey){return api(`/v1/profile/${encodeURIComponent(profileKey)}`,{auth:false});}
export async function updateProfile({displayName,profilePublic,favoriteSetId,showcaseAchievement}={}) {
  const body={};
  if(displayName!==undefined)body.displayName=String(displayName??'');
  if(typeof profilePublic==='boolean')body.profilePublic=profilePublic;
  if(favoriteSetId!==undefined)body.favoriteSetId=favoriteSetId;
  if(showcaseAchievement!==undefined)body.showcaseAchievement=showcaseAchievement;
  if(firstPartyAuthEnabled())await ensureMigrations();
  else if(!loadAuthToken())throw new Error('Sign in to change account settings.');
  const data=await api('/v1/profile',{method:'PATCH',body,auth:true,authSession:firstPartyAuthEnabled()?null:loadAuthToken()});
  if(data?.player?.display_name){try{localStorage.setItem(NAME_KEY,data.player.display_name);}catch{}}
  return data;
}
export async function loadProfileHistory({profileKey=null,cursor=null,limit=25}={}) {
  const params=new URLSearchParams({limit:String(limit)});
  if(cursor)params.set('cursor',String(cursor));
  const path=profileKey?`/v1/profile/${encodeURIComponent(profileKey)}/history?${params}`:`/v1/profile/history?${params}`;
  return api(path,{auth:!profileKey});
}
export async function lookupPublicProfiles(names) {
  const unique=[...new Set((names||[]).map(name=>String(name||'').trim()).filter(Boolean))].slice(0,100);
  if(!unique.length||!packApiConfigured())return {};
  try {const data=await api('/v1/profile-lookup',{method:'POST',body:{names:unique},auth:false});return data?.profiles&&typeof data.profiles==='object'?data.profiles:{};}catch{return {};}
}

export async function authRequest(path,{method='GET',body}={}) {
  if(firstPartyAuthEnabled()) {
    const mapped=path==='/sign-up/email'?'/v1/account/signup':path==='/sign-in/email'?'/v1/account/signin':null;
    if(!mapped)throw new Error('Unsupported account request.');
    return api(mapped,{method,body,auth:false});
  }
  const base=authBase();if(!/^https:\/\//.test(base))throw new Error('Account provider is not configured.');
  const response=await fetch(`${base}${path}`,{
    method,headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.message||data.error||`Account request failed (${response.status}).`);
  return data;
}

export async function getAuthSession() {
  if(firstPartyAuthEnabled()) {
    try {
      await ensureMigrations();
      const data=await api('/v1/account/session',{auth:false});
      return data?.user?data:null;
    } catch(error) {
      if(error?.status===401||error?.status===403)return null;
      throw error;
    }
  }
  const token=loadAuthToken();
  if(!token||!packApiConfigured())return null;
  try {
    const data=await api('/v1/account/session',{auth:false,authSession:token});
    return data?.user?data:null;
  } catch(error) {
    if(error?.status===401||error?.status===403){clearLegacyAuth();return null;}
    throw error;
  }
}
export async function loadPatreonStatus() {
  if(firstPartyAuthEnabled()) {
    try {await ensureMigrations();return await api('/v1/patreon/status',{auth:false});}
    catch(error){if(error?.status===401)return {configured:false,connected:false,capabilities:[]};throw error;}
  }
  const authSession=loadAuthToken();
  if(!authSession)return {configured:false,connected:false,capabilities:[]};
  return api('/v1/patreon/status',{auth:false,authSession});
}
export async function connectPatreon() {
  if(firstPartyAuthEnabled()){await ensureMigrations();return api('/v1/patreon/connect',{method:'POST',body:{},auth:false});}
  const authSession=loadAuthToken();if(!authSession)throw new Error('Sign in before connecting Patreon.');
  return api('/v1/patreon/connect',{method:'POST',body:{},auth:false,authSession});
}
export async function disconnectPatreon() {
  if(firstPartyAuthEnabled()){await ensureMigrations();return api('/v1/patreon/disconnect',{method:'POST',body:{},auth:false});}
  const authSession=loadAuthToken();if(!authSession)throw new Error('Sign in before disconnecting Patreon.');
  return api('/v1/patreon/disconnect',{method:'POST',body:{},auth:false,authSession});
}

export async function signUpAccount({name,email,password}) {
  if(firstPartyAuthEnabled())return authRequest('/sign-up/email',{method:'POST',body:{name,email,password}});
  const data=await authRequest('/sign-up/email',{method:'POST',body:{name,email,password}});
  if(data?.token){try{localStorage.setItem(AUTH_TOKEN_KEY,data.token);}catch{}globalThis.dispatchEvent?.(new Event('packone-account-changed'));}
  return data;
}
export async function signInAccount({email,password}) {
  if(firstPartyAuthEnabled())return authRequest('/sign-in/email',{method:'POST',body:{email,password,rememberMe:true}});
  const data=await authRequest('/sign-in/email',{method:'POST',body:{email,password,rememberMe:true}});
  if(data?.token){try{localStorage.setItem(AUTH_TOKEN_KEY,data.token);}catch{}globalThis.dispatchEvent?.(new Event('packone-account-changed'));}
  return data;
}

export async function requestPasswordReset(email) {
  return api('/v1/account/request-password-reset',{method:'POST',body:{email:String(email||'')},auth:false});
}

export async function resetPassword({token,newPassword}) {
  return api('/v1/account/reset-password',{method:'POST',body:{token:String(token||''),newPassword:String(newPassword||'')},auth:false});
}

export async function changeAccountPassword({currentPassword,newPassword}) {
  if(!firstPartyAuthEnabled())throw new Error('Password management requires the secure account session.');
  await ensureMigrations();
  const data=await api('/v1/account/password-change',{
    method:'POST',
    body:{currentPassword:String(currentPassword||''),newPassword:String(newPassword||'')},
    auth:false,
  });
  clearLegacyAuth();
  return data;
}
export async function deleteAccount({currentPassword}={}) {
  if(!firstPartyAuthEnabled())throw new Error('Account deletion requires the secure account session.');
  await ensureMigrations();
  const data=await api('/v1/account/delete',{
    method:'POST',
    body:{currentPassword:String(currentPassword||''),confirm:true},
    auth:false,
  });
  clearLegacyAuth();
  try {
    for(const key of [TOKEN_KEY,NAME_KEY,'pack1-game-history-v2','pack1-daily-history-v1'])localStorage.removeItem(key);
  } catch {}
  sessionPromise=null;
  return data;
}

export async function startGoogleSignIn() {
  if(!firstPartyAuthEnabled())throw new Error('Google sign in is not available on this release yet.');
  await ensurePackSession();
  const provider=authBase();if(!/^https:\/\//.test(provider))throw new Error('Google sign in is temporarily unavailable.');
  const response=await fetch(`${provider}/sign-in/social`,{
    method:'POST',
    headers:{'content-type':'application/json'},
    credentials:'include',
    body:JSON.stringify({
      provider:'google',
      callbackURL:GOOGLE_RETURN,
      newUserCallbackURL:GOOGLE_RETURN,
      errorCallbackURL:ACCOUNT_RETURN+'?auth=google-error',
      disableRedirect:true,
    }),
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.message||data.error||'Google sign in is temporarily unavailable.');
  let target=null;
  try {target=new URL(String(data?.url||''));} catch {}
  if(!target||target.protocol!=='https:')throw new Error('Google sign in is temporarily unavailable.');
  location.assign(target.toString());
}

export async function completeGoogleSignIn() {
  if(!firstPartyAuthEnabled())throw new Error('Google sign in is not available on this release yet.');
  const verifier=new URL(location.href).searchParams.get('neon_auth_session_verifier');
  if(!verifier)throw new Error('Google sign in did not return a session verifier.');
  await ensurePackSession();
  const provider=authBase();if(!/^https:\/\//.test(provider))throw new Error('Google sign in is temporarily unavailable.');
  const sessionResponse=await fetch(`${provider}/get-session?neon_auth_session_verifier=${encodeURIComponent(verifier)}`,{
    credentials:'include',
    headers:{accept:'application/json'},
  });
  const data=await sessionResponse.json().catch(()=>({}));
  if(!sessionResponse.ok||!data?.session?.token||!data?.user)
    throw new Error(data.message||data.error||'Google sign in could not be finalized.');
  await raw('/v1/account/migrate',{
    method:'POST',
    body:{},
    headers:new Headers({'content-type':'application/json','x-pack1-auth-session':data.session.token}),
  });
  clearLegacyAuth();
  return {user:data.user,session:data.session};
}
export async function signOutAccount() {
  if(firstPartyAuthEnabled()) {
    try {await ensureMigrations();await api('/v1/account/signout',{method:'POST',body:{},auth:false});}catch{}
    clearLegacyAuth();
  } else {
    const token=loadAuthToken();
    if(token&&packApiConfigured()){try{await api('/v1/account/signout',{method:'POST',body:{},auth:false,authSession:token});}catch{}}
    clearLegacyAuth();
  }
  try {
    for(const key of [TOKEN_KEY,NAME_KEY,'pack1-game-history-v2','pack1-daily-history-v1'])localStorage.removeItem(key);
  } catch {}
  sessionPromise=null;
  return {ok:true};
}
