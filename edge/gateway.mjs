import {isIP} from 'node:net';
import {readJson} from '../worker/request-json.mjs';

const SERVICES={legacy:'pack1api',growth:'pack1growth',draft:'draftrunapi'};
const PROD_BRANCH='br-orange-feather-ayps8kep';
const DEV_BRANCH='br-twilight-hill-ayffyd2b';
const ORIGINS=new Set(['https://packone.pro']);
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
  return false;
}

function permitted(service,path,method,search,mode) {
  if(method==='GET'&&path==='/health')return search==='?quick=1';
  if(service==='growth') {
    if(method==='POST'&&[
      '/v1/session','/v1/player/session','/v1/player/migrate',
      '/v1/account/signup','/v1/account/signin','/v1/account/migrate',
      '/v1/account/link','/v1/account/link-browser','/v1/account/signout',
      '/v1/events','/v1/results','/v1/profile-lookup','/v1/patreon/connect','/v1/patreon/disconnect',
    ].includes(path))return true;
    if(method==='GET'&&[
      '/v1/account/session','/v1/account/daily-dates','/v1/account/google/callback',
      '/v1/stats','/v1/profile/me','/v1/profile/history','/v1/patreon/status',
    ].includes(path))return true;
    if(method==='GET'&&/^\/v1\/profile\/[a-f0-9]{16}(?:\/history)?$/.test(path))return true;
    return method==='PATCH'&&path==='/v1/profile';
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
function safeRedirect(value) {
  try {const url=new URL(value);return url.origin==='https://packone.pro'&&url.protocol==='https:'?url.toString():null;} catch{return null;}
}

export class NetworkQuota {
  constructor(state) {this.storage=state.storage;}
  async fetch(request) {
    const kind=new URL(request.url).pathname;
    if(request.method!=='POST'||!['/request','/session'].includes(kind))return response(400,'Invalid quota request.');
    const now=Date.now();
    const limits=[['request',120,60000],...(kind==='/session'?[['session',10,600000]]:[])];
    const retry=await this.storage.transaction(async tx=>{
      const pending=[];let retry=0;
      for(const [key,limit,period] of limits) {
        let row=await tx.get(key);
        if(!row||now>=row.until)row={count:0,until:now+period};
        if(row.count>=limit)retry=Math.max(retry,Math.ceil((row.until-now)/1000));
        pending.push([key,{...row,count:row.count+1}]);
      }
      if(retry)return retry;
      for(const [key,row] of pending)await tx.put(key,row);
      await tx.setAlarm(now+660000);
      return 0;
    });
    return retry?response(429,'Too many requests.',{'retry-after':String(retry)}):new Response(null,{status:204});
  }
  async alarm() {await this.storage.deleteAll();}
}

export async function gateway(request,env,fetcher=fetch) {
  const url=new URL(request.url),origin=request.headers.get('origin'),mode=env.MODE;
  const expectedHost=mode==='production'?'api.packone.pro':'api-preview.packone.pro';
  const finish=result=>{
    const headers=new Headers(result.headers);
    headers.set('cache-control','no-store');headers.set('vary','Origin');
    if(ORIGINS.has(origin)) {
      headers.set('access-control-allow-origin',origin);
      headers.set('access-control-allow-credentials','true');
    }
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
    if(origin&&!ORIGINS.has(origin))return finish(response(403,'Origin not allowed.'));
    const match=url.pathname.match(/^\/(legacy|growth|draft)(\/.*)$/);
    const method=request.method==='OPTIONS'?request.headers.get('access-control-request-method'):request.method;
    if(!match||!permitted(match[1],match[2],method,url.search,mode))return finish(response(404,'Not found.'));
    if(request.method==='OPTIONS') {
      const requested=(request.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
      const allowed=['authorization','content-type','x-pack1-auth-session','x-pack1-player-session','x-pack1-csrf','x-pack1-preview-key'];
      if(!origin||requested.some(x=>!allowed.includes(x)))return finish(response(403,'Preflight not allowed.'));
      return finish(new Response(null,{status:204,headers:{
        'access-control-allow-methods':'GET,POST,PATCH,OPTIONS',
        'access-control-allow-headers':allowed.join(','),
        'access-control-max-age':'300',
      }}));
    }
    if(preview&&request.headers.get('x-pack1-preview-key')!==env.PREVIEW_KEY)return finish(response(403,'Preview access required.'));

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
    const quota=env.NETWORK_QUOTA.get(env.NETWORK_QUOTA.idFromName(digest));
    const limited=await quota.fetch(new Request(`https://quota/${sessionCreation?'session':'request'}`,{method:'POST'}));
    if(limited.status!==204)return finish(limited.status===429?limited:response(503,'Gateway unavailable.'));

    const headers=new Headers({'accept':'application/json'});
    if(env.ORIGIN_SECRET)headers.set('x-pack1-ingress-secret',env.ORIGIN_SECRET);
    if(origin)headers.set('origin',origin);
    if(cookies)headers.set('cookie',cookies);
    if(playerToken)headers.set('authorization','Bearer '+playerToken);
    else if(preview&&request.headers.has('authorization'))headers.set('authorization',request.headers.get('authorization'));
    if(request.headers.has('x-pack1-csrf'))headers.set('x-pack1-csrf',request.headers.get('x-pack1-csrf'));
    if(match[1]==='growth'&&match[2]==='/v1/account/migrate'&&request.headers.has('x-pack1-auth-session'))
      headers.set('x-pack1-auth-session',request.headers.get('x-pack1-auth-session'));
    if(match[1]==='growth'&&match[2]==='/v1/player/migrate'&&request.headers.has('x-pack1-player-session'))
      headers.set('x-pack1-player-session',request.headers.get('x-pack1-player-session'));

    let body;
    if(['POST','PATCH'].includes(method)) {body=JSON.stringify(await readJson(request));headers.set('content-type','application/json');}
    const upstream=`https://${branch}-${SERVICES[match[1]]}.compute.c-5.us-east-2.aws.neon.tech${match[2]}${url.search}`;
    const result=await fetcher(upstream,{method,headers,body,redirect:'manual',signal:AbortSignal.timeout(120000)});

    const publicHeaders=new Headers();
    for(const name of ['content-type','retry-after'])if(result.headers.has(name))publicHeaders.set(name,result.headers.get(name));
    if(match[1]==='growth')for(const line of upstreamSetCookies(result.headers))if(publicCookie(line))publicHeaders.append('set-cookie',line);
    if(result.status>=300&&result.status<400) {
      const target=safeRedirect(result.headers.get('location'));
      if(!target)return finish(response(502,'Unexpected upstream redirect.'));
      publicHeaders.set('location',target);
      return finish(new Response(null,{status:result.status,headers:publicHeaders}));
    }
    return finish(new Response(result.body,{status:result.status,headers:publicHeaders}));
  } catch(error) {
    return finish(response([400,413,415].includes(error?.status)?error.status:503,
      [400,413,415].includes(error?.status)?error.message:'Gateway unavailable.'));
  }
}
export default {fetch(request,env){return gateway(request,env);}};
