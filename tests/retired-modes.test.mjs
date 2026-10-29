import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import legacy from '../worker/index.js';
import growth from '../worker/growth-function.js';
import {gateway} from '../edge/gateway.mjs';
import {installHistoricalShare} from '../historical-share.mjs';

const routes=[['POST','/v1/scores'],['GET','/v1/leaderboard'],['GET','/v1/distribution'],
  ['POST','/v1/challenges'],['GET','/v1/challenges/abcdef012345']];
const environment={MODE:'production',NEON_BRANCH_ID:'br-orange-feather-ayps8kep',QUOTA_KEY:'1'.repeat(64),
  NETWORK_QUOTA:{idFromName:name=>name,get:()=>({fetch:async()=>new Response(null,{status:204})})}};

test('retired origin routes return Gone without reading or writing the database',async()=>{
  const saved=globalThis.fetch;globalThis.fetch=()=>{throw Error('Unexpected origin I/O');};
  try {
    for(const [method,path] of routes) {
      const r=await legacy.fetch(new Request('https://packone.pro'+path,{method}));
      assert.equal(r.status,410,path);assert.equal((await r.json()).code,'mode_retired');
    }
    const health=await (await legacy.fetch(new Request('https://packone.pro/health'))).json();
    assert.equal(health.scoring,null);assert.deepEqual(health.retiredModes,['full','top3']);
  } finally {globalThis.fetch=saved;}
});

test('edge tombstones only legacy games while current shares and identity routes still forward',async()=>{
  let upstream=0;
  const call=(service,path,method)=>gateway(new Request('https://api.packone.pro/'+service+path,
    {method,headers:{origin:'https://packone.pro','cf-connecting-ip':'192.0.2.9','content-type':'application/json'},
      ...(['POST','PATCH'].includes(method)?{body:'{}'}:{})}),environment,async()=>{upstream++;return Response.json({ok:true});});
  for(const [method,path] of routes)assert.equal((await call('legacy',path,method)).status,410,path);
  assert.equal(upstream,0);
  for(const [service,path,method] of [['draft','/v1/leaderboard','GET'],
    ['draft','/v1/challenges/'+'a'.repeat(24),'GET'],['legacy','/v1/session','POST'],
    ['legacy','/v1/player','PATCH'],['growth','/v1/session','POST']]) {
    assert.equal((await call(service,path,method)).status,200,service+path);
  }
  assert.equal(upstream,5);
});

test('old share page shows a notice without network access or dynamic game imports',async()=>{
  const previous=globalThis.document;const app={innerHTML:''};
  globalThis.document={querySelector:()=>app};
  try {await installHistoricalShare();assert.match(app.innerHTML,/has been retired/);assert.match(app.innerHTML,/Play the Daily/);}
  finally {globalThis.document=previous;}
  assert.doesNotMatch(readFileSync('historical-share.mjs','utf8'),/fetch\(|import\(/);
  for(const path of ['app.js','leaderboard.mjs','social.mjs','path-model.mjs','worker/path-model.mjs'])
    assert.equal(existsSync(path),false,path);
});

test('retired client result writer cannot insert new legacy results',async()=>{
  const saved=globalThis.fetch;globalThis.fetch=()=>{throw Error('Unexpected database I/O');};
  try {
    for(const mode of ['full','top3']) {
      const r=await growth.fetch(new Request('https://packone.pro/v1/results',{method:'POST',
        headers:{'content-type':'application/json'},body:JSON.stringify({mode,score:100})}));
      assert.equal(r.status,410);
    }
  } finally {globalThis.fetch=saved;}
});
