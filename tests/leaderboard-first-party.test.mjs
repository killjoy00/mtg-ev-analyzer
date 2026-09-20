import test from 'node:test';
import assert from 'node:assert/strict';

const store=new Map([['pack1-player-name-v1','QA Player']]);
globalThis.localStorage={
  getItem:key=>store.has(key)?store.get(key):null,
  setItem:(key,value)=>store.set(key,String(value)),
  removeItem:key=>store.delete(key),
};
globalThis.document={cookie:''};
globalThis.window={
  PACK1_API:{
    firstParty:true,
    url:'https://api.packone.pro/legacy',
    growthUrl:'https://api.packone.pro/growth',
    draftRunUrl:'https://api.packone.pro/draft',
  },
  localStorage:globalThis.localStorage,
  PACK1_CAPTURED_PICKS:['card-a','card-b'],
};
globalThis.dispatchEvent=()=>{};
const calls=[];
globalThis.fetch=async(url,options={})=>{
  const u=new URL(url),path=u.pathname,headers=new Headers(options.headers||{});
  calls.push({host:u.host,path,method:options.method||'GET',headers,credentials:options.credentials});
  if(path==='/growth/v1/player/session')return Response.json({ok:true,playerId:'player'});
  if(path.startsWith('/legacy/'))return Response.json({ok:true});
  throw Error('Unexpected '+path);
};
const board=await import('../leaderboard.mjs');

const legacySessionCalls=()=>calls.filter(row=>row.path==='/legacy/v1/session').length;

test('the legacy leaderboard service is reached through the first-party gateway',()=>{
  assert.equal(board.isLeaderboardConfigured(),true);
});

test('authenticated legacy writes reuse the shared player cookie instead of minting a token',async()=>{
  // Regression: this surface kept its own pack1-api-session-v1 bearer. After
  // the first-party cutover deleted that key it minted a brand new guest,
  // which the next page load then migrated over the account's real player.
  await board.updateLeaderboardDisplayName('QA Player');
  const patch=calls.findLast(row=>row.path==='/legacy/v1/player');
  assert.equal(patch.host,'api.packone.pro');
  assert.equal(patch.method,'PATCH');
  assert.equal(patch.credentials,'include');
  assert.equal(patch.headers.has('authorization'),false,'never carries its own bearer token');
  assert.ok(calls.some(row=>row.path==='/growth/v1/player/session'),'establishes the shared first-party player');
  assert.equal(legacySessionCalls(),0,'never creates a second legacy guest player');
  assert.equal(localStorage.getItem('pack1-api-session-v1'),null,'no bearer is persisted');
});

test('score submission and public reads stay on the cookie identity',async()=>{
  await board.submitLeaderboardScore({setId:'msh',mode:'full',score:80,grade:'B',challengeDate:'2026-09-20'});
  await board.loadLeaderboard({period:'daily'});
  for(const path of ['/legacy/v1/scores','/legacy/v1/leaderboard']) {
    const call=calls.findLast(row=>row.path===path);
    assert.ok(call,'missing '+path);
    assert.equal(call.credentials,'include');
    assert.equal(call.headers.has('authorization'),false);
  }
  assert.equal(legacySessionCalls(),0);
  assert.equal(localStorage.getItem('pack1-api-session-v1'),null);
});
