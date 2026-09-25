import test from 'node:test';
import assert from 'node:assert/strict';
import {NetworkQuota} from '../edge/gateway.mjs';

function fixture() {
  const values=new Map();
  const tx={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v),setAlarm:async()=>{}};
  const quota=new NetworkQuota({storage:{transaction:fn=>fn(tx),deleteAll:async()=>values.clear()}});
  return {values,call:kind=>quota.fetch(new Request('https://quota/'+kind,{method:'POST'}))};
}
test('100 simultaneous legitimate arrivals and full paced gameplay fit both request buckets',async()=>{
  const f=fixture(),original=Date.now;let now=1000000;Date.now=()=>now;
  try {
    for(let player=0;player<100;player++)assert.equal((await f.call('session')).status,204);
    // Status/start/first view plus eight pick/view pairs and results/shares.
    for(let wave=0;wave<22;wave++) {
      now+=3000;
      for(let player=0;player<100;player++)assert.equal((await f.call('request')).status,204);
    }
  } finally {Date.now=original;}
});
test('creation farming, short bursts and sustained abuse remain independently bounded',async()=>{
  const original=Date.now;let now=1000000;Date.now=()=>now;
  try {
    const creation=fixture();
    for(let i=0;i<120;i++)assert.equal((await creation.call('session-only')).status,204);
    const denied=await creation.call('session-only');assert.equal(denied.status,429);assert.deepEqual((await denied.json()).scopes,['session']);
    assert.equal(Number(denied.headers.get('retry-after')),600);
    assert.equal((await creation.call('request')).status,204,'existing players keep a separate request budget');
    const burst=fixture();
    for(let i=0;i<600;i++)assert.equal((await burst.call('request')).status,204);
    assert.equal((await burst.call('request')).status,429);
    now+=10000;assert.equal((await burst.call('request')).status,204);
    const sustained=fixture();
    // A persisted minute budget is authoritative even if the short bucket has expired.
    sustained.values.set('request',{count:3600,until:now+30000});
    const full=await sustained.call('request');assert.equal(full.status,429);assert.equal(Number(full.headers.get('retry-after')),30);
    assert.equal(sustained.values.has('request_burst'),false,'rejection never partially charges another bucket');
  } finally {Date.now=original;}
});
test('window boundaries permit only the documented bounded burst and counters survive reconstruction',async()=>{
  const f=fixture(),original=Date.now;let now=1000000;Date.now=()=>now;
  try {
    for(let i=0;i<600;i++)await f.call('request');
    now+=9999;assert.equal((await f.call('request')).status,429);
    now++;for(let i=0;i<600;i++)assert.equal((await f.call('request')).status,204);
    assert.equal((await f.call('request')).status,429);
    assert.equal(f.values.get('request').count,1200,'minute bucket carries usage across short-window reset');
  } finally {Date.now=original;}
});
