import {isIP} from 'node:net';
import {readJson} from '../worker/request-json.mjs';
import {PROD_ORIGINS} from '../worker/account-config.mjs';

const SERVICES={legacy:'pack1api',growth:'pack1growth',draft:'draftrunapi'};
const PROD_BRANCH='br-orange-feather-ayps8kep';
const DEV_BRANCH='br-twilight-hill-ayffyd2b';
const ORIGINS=new Set(PROD_ORIGINS);
const COOKIE_NAMES=new Set(['__Host-pack1_account','__Secure-pack1_csrf','__Host-pack1_player']);
const response=(status,error,headers={})=>Response.json({error},{status,headers:{'cache-control':'no-store',...headers}});
const secret=value=>/^[a-f0-9]{64}$/.test(value||'');
const encode=new TextEncoder();

export function ipNetwork(value) {
  if(isIP(value)===4)return value;
  if(isIP(value)!==6)throw Error('Missing network identity');
  const normalized=new URL(`http://[${value}]/`).hostname.slice(1,-1);
  const [left,right]=normalized.split('::');
  const a=left?left.split(':'):[],b=right?right.split(':'):[];
  const parts=right===undefined?a:[...a,...Array(8-a.length-b.length).fill('0'),...b];
  return parts.slice(0,4).map(x=>parseInt(x,16).toString(16)).join(':')+'::/64';
}

function adminPath(path,method) {
  if(method==='POST'&&path==='/v1/admin/claim')return true;
  if(method==='GET'&&path==='/v1/admin/measurements')return true;
  if(method==='GET'&&/^\/v1\/admin\/decisions\/[a-z0-9_-]{6,120}$/.test(path))return true;
  if(/^\/v1\/admin\/users(?:\/[a-f0-9-]{36})?$/.test(path)&&method==='GET')return true;
  if(path==='/v1/admin/corpus'&&method==='GET')return true;
  if(/^\/v1\/admin\/corpus\/[a-z0-9-]{2,80}(?:\/components\/[a-z0-9_.-]{2,120})?\/status$/.test(path)&&method==='POST')return true;
  if(/^\/v1\/admin\/corpus\/[a-z0-9-]{2,80}\/snapshot$/.test(path)&&method==='POST')return true;
  return false;
}

function permitted(service,path,method,search,mode) {
  if(method==='GET'&&path==='/health')return search==='?quick=1';
  if(service==='growth') {
    if(method==='POST'&&[
      '/v1/session','/v1/player/session','/v1/player/migrate',
      '/v1/account/signup','/v1/account/signin','/v1/account/send-verification-email','/v1/account/request-password-reset','/v1/account/reset-password','/v1/account/password-change','/v1/account/delete/verification/start','/v1/account/delete/apple/start','/v1/account/delete/apple/finish','/v1/account/delete','/v1/account/migrate',
      '/v1/account/link','/v1/account/link-browser','/v1/account/signout','/v1/account/apple/start','/v1/account/apple/finish','/v1/account/apple/callback',
      '/v1/mobile/account/signup','/v1/mobile/account/signin','/v1/mobile/account/apple/start','/v1/mobile/account/apple/finish','/v1/mobile/account/apple/native','/v1/mobile/account/google/start','/v1/mobile/account/google/finish',
      '/v1/mobile/account/signout','/v1/mobile/account/delete/verification/start','/v1/mobile/account/delete/apple/start','/v1/mobile/account/delete/apple/finish','/v1/mobile/account/delete',
      '/v1/events','/v1/results','/v1/profile-lookup','/v1/patreon/connect','/v1/patreon/disconnect',
    ].includes(path))return true;
    if(method==='GET'&&[
      '/v1/account/session','/v1/account/daily-dates','/v1/account/google/callback',
      '/v1/mobile/account/google/callback','/v1/mobile/account/session','/v1/mobile/version',
      '/v1/mobile/profile/me','/v1/mobile/profile/history',
      '/v1/stats','/v1/profile/me','/v1/profile/history','/v1/patreon/status',
    ].includes(path))return true;
    if(method==='GET'&&/^\/v1\/profile\/[a-f0-9]{16}(?:\/history)?$/.test(path))return true;
    if(method==='GET'&&/^\/v1\/mobile\/profile\/[a-f0-9]{16}$/.test(path))return true;
    return method==='PATCH'&&(path==='/v1/profile'||path==='/v1/mobile/profile');
  }
  if(service==='draft') {
    if(method==='POST'&&path==='/v1/runs')return true;
    if(method==='POST'&&/^\/v1\/runs\/[a-f0-9-]+\/(pick|reroll|share|view)$/.test(path))return true;
    if(method==='GET'&&['/v1/leaderboard','/v1/daily-status','/v1/capabilities','/v1/practice-sets','/v1/set-catalog'].includes(path))return true;
    if(method==='GET'&&/^\/v1\/runs\/[a-f0-9-]+$/.test(path))return true;
    if(method==='GET'&&/^\/v1\/(?:challenges|shared-runs)\/[a-f0-9]+$/.test(path))return true;
    return mode==='production'&&adminPath(path,method);
  }
  return (method==='POST'&&['/v1/session','/v1/scores','/v1/challenges'].includes(path))||
    (method==='PATCH'&&path==='/v1/player')||
    (method==='GET'&&(['/v1/leaderboard','/v1/distribution'].includes(path)||/^\/v1\/challenges\/[a-f0-9]{12}$/.test(path)));
}

function selectedCookies(request) {
  const selected=[],raw=String(request.headers.get('cookie')||'');
  for(const part of raw.split(';')) {
    const item=part.trim(),index=item.indexOf('=');
    if(index<0)continue;
    if(COOKIE_NAMES.has(item.slice(0,index)))selected.push(item);
  }
  return selected.join('; ');
}
function cookieValue(cookieHeader,name) {
  for(const part of String(cookieHeader||'').split(';')) {
    const item=part.trim(),index=item.indexOf('=');
    if(index>=0&&item.slice(0,index)===name)return decodeURIComponent(item.slice(index+1));
  }
  return null;
}
// Neon functions can only emit one Set-Cookie header, so several cookies arrive
// joined in a single value. Split every line, not just the one read through the
// fallback: runtimes that expose getSetCookie return that joined value as a
// single entry, so splitting only there never ran. The lookahead keeps this a
// no-op for a lone cookie, and the account cookies use Max-Age precisely so no
// Expires comma can be mistaken for this boundary.
const COOKIE_BOUNDARY=/,\s*(?=__(?:Host|Secure)-pack1_)/;
function upstreamSetCookies(headers) {
  let lines=[];
  if(typeof headers.getSetCookie==='function')lines=headers.getSetCookie();
  else if(typeof headers.getAll==='function') {
    try {lines=headers.getAll('set-cookie')||[];} catch {lines=[];}
  }
  if(!lines.length) {
    const value=headers.get('set-cookie');
    lines=value?[value]:[];
  }
  return lines.flatMap(line=>String(line).split(COOKIE_BOUNDARY));
}
function publicCookie(line) {
  return /^(?:__Host-pack1_(?:account|player)|__Secure-pack1_csrf)=/.test(String(line||''));
}
// The CSRF token is a double-submit value the page reads from document.cookie on
// packone.pro, so it has to be scoped to the parent domain. The account worker
// writes Domain=packone.pro, but the Neon runtime strips a Domain its own host
// does not own. This gateway does own it - api.packone.pro is a subdomain - so
// restore the attribute here. Without it the cookie is host-only to
// api.packone.pro, the page cannot read the token, and every account write is
// refused as unverified. __Host- cookies must stay host-only and are untouched.
function scopedCookie(line) {
  const value=String(line||'');
  if(!value.startsWith('__Secure-pack1_csrf=')||/;\s*Domain=/i.test(value))return value;
  return value.replace(/;\s*Path=\//i,'; Path=/; Domain=packone.pro');
}
function validMobileSession(value) {
  return /^p1_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/i.test(String(value||''));
}
function validMobileAccount(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value||''));
}
function mobileSessionRoute(service,path,method) {
  if(service==='growth') {
    if(method==='POST'&&[
      '/v1/mobile/account/signup','/v1/mobile/account/signin','/v1/mobile/account/apple/start',
      '/v1/mobile/account/apple/finish','/v1/mobile/account/apple/native','/v1/mobile/account/google/start',
      '/v1/mobile/account/google/finish','/v1/mobile/account/signout',
      '/v1/mobile/account/request-password-reset','/v1/mobile/account/send-verification-email','/v1/mobile/account/reset-password','/v1/mobile/account/password-change',
      '/v1/mobile/account/delete/verification/start','/v1/mobile/account/delete/apple/start','/v1/mobile/account/delete/apple/finish','/v1/mobile/account/delete',
    ].includes(path))return true;
    if(method==='GET'&&/^\/v1\/mobile\/profile\/[a-f0-9]{16}$/.test(path))return true;
    return method==='GET'&&['/v1/mobile/account/session','/v1/mobile/profile/me','/v1/mobile/profile/history'].includes(path);
  }
  if(service!=='draft')return false;
  if(method==='POST'&&path==='/v1/runs')return true;
  if(method==='POST'&&/^\/v1\/runs\/[a-f0-9-]+\/(pick|reroll|share|view)$/.test(path))return true;
  if(method==='GET'&&/^\/v1\/runs\/[a-f0-9-]+$/.test(path))return true;
  if(method==='GET'&&/^\/v1\/(?:challenges|shared-runs)\/[a-f0-9]{24}$/.test(path))return true;
  return method==='GET'&&['/v1/daily-status','/v1/capabilities','/v1/practice-sets','/v1/set-catalog'].includes(path);
}
function mobileAccountRoute(service,path,method) {
  if(service==='growth') {
    if(method==='POST'&&['/v1/mobile/account/signout','/v1/mobile/account/password-change','/v1/mobile/account/delete/verification/start','/v1/mobile/account/delete/apple/start','/v1/mobile/account/delete/apple/finish','/v1/mobile/account/delete'].includes(path))return true;
    if(method==='PATCH'&&path==='/v1/mobile/profile')return true;
    if(method==='GET'&&/^\/v1\/mobile\/profile\/[a-f0-9]{16}$/.test(path))return true;
    return method==='GET'&&['/v1/mobile/account/session','/v1/mobile/profile/me','/v1/mobile/profile/history'].includes(path);
  }
  if(service!=='draft')return false;
  if(method==='POST'&&path==='/v1/runs')return true;
  if(method==='POST'&&/^\/v1\/runs\/[a-f0-9-]+\/(pick|reroll|share|view)$/.test(path))return true;
  if(method==='GET'&&/^\/v1\/runs\/[a-f0-9-]+$/.test(path))return true;
  if(method==='GET'&&/^\/v1\/(?:challenges|shared-runs)\/[a-f0-9]{24}$/.test(path))return true;
  return method==='GET'&&['/v1/daily-status','/v1/capabilities','/v1/practice-sets','/v1/set-catalog'].includes(path);
}
function safeRedirect(value,{mobileOAuth=false}={}) {
  try {
    const url=new URL(value);
    if(url.origin==='https://packone.pro'&&url.protocol==='https:')return url.toString();
    if(mobileOAuth&&url.protocol==='packone:'&&url.hostname==='account'&&(url.pathname===''||url.pathname==='/'))return url.toString();
    return null;
  } catch{return null;}
}

export class NetworkQuota {
  constructor(state) {this.storage=state.storage;}
  async fetch(request) {
    const kind=new URL(request.url).pathname;
    if(request.method!=='POST'||!['/request','/session','/session-only'].includes(kind))return response(400,'Invalid quota request.');
    const now=Date.now();
    // /session-only follows a charged /request and an origin refresh that
    // proved the browser has no valid identity. Do not charge the request twice.
    // 100 shared-network players need roughly 2,000–2,500 requests for a
    // complete run. The short bucket bounds bursts; the minute bucket bounds
    // sustained load. Session creation remains independently limited.
    const limits=[...(kind!=='/session-only'?[['request',3600,60000],['request_burst',600,10000]]:[]),...(kind!=='/request'?[['session',120,600000]]:[])];
    const {retry,scopes}=await this.storage.transaction(async tx=>{
      const pending=[],scopes=[];let retry=0;
      for(const [key,limit,period] of limits) {
        let row=await tx.get(key);
        if(!row||now>=row.until)row={count:0,until:now+period};
        if(row.count>=limit){retry=Math.max(retry,Math.ceil((row.until-now)/1000));if(!scopes.includes(key==='request_burst'?'request':key))scopes.push(key==='request_burst'?'request':key);}
        pending.push([key,{...row,count:row.count+1}]);
      }
      if(retry)return {retry,scopes};
      for(const [key,row] of pending)await tx.put(key,row);
      await tx.setAlarm(now+660000);
      return {retry:0,scopes};
    });
    return retry?Response.json({error:'Too many requests.',code:'network_rate_limited',scopes},
      {status:429,headers:{'cache-control':'no-store','retry-after':String(retry)}}):new Response(null,{status:204});
  }
  async alarm() {await this.storage.deleteAll();}
}

export function routeFamily(path) {
  if(path==='/growth/v1/mobile/version')return 'mobile_version';
  if(/^\/draft\/v1\/runs\/[^/]+\/(pick|view|reroll|share)$/.test(path))return 'draft_'+path.split('/').at(-1);
  if(path==='/draft/v1/runs')return 'draft_start';
  if(/^\/draft\/v1\/runs\/[^/]+$/.test(path))return 'draft_read';
  if(/^\/draft\/v1\/(?:challenges|shared-runs)\/[^/]+$/.test(path))return 'draft_shared_read';
  for(const name of ['leaderboard','daily-status','capabilities','practice-sets','set-catalog'])if(path==='/draft/v1/'+name)return 'draft_'+name.replaceAll('-','_');
  if(/^\/growth\/v1\/(player\/)?session$/.test(path))return 'player_session';
  if(/^\/growth\/v1\/(mobile\/)?account(?:\/|$)/.test(path))return 'account';
  if(/^\/growth\/v1\/(mobile\/)?profile(?:\/|$)/.test(path))return 'profile';
  if(/\/health$/.test(path))return 'health';
  return 'other';
}
export async function gateway(request,env,fetcher=fetch) {
  const url=new URL(request.url),origin=request.headers.get('origin'),mode=env.MODE;
  const started=performance.now(),metric={event:'gateway_request',route:routeFamily(url.pathname),method:['GET','POST','PATCH','OPTIONS'].includes(request.method)?request.method:'other',
    release:/^[a-f0-9]{40}$/.test(env.RELEASE_COMMIT||'')?env.RELEASE_COMMIT:'unknown',quota_ms:0,upstream_ms:0,upstream_calls:0,upstream_status:null,quota_scope:null,error:null};
  const upstreamFetch=async(...args)=>{
    const began=performance.now();metric.upstream_calls++;
    try {const result=await fetcher(...args);metric.upstream_status=result.status;return result;}
    finally {metric.upstream_ms+=performance.now()-began;}
  };
  const quotaFetch=async(quota,kind)=>{
    const began=performance.now();
    try {
      const result=await quota.fetch(new Request('https://quota/'+kind,{method:'POST',signal:AbortSignal.timeout(5000)}));
      if(result.status===429) {
        const data=await result.clone().json();
        metric.quota_scope=(data.scopes||[]).filter(s=>s==='request'||s==='session').join(',')||'unknown';
      }
      return result;
    } finally {metric.quota_ms+=performance.now()-began;}
  };
  let previewNetwork=null;
  const expectedHost=mode==='production'?'api.packone.pro':'api-preview.packone.pro';
  const finish=result=>{
    const sampleRate=result.status>=400?1:.1;
    if(Math.random()<sampleRate)console.log(JSON.stringify({...metric,status:result.status,sample_rate:sampleRate,
      duration_ms:Math.round(performance.now()-started),quota_ms:Math.round(metric.quota_ms),upstream_ms:Math.round(metric.upstream_ms)}));
    const headers=new Headers(result.headers);
    headers.set('cache-control','no-store');headers.set('vary','Origin');
    if(ORIGINS.has(origin)) {
      headers.set('access-control-allow-origin',origin);
      headers.set('access-control-allow-credentials','true');
      headers.set('access-control-expose-headers','Retry-After');
    }
    if(mode==='preview'&&previewNetwork&&url.pathname==='/draft/health')headers.set('x-pack1-preview-network',previewNetwork);
    headers.set('x-content-type-options','nosniff');
    return new Response(result.body,{status:result.status,headers});
  };
  try {
    const preview=mode==='preview',production=mode==='production';
    const branch=String(env.NEON_BRANCH_ID||'');
    if(!secret(env.QUOTA_KEY)||(!preview&&!production)||
      (preview&&(!secret(env.ORIGIN_SECRET)||!secret(env.PREVIEW_KEY)||!/^br-[a-z0-9-]+$/.test(branch)||[PROD_BRANCH,DEV_BRANCH].includes(branch)))||
      (production&&branch!==PROD_BRANCH)||
      (env.ORIGIN_SECRET!==undefined&&env.ORIGIN_SECRET!==''&&!secret(env.ORIGIN_SECRET)))
      return finish(response(503,'Gateway not configured.'));
    if(url.protocol!=='https:'||url.hostname!==expectedHost)return finish(response(404,'Not found.'));
    const appleCallbackOrigin=request.method==='POST'&&url.pathname==='/growth/v1/account/apple/callback'&&origin==='https://appleid.apple.com';
    if(origin&&!ORIGINS.has(origin)&&!appleCallbackOrigin)return finish(response(403,'Origin not allowed.'));
    const match=url.pathname.match(/^\/(legacy|growth|draft)(\/.*)$/);
    const method=request.method==='OPTIONS'?request.headers.get('access-control-request-method'):request.method;
    if(!match||!permitted(match[1],match[2],method,url.search,mode))return finish(response(404,'Not found.'));
    if(request.method==='OPTIONS') {
      const requested=(request.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
      const allowed=['authorization','content-type','x-pack1-auth-session','x-pack1-player-session','x-pack1-csrf','x-pack1-mobile-session','x-pack1-mobile-account','x-idempotency-key','x-pack1-preview-key'];
      if(!origin||requested.some(x=>!allowed.includes(x)))return finish(response(403,'Preflight not allowed.'));
      return finish(new Response(null,{status:204,headers:{
        'access-control-allow-methods':'GET,POST,PATCH,OPTIONS',
        'access-control-allow-headers':allowed.join(','),
        'access-control-max-age':'300',
      }}));
    }
    if(preview&&request.headers.get('x-pack1-preview-key')!==env.PREVIEW_KEY)return finish(response(403,'Preview access required.'));
    const mobileSession=request.headers.get('x-pack1-mobile-session');
    if(mobileSession&&(!validMobileSession(mobileSession)||!mobileSessionRoute(match[1],match[2],method)))
      return finish(response(validMobileSession(mobileSession)?403:401,validMobileSession(mobileSession)?'Mobile session not allowed on this route.':'Invalid mobile session.'));
    const mobileAccount=request.headers.get('x-pack1-mobile-account');
    if(mobileAccount&&(!validMobileAccount(mobileAccount)||!mobileAccountRoute(match[1],match[2],method)))
      return finish(response(validMobileAccount(mobileAccount)?403:401,validMobileAccount(mobileAccount)?'Mobile account session not allowed on this route.':'Invalid mobile account session.'));
    const idempotencyKey=request.headers.get('x-idempotency-key');
    const idempotencyRoute=match[1]==='draft'&&match[2]==='/v1/runs'&&method==='POST';
    if(idempotencyKey&&(!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)||!idempotencyRoute))
      return finish(response(idempotencyRoute?400:403,idempotencyRoute?'Invalid idempotency key.':'Idempotency key not allowed on this route.'));

    const cookies=selectedCookies(request);
    const playerToken=cookieValue(cookies,'__Host-pack1_player');
    const sessionCreation=request.method==='POST'&&(
      (match[1]==='legacy'&&match[2]==='/v1/session')||
      (match[1]==='growth'&&match[2]==='/v1/session')||
      (match[1]==='growth'&&match[2]==='/v1/player/session'&&!playerToken)
    );
    const network=ipNetwork(request.headers.get('cf-connecting-ip')||'');
    const key=await crypto.subtle.importKey('raw',encode.encode(env.QUOTA_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const digest=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encode.encode(network)))).map(x=>x.toString(16).padStart(2,'0')).join('');
    if(preview)previewNetwork=digest;
    const quota=env.NETWORK_QUOTA.get(env.NETWORK_QUOTA.idFromName(digest));
    const limited=await quotaFetch(quota,sessionCreation?'session':'request');
    if(limited.status!==204)return finish(limited.status===429?limited:response(503,'Gateway unavailable.'));

    const headers=new Headers({'accept':'application/json'});
    // The persisted network dimension is already HMAC-SHA-256 under the
    // gateway-only QUOTA_KEY. Authenticate that digest for the worker as well:
    // direct-origin callers can invent a digest header but cannot forge this
    // proof without the server-only credential key.
    const credentialProofSecret=String(env.CREDENTIAL_PROOF_KEY||'');
    if(credentialProofSecret.length>=32) {
      const proofKey=await crypto.subtle.importKey('raw',encode.encode(credentialProofSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
      const proof=Array.from(new Uint8Array(await crypto.subtle.sign(
        'HMAC',proofKey,encode.encode('pack1-credential-network:'+digest),
      ))).map(x=>x.toString(16).padStart(2,'0')).join('');
      headers.set('x-pack1-network-id',digest);
      headers.set('x-pack1-network-proof',proof);
    }
    if(env.ORIGIN_SECRET)headers.set('x-pack1-ingress-secret',env.ORIGIN_SECRET);
    if(origin)headers.set('origin',origin);
    if(cookies)headers.set('cookie',cookies);
    if(playerToken)headers.set('authorization','Bearer '+playerToken);
    else if(mobileSession)headers.set('authorization','Bearer '+mobileSession);
    else if(preview&&request.headers.has('authorization'))headers.set('authorization',request.headers.get('authorization'));
    if(mobileAccount)headers.set('x-pack1-mobile-account',mobileAccount);
    if(idempotencyKey)headers.set('x-idempotency-key',idempotencyKey);
    if(request.headers.has('x-pack1-csrf'))headers.set('x-pack1-csrf',request.headers.get('x-pack1-csrf'));
    if(match[1]==='growth'&&match[2]==='/v1/account/migrate'&&request.headers.has('x-pack1-auth-session'))
      headers.set('x-pack1-auth-session',request.headers.get('x-pack1-auth-session'));
    if(match[1]==='growth'&&match[2]==='/v1/player/migrate'&&request.headers.has('x-pack1-player-session'))
      headers.set('x-pack1-player-session',request.headers.get('x-pack1-player-session'));

    let body;
    const appleCallback=method==='POST'&&match[1]==='growth'&&match[2]==='/v1/account/apple/callback';
    if(appleCallback) {
      const contentType=String(request.headers.get('content-type')||'').toLowerCase();
      if(!contentType.includes('application/x-www-form-urlencoded'))
        throw Object.assign(Error('Apple callback is invalid.'),{status:415});
      body=await request.text();
      if(body.length>20000)throw Object.assign(Error('Apple callback is invalid.'),{status:413});
      headers.set('content-type','application/x-www-form-urlencoded');
    } else if(['POST','PATCH'].includes(method)) {
      body=JSON.stringify(await readJson(request));
      headers.set('content-type','application/json');
    }
    const upstreamOrigin=`https://${branch}-${SERVICES[match[1]]}.compute.c-5.us-east-2.aws.neon.tech`;
    const refresh=method==='POST'&&match[1]==='growth'&&match[2]==='/v1/player/session'&&Boolean(playerToken);
    // A cookie is untrusted until the origin verifies it. This endpoint only
    // returns an existing identity and never creates one. Valid refreshes retain
    // their single upstream request and do not consume the creation budget.
    const upstream=upstreamOrigin+(refresh?'/internal/player-session-refresh':match[2])+url.search;
    const signal=AbortSignal.timeout(120000);
    let result=await upstreamFetch(upstream,{method,headers,body,redirect:'manual',signal});
    if(refresh&&result.status===401&&result.headers.get('x-pack1-session-state')==='missing') {
      await result.body?.cancel();
      const creationLimit=await quotaFetch(quota,'session-only');
      if(creationLimit.status!==204)return finish(creationLimit.status===429?creationLimit:response(503,'Gateway unavailable.'));
      // One creation attempt, after the missing-session proof and quota charge.
      // A timeout or any other upstream error never authorizes a retry/create.
      headers.delete('authorization');
      result=await upstreamFetch(upstreamOrigin+match[2]+url.search,{method,headers,body,redirect:'manual',signal});
    }

    const publicHeaders=new Headers();
    for(const name of ['content-type','retry-after'])if(result.headers.has(name))publicHeaders.set(name,result.headers.get(name));
    if(match[1]==='growth')for(const line of upstreamSetCookies(result.headers))if(publicCookie(line))publicHeaders.append('set-cookie',scopedCookie(line));
    if(result.status>=300&&result.status<400) {
      const target=safeRedirect(result.headers.get('location'),{
        mobileOAuth:match[1]==='growth'&&['/v1/mobile/account/google/callback','/v1/account/apple/callback'].includes(match[2]),
      });
      if(!target)return finish(response(502,'Unexpected upstream redirect.'));
      publicHeaders.set('location',target);
      return finish(new Response(null,{status:result.status,headers:publicHeaders}));
    }
    return finish(new Response(result.body,{status:result.status,headers:publicHeaders}));
  } catch(error) {
    metric.error=error?.name==='TimeoutError'?'timeout':[400,413,415].includes(error?.status)?'invalid_body':'gateway_failure';
    return finish(response([400,413,415].includes(error?.status)?error.status:503,
      [400,413,415].includes(error?.status)?error.message:'Gateway unavailable.'));
  }
}
export default {fetch(request,env){return gateway(request,env);}};
