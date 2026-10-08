import assert from 'node:assert/strict';
import {PROD_AUTH_BASE} from '../worker/account-config.mjs';
import {ADMIN_API_VERSION} from '../admin-api-contract.mjs';
const commit=process.argv[2];
assert.match(commit||'',/^[a-f0-9]{40}$/);
const base='https://api.packone.pro';
async function call(path,options={}) {
  const response=await fetch(base+path,{redirect:'manual',signal:AbortSignal.timeout(30000),...options});
  const data=await response.json().catch(()=>({}));
  assert.equal(response.status,options.expected||200,path+': '+response.status+' '+JSON.stringify(data));
  assert.equal(response.headers.get('cache-control'),'no-store');
  return {response,data};
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function exactRelease(service) {
  let last=null,error=null;
  for(let attempt=0;attempt<15;attempt++) {
    try {
      const {data}=await call('/'+service+'/health?quick=1');
      last=data.release_commit||null;error=null;
      if(last===commit)return;
    } catch(cause) {error=cause;}
    if(attempt<14)await sleep(2000);
  }
  if(error)throw error;
  assert.equal(last,commit,service+' exact release');
}
for(const service of ['legacy','growth','draft'])await exactRelease(service);
// A deployment is not Admin-ready until all three independently released
// surfaces agree: the published Pages frontend, the gateway and Draft backend.
const origin='https://packone.pro';
const {response:adminResponse,data:adminHealth}=await call('/draft/health?quick=1',{
  headers:{origin},cache:'no-store',
});
assert.equal(adminHealth.admin_api_version,ADMIN_API_VERSION,'Draft Admin API version matches reviewed release');
assert.equal(adminResponse.headers.get('x-pack1-admin-api-version'),String(ADMIN_API_VERSION),
  'Production gateway Admin API version matches reviewed release');
const publishedContract=await fetch(origin+'/admin-api-contract.mjs',{
  cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(30000),
});
assert.equal(publishedContract.status,200,'Published Pages Admin API contract must be accessible');
const publishedCode=await publishedContract.text();
const publishedVersion=publishedCode.match(/^export const ADMIN_API_VERSION=([0-9]+);\s*$/m)?.[1];
assert.equal(publishedVersion,String(ADMIN_API_VERSION),'Published Pages Admin version matches gateway and backend');

const mobileLeaderboardToken='p1_00000000-0000-4000-8000-000000000000.'+'A'.repeat(43);
await call('/draft/v1/leaderboard?period=daily&environment=mixed',{
  headers:{'x-pack1-mobile-session':mobileLeaderboardToken},
});
const created=await call('/growth/v1/player/session',{
  method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({displayName:'QA secure auth release'}),expected:201,
});
assert.ok(created.data.playerId);
assert.equal(created.data.token,undefined,'browser session never returns player bearer');
const set=created.response.headers.getSetCookie?.()||[created.response.headers.get('set-cookie')].filter(Boolean);
const playerLine=set.find(row=>row.startsWith('__Host-pack1_player='));
assert.ok(playerLine,'gateway relays the HttpOnly player cookie');
const playerCookie=playerLine.split(';')[0];
const refreshed=await call('/growth/v1/player/session',{
  method:'POST',headers:{origin,'content-type':'application/json',cookie:playerCookie},body:'{}',
});
assert.equal(refreshed.data.playerId,created.data.playerId,'refresh preserves the same player');
assert.equal(refreshed.response.headers.get('set-cookie'),null,'refresh creates no replacement identity');
const daily=await call('/draft/v1/daily-status',{headers:{origin,cookie:playerCookie}});
assert.deepEqual(daily.data.membership,{connected:false});
assert.equal(daily.response.headers.get('access-control-allow-origin'),origin);
assert.equal(daily.response.headers.get('access-control-allow-credentials'),'true');
const neonAuth=PROD_AUTH_BASE;
const googleResponse=await fetch(neonAuth+'/sign-in/social',{
  method:'POST',
  headers:{origin,'content-type':'application/json'},
  body:JSON.stringify({
    provider:'google',
    callbackURL:'https://packone.pro/?auth=google',
    newUserCallbackURL:'https://packone.pro/?auth=google',
    errorCallbackURL:'https://packone.pro/?auth=google-error',
    disableRedirect:true,
  }),
  redirect:'manual',
  signal:AbortSignal.timeout(30000),
});
const google=await googleResponse.json().catch(()=>({}));
assert.equal(googleResponse.status,200,'Neon Auth Google start: '+googleResponse.status+' '+JSON.stringify(google));
assert.equal(googleResponse.headers.get('access-control-allow-origin'),origin);
const target=new URL(google.url);
assert.equal(target.protocol,'https:');
const rejected=await fetch(base+'/growth/v1/player/session',{
  method:'POST',headers:{origin:'https://example.invalid','content-type':'application/json'},body:'{}',redirect:'manual',
  signal:AbortSignal.timeout(30000),
});
assert.equal(rejected.status,403);
console.log('Production Admin v'+ADMIN_API_VERSION+' Pages/gateway/backend contract, first-party gateway, mobile leaderboard, player cookie, credentialed CORS and browser-origin Google OAuth start passed.');
