import test from 'node:test';
import assert from 'node:assert/strict';
import {NetworkQuota} from '../edge/gateway.mjs';

function fixture() {
  const values=new Map(),writes={rows:0,alarms:0};let alarm=null;
  const get=async k=>Array.isArray(k)?new Map(k.filter(x=>values.has(x)).map(x=>[x,values.get(x)])):values.get(k);
  const setAlarm=async at=>{writes.alarms++;alarm=at;};
  const tx={get,put:async(k,v)=>{writes.rows++;values.set(k,v);},getAlarm:async()=>alarm,setAlarm};
  const quota=new NetworkQuota({storage:{transaction:fn=>fn(tx),get,setAlarm,deleteAll:async()=>values.clear()}});
  return {values,writes,quota,alarm:()=>alarm,fire:async()=>{alarm=null;await quota.alarm();},call:kind=>quota.fetch(new Request('https://quota/'+kind,{method:'POST'}))};
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
    sustained.values.set('buckets',{request:{count:3600,until:now+30000}});
    const full=await sustained.call('request');assert.equal(full.status,429);assert.equal(Number(full.headers.get('retry-after')),30);
    assert.equal(sustained.values.get('buckets').request_burst,undefined,'rejection never partially charges another bucket');
    assert.equal(sustained.writes.rows+sustained.writes.alarms,0,'a rejection writes nothing');
  } finally {Date.now=original;}
});
test('window boundaries permit only the documented bounded burst and counters survive reconstruction',async()=>{
  const f=fixture(),original=Date.now;let now=1000000;Date.now=()=>now;
  try {
    for(let i=0;i<600;i++)await f.call('request');
    now+=9999;assert.equal((await f.call('request')).status,429);
    now++;for(let i=0;i<600;i++)assert.equal((await f.call('request')).status,204);
    assert.equal((await f.call('request')).status,429);
    assert.equal(f.values.get('buckets').request.count,1200,'minute bucket carries usage across short-window reset');
  } finally {Date.now=original;}
});
test('each admitted call writes one row and arms cleanup once per active network',async()=>{
  const f=fixture(),original=Date.now;let now=1000000;Date.now=()=>now;
  try {
    for(let i=0;i<50;i++)assert.equal((await f.call(i%10?'request':'session')).status,204);
    assert.deepEqual(f.writes,{rows:50,alarms:1});assert.equal(f.alarm(),now+660000);
    assert.deepEqual(Object.keys(f.values.get('buckets')).sort(),['request','request_burst','session']);
    assert.deepEqual([...f.values.keys()],['buckets']);
  } finally {Date.now=original;}
});
test('counters stored under the per-bucket layout stay authoritative after deployment',async()=>{
  const f=fixture(),original=Date.now;let now=1000000;Date.now=()=>now;
  try {
    f.values.set('session',{count:120,until:now+300000});f.values.set('request',{count:3599,until:now+30000});
    const denied=await f.call('session');assert.equal(denied.status,429);assert.deepEqual((await denied.json()).scopes,['session']);
    assert.equal((await f.call('request')).status,204);assert.equal((await f.call('request')).status,429);
    assert.deepEqual(f.values.get('buckets').session,{count:120,until:now+300000},'the untouched bucket moves into the single row');
  } finally {Date.now=original;}
});
test('cleanup keeps open windows and deletes only expired counters',async()=>{
  const f=fixture(),original=Date.now;let now=1000000;Date.now=()=>now;
  try {
    assert.equal((await f.call('request')).status,204);
    // A minute window reopened shortly before the alarm is still open when it fires.
    now+=630000;assert.equal((await f.call('request')).status,204);
    now=f.alarm();await f.fire();
    assert.equal(f.values.get('buckets').request.count,1);assert.equal(f.alarm(),now+660000);
    now=f.alarm();await f.fire();
    assert.equal(f.values.size,0);assert.equal(f.alarm(),null);
    assert.equal((await f.call('request')).status,204);assert.equal(f.alarm(),now+660000,'a returning network re-arms cleanup');
  } finally {Date.now=original;}
});
