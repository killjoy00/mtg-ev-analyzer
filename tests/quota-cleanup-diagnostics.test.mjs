import test from 'node:test';
import assert from 'node:assert/strict';
import {NetworkQuota} from '../edge/gateway.mjs';
import {TRACE_HEADER} from '../edge/private-diagnostics.mjs';

const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
async function capture(run) {
  const rows=[],old=console.log;console.log=line=>rows.push(JSON.parse(line));
  try {return await run(rows);} finally {console.log=old;}
}
function fixture({stored={},sync=async()=>{},getFailure,writeFailure}={}) {
  const calls={get:0,clear:0,rearm:0,sync:0};
  const quota=new NetworkQuota({storage:{
    get:async()=>{calls.get++;if(getFailure)throw getFailure;return stored;},
    setAlarm:async()=>{calls.rearm++;if(writeFailure)throw writeFailure;},
    deleteAll:async()=>{calls.clear++;if(writeFailure)throw writeFailure;},
    sync:async()=>{calls.sync++;return sync();},
  }});
  return {quota,calls};
}

test('cleanup completion waits for durable acknowledgement after buffered deleteAll',async()=>capture(async rows=>{
  const commit=deferred(),f=fixture({sync:()=>commit.promise});let done=false;
  const pending=f.quota.alarm().then(()=>{done=true;});
  try {
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.calls.sync,1);
    assert.equal(done,false);
    assert.deepEqual(rows.map(x=>x.event),['quota_alarm_start','quota_alarm_commit_wait']);
    assert.equal(rows[1].action,'clear');
    commit.resolve();await pending;
    const metric=rows.at(-1);
    assert.equal(metric.event,'quota_alarm');assert.equal(metric.timing_version,2);
    assert.equal(metric.phase,'complete');assert.equal(metric.durability_confirmed,true);assert.equal(metric.ok,true);
    assert.deepEqual(f.calls,{get:1,clear:1,rearm:0,sync:1});
  } finally {commit.resolve();await pending;}
}));

test('an open window keeps its existing cleanup delay and observes rearm durability',async()=>capture(async rows=>{
  const original=Date.now;Date.now=()=>1000000;
  const stored={request:{count:7,until:1000100}},commit=deferred();let at;
  const f=fixture({stored,sync:()=>commit.promise});f.quota.storage.setAlarm=async value=>{f.calls.rearm++;at=value;};
  const pending=f.quota.alarm({isRetry:true,retryCount:2});
  try {
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(at,1660000);assert.equal(f.calls.clear,0);assert.equal(rows.at(-1).action,'rearm');
    assert.equal(rows.at(-1).event,'quota_alarm_commit_wait');
    commit.resolve();await pending;
    assert.equal(rows.at(-1).durability_confirmed,true);
    assert.equal(rows.at(-1).is_retry,true);assert.equal(rows.at(-1).retry_count,2);
    assert.deepEqual(stored,{request:{count:7,until:1000100}});
  } finally {commit.resolve();await pending;Date.now=original;}
}));

test('cleanup durability failure remains retryable by the runtime and cannot log success',async()=>capture(async rows=>{
  const error=Object.assign(Error('Internal error in Durable Object storage caused object to be reset; reference = private-reference'),{retryable:true});
  const f=fixture({sync:async()=>{throw error;}});
  await assert.rejects(f.quota.alarm(),e=>e===error);
  assert.equal(f.calls.clear,1);assert.equal(f.calls.sync,1);
  const metric=rows.at(-1);
  assert.equal(metric.ok,false);assert.equal(metric.phase,'durability');assert.equal(metric.durability_confirmed,false);
  assert.equal(metric.failure_code,'storage_reset');assert.equal(metric.provider_reset,true);
  assert.doesNotMatch(JSON.stringify(rows),/private-reference/);
}));

test('cleanup read and write failures retain their actual stage without retrying storage',async()=>{
  for(const stage of ['get','write'])await capture(async rows=>{
    const error=Error('private storage detail'),f=fixture(stage==='get'?{getFailure:error}:{writeFailure:error});
    await assert.rejects(f.quota.alarm(),e=>e===error);
    assert.equal(f.calls.get,1);assert.equal(f.calls.clear,stage==='get'?0:1);assert.equal(f.calls.sync,0);
    assert.equal(rows.at(-1).phase,stage);assert.equal(rows.at(-1).ok,false);
    assert.doesNotMatch(JSON.stringify(rows),/private storage detail/);
  });
});

test('invalid alarm metadata and unavailable logging cannot change cleanup enforcement',async()=>{
  await capture(async rows=>{
    const f=fixture();await f.quota.alarm({isRetry:'private',retryCount:'private'});
    assert.equal(rows.at(-1).is_retry,null);assert.equal(rows.at(-1).retry_count,null);
    assert.doesNotMatch(JSON.stringify(rows),/private/);
  });
  const old=console.log;console.log=()=>{throw Error('logging unavailable');};
  try {
    const f=fixture();await f.quota.alarm();assert.deepEqual(f.calls,{get:1,clear:1,rearm:0,sync:1});
    const error=Error('storage failed'),broken=fixture({sync:async()=>{throw error;}});
    await assert.rejects(broken.quota.alarm(),e=>e===error);
    assert.equal(broken.quota.cleanupInflight,0);
  }
  finally {console.log=old;}
});

test('a request overlapping cleanup is identifiable without extra debits or surviving state',async()=>capture(async rows=>{
  const commit=deferred();let stored,puts=0;
  const tx={get:async key=>Array.isArray(key)?new Map():stored,put:async(key,value)=>{stored=value;puts++;},getAlarm:async()=>1};
  const quota=new NetworkQuota({storage:{get:async()=>({}),deleteAll:async()=>{},transaction:fn=>fn(tx),sync:()=>commit.promise}});
  const alarm=quota.alarm();await new Promise(resolve=>setImmediate(resolve));
  const request=()=>new Request('https://quota/request',{method:'POST',headers:{[TRACE_HEADER]:'a'.repeat(32)}});
  const charged=quota.fetch(request());
  try {
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(rows.find(x=>x.event==='quota_handler_start').cleanup_inflight,true);
    assert.equal(puts,1);assert.equal(stored.request.count,1);
    commit.resolve();await alarm;assert.equal((await charged).status,204);
    assert.equal(quota.cleanupInflight,0);assert.equal(quota.inflight,0);
    assert.equal((await quota.fetch(request())).status,204);
    assert.equal(rows.at(-1).cleanup_inflight,false);assert.equal(stored.request.count,2);
  } finally {commit.resolve();await Promise.allSettled([alarm,charged]);}
}));

test('quota state layout distinguishes current, legacy and empty using only existing reads',async()=>{
  for(const layout of ['current','legacy','empty'])await capture(async rows=>{
    const current=layout==='current'?{request:{count:1,until:Date.now()+60000}}:null;
    const legacy=layout==='legacy'?new Map([['session',{count:1,until:Date.now()+600000}]]):new Map();
    let reads=0,puts=0;
    const tx={get:async key=>{reads++;return Array.isArray(key)?legacy:current;},put:async()=>{puts++;},getAlarm:async()=>1};
    const quota=new NetworkQuota({storage:{transaction:fn=>fn(tx),sync:async()=>{}}});
    await quota.fetch(new Request('https://quota/request',{method:'POST',headers:{[TRACE_HEADER]:'a'.repeat(32)}}));
    assert.equal(rows.at(-1).state_layout,layout);assert.equal(reads,layout==='current'?1:2);assert.equal(puts,1);
    assert.equal(rows.at(-1).durability_confirmed,true);
    assert.doesNotMatch(JSON.stringify(rows),/"count"|"until"/);
  });
});
