import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const store=new Map();
globalThis.localStorage={
  getItem:key=>store.has(key)?store.get(key):null,
  setItem:(key,value)=>store.set(key,String(value)),
  removeItem:key=>store.delete(key),
};
globalThis.document={cookie:''};
globalThis.window={PACK1_API:{firstParty:true,growthUrl:'https://api.packone.pro/growth',draftRunUrl:'https://api.packone.pro/draft'}};
globalThis.dispatchEvent=()=>true;

const calls=[];
const eventStatuses=[];
globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname;
  calls.push(path);
  if(path==='/growth/v1/player/session')return Response.json({ok:true,playerId:'player'});
  if(path==='/growth/v1/events') {
    const status=eventStatuses.shift()??200;
    return status===200?Response.json({ok:true,stored:JSON.parse(options.body).events.length}):Response.json({error:'Player session required.'},{status});
  }
  throw Error('Unexpected '+path);
};
const api=await import('../growth-api.mjs');
const count=path=>calls.filter(call=>call===path).length;

test('an events 401 re-establishes the player session and resends the same batch once per page',async()=>{
  eventStatuses.push(401,200);
  const result=await api.sendEvents([{name:'page_view',props:{}}]);
  assert.deepEqual(result,{ok:true,stored:1});
  assert.equal(count('/growth/v1/events'),2,'the same batch is resent after recovery');
  assert.equal(count('/growth/v1/player/session'),2,'the cached session is replaced exactly once');

  eventStatuses.push(401);
  assert.equal(await api.sendEvents([{name:'page_view',props:{}}]),null);
  assert.equal(count('/growth/v1/events'),3,'a later 401 on the same page is not retried');
  assert.equal(count('/growth/v1/player/session'),2,'no further player sessions are created on this page');
});

test('player-session rejections carry a log-only reason and are logged as one structured line',async()=>{
  const source=fs.readFileSync(new URL('../worker/growth-function.js',import.meta.url),'utf8');
  assert.match(source,/let reason = !bearer \? 'missing' : id \? null : 'invalid';/);
  assert.match(source,/if\(id&&await deletedPlayerTombstone\(query,id\)\)\{id=null;reason='retired';\}/);
  assert.match(source,/new Error\('Player session required\.'\), \{ status: 401, playerSessionReason: reason \}/);
  assert.match(source,/if\(error\?\.status===401&&error\?\.playerSessionReason\)console\.log\(JSON\.stringify\(playerSessionRejection\(request,error\.playerSessionReason\)\)\);\n      else console\.error\(error\);/);

  const {playerSessionRejection}=await import('../worker/growth-function.js');
  const browser=playerSessionRejection(new Request('https://growth.example/v1/events',{method:'POST',headers:{origin:'https://packone.pro'}}),'missing');
  assert.equal(browser.event,'player_session_rejected');
  assert.equal(browser.reason,'missing');
  assert.equal(browser.path,'/v1/events');
  assert.equal(browser.client,'browser');
  const native=playerSessionRejection(new Request('https://growth.example/v1/profile/0123456789abcdef/history',{headers:{'x-pack1-mobile-account':'secret-token'}}),'retired');
  assert.equal(native.client,'native_account');
  assert.equal(native.path,'/v1/profile/:id/history');
  assert.doesNotMatch(JSON.stringify(native),/secret-token|0123456789abcdef/);
  assert.equal(playerSessionRejection(new Request('https://growth.example/v1/patreon/status'),'invalid').client,'no_origin');
});
