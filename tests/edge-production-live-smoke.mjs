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
for(const service of ['legacy','growth','draft']) {
  const {data}=await call('/'+service+'/health?quick=1');
  assert.equal(data.release_commit,commit,service+' exact release');
}
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
const google=await call('/growth/v1/account/google/start',{
  method:'POST',headers:{origin,'content-type':'application/json',cookie:playerCookie},body:'{}',
});
const target=new URL(google.data.url);
assert.equal(target.protocol,'https:');
assert.equal(target.hostname,'accounts.google.com');
const rejected=await fetch(base+'/growth/v1/player/session',{
  method:'POST',headers:{origin:'https://example.invalid','content-type':'application/json'},body:'{}',redirect:'manual',
});
assert.equal(rejected.status,403);
console.log('Production first-party gateway, player cookie, credentialed CORS and Google OAuth start passed.');
