import assert from 'node:assert/strict';
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
const origin='https://packone.pro';
const created=await call('/growth/v1/player/session',{
  method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({displayName:'QA secure auth release'}),expected:201,
});
assert.ok(created.data.playerId);
assert.equal(created.data.token,undefined,'browser session never returns player bearer');
const set=created.response.headers.getSetCookie?.()||[created.response.headers.get('set-cookie')].filter(Boolean);
const playerLine=set.find(row=>row.startsWith('__Host-pack1_player='));
assert.ok(playerLine,'gateway relays the HttpOnly player cookie');
const playerCookie=playerLine.split(';')[0];
const daily=await call('/draft/v1/daily-status',{headers:{origin,cookie:playerCookie}});
assert.deepEqual(daily.data.membership,{connected:false});
assert.equal(daily.response.headers.get('access-control-allow-origin'),origin);
assert.equal(daily.response.headers.get('access-control-allow-credentials'),'true');
const neonAuth='https://ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth';
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
});
assert.equal(rejected.status,403);
console.log('Production first-party gateway, player cookie, credentialed CORS and browser-origin Google OAuth start passed.');
