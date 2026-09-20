import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

export const ACCOUNT_COOKIE='__Host-pack1_account';
export const CSRF_COOKIE='__Secure-pack1_csrf';
export const PLAYER_COOKIE='__Host-pack1_player';
export const ACCOUNT_SESSION_SECONDS=7*24*60*60;
const SAFE_METHODS=new Set(['GET','HEAD','OPTIONS']);

export const digest=value=>createHash('sha256').update(String(value||'')).digest('hex');

function cookieValue(request,name) {
  const raw=String(request.headers.get('cookie')||'');
  for(const part of raw.split(';')) {
    const index=part.indexOf('=');
    if(index<0)continue;
    if(part.slice(0,index).trim()===name)return decodeURIComponent(part.slice(index+1).trim());
  }
  return null;
}

function validOpaque(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value||''));
}

function sameDigest(a,b) {
  if(!/^[a-f0-9]{64}$/.test(a||'')||!/^[a-f0-9]{64}$/.test(b||''))return false;
  return timingSafeEqual(Buffer.from(a),Buffer.from(b));
}

export function accountCookie(request) {
  const value=cookieValue(request,ACCOUNT_COOKIE);
  return validOpaque(value)?value:null;
}

export function playerCookie(request) {
  const value=cookieValue(request,PLAYER_COOKIE);
  return /^p1_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/i.test(String(value||''))?value:null;
}

export function csrfCookie(request) {
  const value=cookieValue(request,CSRF_COOKIE);
  return validOpaque(value)?value:null;
}

export function requireTrustedOrigin(request,allowed=new Set(['https://packone.pro'])) {
  const origin=request.headers.get('origin');
  if(!origin||!allowed.has(origin))throw Object.assign(Error('Origin not allowed.'),{status:403});
  return origin;
}

export async function accountSession(request,query,{required=true,allowLegacy=true,csrf=true}={}) {
  const opaque=accountCookie(request);
  if(opaque) {
    const hash=digest(opaque);
    const result=await query(`SELECT s.session_hash,s.csrf_hash,s.expires_at,u.id user_id,u.email,u.name
      FROM account_sessions s JOIN neon_auth."user" u ON u.id=s.auth_user_id
      WHERE s.session_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
      LIMIT 1`,[hash]);
    const account=result.rows[0];
    if(account) {
      if(csrf&&!SAFE_METHODS.has(request.method)) {
        const supplied=String(request.headers.get('x-pack1-csrf')||'');
        if(!validOpaque(supplied)||!sameDigest(digest(supplied),account.csrf_hash))
          throw Object.assign(Error('Account request could not be verified.'),{status:403});
      }
      return {...account,source:'cookie'};
    }
    // A cookie that matches no row carries no information. It is HttpOnly, so a
    // browser holding a revoked or expired one cannot clear it, and treating it
    // as a hard failure locked guest-capable surfaces, sign-out and the legacy
    // migration below. Fall through and let the caller's own rules decide.
  }
  if(allowLegacy) {
    const token=String(request.headers.get('x-pack1-auth-session')||'').slice(0,512);
    if(token) {
      const result=await query(`SELECT s.token,s."expiresAt" expires_at,u.id user_id,u.email,u.name
        FROM neon_auth.session s JOIN neon_auth."user" u ON u.id=s."userId"
        WHERE s.token=$1 AND s."expiresAt">now() LIMIT 1`,[token]);
      if(result.rows[0])return {...result.rows[0],source:'legacy'};
      throw Object.assign(Error('Account session expired.'),{status:401});
    }
  }
  if(required)throw Object.assign(Error(opaque?'Account session expired.':'Account session required.'),{status:401});
  return null;
}

export async function issueAccountSession(query,auth,{replaceHash=null}={}) {
  if(!auth?.user_id)throw Error('Cannot issue account session without a user.');
  const token=randomBytes(32).toString('base64url');
  const csrf=randomBytes(32).toString('base64url');
  const result=await query(`WITH revoked AS (
      UPDATE account_sessions SET revoked_at=COALESCE(revoked_at,now())
      WHERE $4::text IS NOT NULL AND session_hash=$4 AND revoked_at IS NULL
    ), inserted AS (
      INSERT INTO account_sessions(session_hash,auth_user_id,csrf_hash,expires_at)
      VALUES($1,$2::uuid,$3,now()+interval '7 days')
      RETURNING expires_at
    ) SELECT expires_at FROM inserted`,[digest(token),auth.user_id,digest(csrf),replaceHash]);
  return {token,csrf,expiresAt:result.rows[0]?.expires_at};
}

export async function revokeAccountSession(query,account) {
  if(!account)return;
  if(account.source==='cookie'&&account.session_hash)
    await query('UPDATE account_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE session_hash=$1',[account.session_hash]);
  if(account.source==='legacy'&&account.token)
    await query('DELETE FROM neon_auth.session WHERE token=$1',[account.token]);
}

export async function consumeNeonSession(query,token) {
  if(token)await query('DELETE FROM neon_auth.session WHERE token=$1',[token]);
}

function cookieLines(session) {
  const maxAge=ACCOUNT_SESSION_SECONDS;
  return [
    `${ACCOUNT_COOKIE}=${encodeURIComponent(session.token)}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`,
    `${CSRF_COOKIE}=${encodeURIComponent(session.csrf)}; Path=/; Domain=packone.pro; Max-Age=${maxAge}; Secure; SameSite=Strict`,
  ];
}

export function withAccountCookies(response,session) {
  const headers=new Headers(response.headers);
  for(const line of cookieLines(session))headers.append('set-cookie',line);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

export function withPlayerCookie(response,token,maxAge=365*24*60*60) {
  const headers=new Headers(response.headers);
  headers.append('set-cookie',`${PLAYER_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

export function clearPlayerCookie(response) {
  const headers=new Headers(response.headers);
  headers.append('set-cookie',`${PLAYER_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

export function clearAccountCookies(response) {
  const headers=new Headers(response.headers);
  headers.append('set-cookie',`${ACCOUNT_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`);
  headers.append('set-cookie',`${CSRF_COOKIE}=; Path=/; Domain=packone.pro; Max-Age=0; Secure; SameSite=Strict`);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
