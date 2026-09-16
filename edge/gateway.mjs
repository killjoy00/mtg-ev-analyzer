import {isIP} from 'node:net';
import {readJson} from '../worker/request-json.mjs';

const SERVICES={legacy:'pack1api',growth:'pack1growth',draft:'draftrunapi'};
const ORIGINS=new Set(['https://packone.pro','https://www.packone.pro']);
const response=(status,error,headers={})=>Response.json({error},{status,headers:{'cache-control':'no-store',...headers}});
const secret=value=>/^[a-f0-9]{64}$/.test(value||'');
const encode=new TextEncoder();

// Aggregate IPv6 privacy addresses by /64. No raw address is sent upstream or
// written to durable storage; the namespace receives a keyed digest only.
export function ipNetwork(value) {
  if(isIP(value)===4)return value;
  if(isIP(value)!==6)throw Error('Missing network identity');
  const normalized=new URL(`http://[${value}]/`).hostname.slice(1,-1);
  const [left,right]=normalized.split('::');
  const a=left?left.split(':'):[],b=right?right.split(':'):[];
  const parts=right===undefined?a:[...a,...Array(8-a.length-b.length).fill('0'),...b];
  return parts.slice(0,4).map(x=>parseInt(x,16).toString(16)).join(':')+'::/64';
}

function permitted(service,path,method,search) {
  if(method==='GET'&&path==='/health')return search==='?quick=1';
  if(method==='POST'&&path==='/v1/session')return true;
  if(service==='draft')return (method==='POST'&&path==='/v1/runs')||
    (method==='GET'&&path==='/v1/leaderboard')||
    (method==='GET'&&/^\/v1\/(runs\/[a-f0-9-]+|challenges\/[a-f0-9]+)$/.test(path))||
    (method==='POST'&&/^\/v1\/runs\/[a-f0-9-]+\/(pick|reroll|share|view)$/.test(path));
  if(service==='legacy')return (method==='PATCH'&&path==='/v1/player')||
    (method==='POST'&&['/v1/scores','/v1/challenges'].includes(path))||
    (method==='GET'&&(['/v1/leaderboard','/v1/distribution'].includes(path)||/^\/v1\/challenges\/[a-f0-9]{12}$/.test(path)));
  return (method==='POST'&&['/v1/events','/v1/results','/v1/account/link','/v1/account/signout','/v1/profile-lookup'].includes(path))||
    (method==='PATCH'&&path==='/v1/profile')||
    (method==='GET'&&(['/v1/stats','/v1/account/session','/v1/account/daily-dates','/v1/profile/me','/v1/profile/history'].includes(path)||/^\/v1\/profile\/[a-f0-9]{16}(\/history)?$/.test(path)));
}

// One globally addressed object per keyed network digest. Transactions cover
// all counters, so simultaneous arrivals cannot overspend a creation budget.
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
  const url=new URL(request.url),origin=request.headers.get('origin');
  const finish=result=>{
    const headers=new Headers(result.headers);
    headers.set('cache-control','no-store');headers.set('vary','Origin');
    if(ORIGINS.has(origin))headers.set('access-control-allow-origin',origin);
    headers.set('x-content-type-options','nosniff');
    return new Response(result.body,{status:result.status,headers});
  };
  try {
    if(env.MODE!=='preview'||!secret(env.ORIGIN_SECRET)||!secret(env.PREVIEW_KEY)||!secret(env.QUOTA_KEY)||!/^br-[a-z0-9-]+$/.test(env.NEON_BRANCH_ID||'')||
      ['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b'].includes(env.NEON_BRANCH_ID))return finish(response(503,'Gateway not configured.'));
    if(url.protocol!=='https:'||url.hostname!=='api-preview.packone.pro')return finish(response(404,'Not found.'));
    if(origin&&!ORIGINS.has(origin))return finish(response(403,'Origin not allowed.'));
    const match=url.pathname.match(/^\/(legacy|growth|draft)(\/.*)$/);
    const method=request.method==='OPTIONS'?request.headers.get('access-control-request-method'):request.method;
    if(!match||!permitted(match[1],match[2],method,url.search))return finish(response(404,'Not found.'));
    if(request.method==='OPTIONS') {
      const headers=(request.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
      if(!origin||headers.some(x=>!['authorization','content-type','x-pack1-auth-session','x-pack1-preview-key'].includes(x)))return finish(response(403,'Preflight not allowed.'));
      return finish(new Response(null,{status:204,headers:{'access-control-allow-methods':'GET,POST,PATCH,OPTIONS','access-control-allow-headers':'authorization,content-type,x-pack1-auth-session,x-pack1-preview-key','access-control-max-age':'300'}}));
    }
    // Preview never becomes a public route into a copy of production data.
    if(request.headers.get('x-pack1-preview-key')!==env.PREVIEW_KEY)return finish(response(403,'Preview access required.'));
    const network=ipNetwork(request.headers.get('cf-connecting-ip')||'');
    const key=await crypto.subtle.importKey('raw',encode.encode(env.QUOTA_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const digest=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encode.encode(network)))).map(x=>x.toString(16).padStart(2,'0')).join('');
    const quota=env.NETWORK_QUOTA.get(env.NETWORK_QUOTA.idFromName(digest));
    const limited=await quota.fetch(new Request(`https://quota/${match[2]==='/v1/session'?'session':'request'}`,{method:'POST'}));
    if(limited.status!==204)return finish(limited.status===429?limited:response(503,'Gateway unavailable.'));
    const headers=new Headers({'accept':'application/json','x-pack1-ingress-secret':env.ORIGIN_SECRET});
    for(const name of ['authorization','x-pack1-auth-session','origin'])if(request.headers.has(name))headers.set(name,request.headers.get(name));
    let body;
    if(['POST','PATCH'].includes(method)) {body=JSON.stringify(await readJson(request));headers.set('content-type','application/json');}
    const upstream=`https://${env.NEON_BRANCH_ID}-${SERVICES[match[1]]}.compute.c-5.us-east-2.aws.neon.tech${match[2]}${url.search}`;
    const result=await fetcher(upstream,{method,headers,body,redirect:'manual',signal:AbortSignal.timeout(120000)});
    if(result.status>=300&&result.status<400)return finish(response(502,'Unexpected upstream redirect.'));
    // Only public protocol headers leave the gateway. In particular, do not
    // relay upstream cookies, infrastructure headers or a redirected secret.
    const publicHeaders=new Headers();
    for(const name of ['content-type','retry-after'])if(result.headers.has(name))publicHeaders.set(name,result.headers.get(name));
    return finish(new Response(result.body,{status:result.status,headers:publicHeaders}));
  } catch(error) {
    return finish(response([400,413,415].includes(error?.status)?error.status:503,
      [400,413,415].includes(error?.status)?error.message:'Gateway unavailable.'));
  }
}
export default {fetch(request,env) {return gateway(request,env);}};
