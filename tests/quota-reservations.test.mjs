import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NetworkQuota} from '../edge/gateway.mjs';
const env={MODE:'preview',NEON_BRANCH_ID:'br-isolated-fixture',QUOTA_RESERVATIONS:'preview-v1'};
const request=kind=>new Request('https://quota/'+kind,{method:'POST'});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('provider rehearsal defaults off and wires the switch only to isolated preview deployment',()=>{
  const caller=readFileSync('.github/workflows/launch-distributed.yml','utf8');
  const callee=readFileSync('.github/workflows/launch-distributed-preview.yml','utf8');
  for(const workflow of [caller,callee])assert.match(workflow,/quota_reservations:[\s\S]*?type: boolean\n        default: false/);
  assert.match(caller,/quota_reservations: \$\{\{ inputs\.quota_reservations \|\| false \}\}/);
  assert.match(callee,/PREVIEW_QUOTA_RESERVATIONS: \$\{\{ inputs\.quota_reservations \}\}/);
  assert.equal(JSON.parse(readFileSync('edge/wrangler.json')).vars.QUOTA_RESERVATIONS,undefined);
  assert.doesNotMatch(readFileSync('scripts/edge-production-control.mjs','utf8'),/QUOTA_RESERVATIONS/);
});
function fixture({sync=async()=>{},retry=false}={}) {
  const values=new Map(),writes={rows:0,alarms:0,sync:0};let alarm=null,quota;
  const get=async k=>structuredClone(Array.isArray(k)?new Map(k.filter(x=>values.has(x)).map(x=>[x,values.get(x)])):values.get(k));
  const tx={get,put:async(k,v)=>{writes.rows++;values.set(k,structuredClone(v));},getAlarm:async()=>alarm,setAlarm:async at=>{writes.alarms++;alarm=at;}};
  const storage={...tx,transaction:async fn=>{
    if(retry) {const before=structuredClone(values),oldAlarm=alarm;await fn(tx);values.clear();for(const [k,v] of before)values.set(k,v);alarm=oldAlarm;}
    return fn(tx);
  },sync:async()=>{writes.sync++;await sync();},deleteAll:async()=>{values.clear();alarm=null;}};
  const restart=(settings=env)=>quota=new NetworkQuota({storage},settings);restart();
  return {values,writes,storage,restart,quota:()=>quota,call:kind=>quota.fetch(request(kind)),fire:()=>{alarm=null;return quota.alarm();}};
}
async function clock(run) {const original=Date.now;let now=1000000;Date.now=()=>now;try {await run(at=>now=at,()=>now);}finally {Date.now=original;}}

test('only explicit isolated preview can activate reservations',async()=>{
  for(const settings of [{},{...env,MODE:'production'},{...env,NEON_BRANCH_ID:'br-orange-feather-ayps8kep'},
    {...env,NEON_BRANCH_ID:'br-twilight-hill-ayffyd2b'},{...env,NEON_BRANCH_ID:''},{...env,QUOTA_RESERVATIONS:'true'}]) {
    const f=fixture();f.restart(settings);for(let i=0;i<9;i++)assert.equal((await f.call('request')).status,204);
    assert.equal(f.writes.rows,9);assert.equal(f.quota().reservations,undefined);
  }
});

test('confirmed credits reduce request writes eightfold and preserve exact burst cap under concurrency',async()=>clock(async()=>{
  const f=fixture(),responses=await Promise.all(Array.from({length:650},()=>f.call('request')));
  assert.equal(responses.filter(r=>r.status===204).length,600);
  assert.equal(responses.filter(r=>r.status===429).length,50);
  assert.equal(f.writes.rows,75);assert.equal(f.writes.alarms,1);
  assert.equal(f.values.get('buckets').request.count,600);
}));

test('no concurrent request spends credits before their acknowledgement; failures forfeit tentative credits',async()=>clock(async()=>{
  const wait=deferred(),commit=deferred();let first=true,finished=0;
  const f=fixture({sync:async()=>{if(first){first=false;wait.resolve();await commit.promise;}}});
  const a=f.call('request').then(()=>{finished++;},e=>e),b=f.call('request').then(r=>{finished++;return r;});
  await wait.promise;await new Promise(r=>setImmediate(r));assert.equal(finished,0);assert.equal(f.writes.rows,1);
  commit.reject(Error('storage failed'));assert.match((await a).message,/storage failed/);
  assert.equal((await b).status,204);assert.equal(f.writes.rows,2);
  assert.equal(f.values.get('buckets').request.count,16,'failed reservation cannot be reused');
}));

test('restart discards unused credits, including strict-mode rollback, without reopening windows',async()=>clock(async()=>{
  const f=fixture();assert.equal((await f.call('session')).status,204);
  assert.equal(f.values.get('buckets').request.count,8);assert.equal(f.values.get('buckets').session.count,2);
  f.restart();assert.equal((await f.call('session')).status,204);
  assert.equal(f.values.get('buckets').request.count,16);assert.equal(f.values.get('buckets').session.count,4);
  f.restart({MODE:'production'});assert.equal((await f.call('session')).status,204);
  assert.equal(f.values.get('buckets').request.count,17);assert.equal(f.values.get('buckets').session.count,5);
  const g=fixture();for(let i=0;i<60;i++){g.restart();assert.equal((await g.call('session-only')).status,204);}
  assert.equal((await g.call('session-only')).status,204,'last current-instance credit remains usable');
  assert.equal((await g.call('session-only')).status,429,'restart churn can only deny conservatively');
}));

test('all session routes share the creation cap and denial never partly spends another budget',async()=>clock(async()=>{
  const f=fixture();for(let i=0;i<120;i++)assert.equal((await f.call(i%2?'session':'session-only')).status,204);
  const before=structuredClone(f.values.get('buckets')),writes=f.writes.rows;
  const denied=await f.call('session');assert.equal(denied.status,429);assert.deepEqual((await denied.json()).scopes,['session']);
  assert.deepEqual(f.values.get('buckets'),before);assert.equal(f.writes.rows,writes);
  assert.equal((await f.call('request')).status,204,'existing players retain their request budget');
}));

test('credits expire at each exact boundary and minute budget survives burst resets',async()=>clock(async(set,now)=>{
  const f=fixture();await f.call('request');assert.equal(f.values.get('buckets').request.count,8);
  set(now()+10000);await f.call('request');
  assert.equal(f.values.get('buckets').request.count,8,'remaining minute credits survive');
  assert.equal(f.values.get('buckets').request_burst.until,now()+10000);
  set(1000000);const g=fixture();
  for(let window=0;window<6;window++) {
    set(1000000+window*10000);
    for(let i=0;i<600;i++)assert.equal((await g.call('request')).status,204);
    assert.equal((await g.call('request')).status,429);
  }
  assert.equal(g.values.get('buckets').request.count,3600);
  set(1059999);assert.equal((await g.call('request')).status,429);
  set(1060000);assert.equal((await g.call('request')).status,204);
  assert.equal(g.values.get('buckets').request.count,8);
}));

test('legacy and partially filled rows reserve only the remaining headroom',async()=>clock(async(_,now)=>{
  const f=fixture();f.values.set('request',{count:3599,until:now()+30000});f.values.set('session',{count:120,until:now()+600000});
  assert.equal((await f.call('session')).status,429);assert.equal(f.writes.rows,0);
  assert.equal((await f.call('request')).status,204);assert.equal(f.values.get('buckets').request.count,3600);
  assert.equal((await f.call('request')).status,429);assert.equal(f.values.get('buckets').session.count,120);
}));

test('malformed persisted counters fail closed without writes or granting credits',async()=>clock(async(_,now)=>{
  for(const row of [false,[],{request:null},{request:{count:-1,until:now()+1000}},
    {request:{count:'0',until:now()+1000}},{request:{count:0,until:NaN}},
    {request:{count:0,until:'later'}},{unexpected:{count:0,until:now()+1000}}]) {
    const f=fixture();f.values.set('buckets',row);
    await assert.rejects(f.call('request'));assert.equal(f.writes.rows,0);
  }
}));

test('transaction callback retries cannot duplicate in-memory credits',async()=>clock(async()=>{
  const f=fixture({retry:true});for(let i=0;i<9;i++)assert.equal((await f.call('request')).status,204);
  assert.equal(f.values.get('buckets').request.count,16);assert.equal(f.quota().reservations.credits.request.remaining,7);
}));

test('100 shared-network players and paced full gameplay fit the unchanged limits',async()=>clock(async(set,now)=>{
  const f=fixture();assert.equal((await Promise.all(Array.from({length:100},()=>f.call('session')))).every(r=>r.status===204),true);
  for(let wave=0;wave<22;wave++) {
    set(now()+3000);const responses=await Promise.all(Array.from({length:100},()=>f.call('request')));
    assert.equal(responses.every(r=>r.status===204),true);
  }
  assert.ok(f.writes.rows<400,'same gameplay uses far fewer durable writes');
}));

test('alarms serialize with pending reservations, preserve open counters, and clear expired credit',async()=>clock(async(set,now)=>{
  const wait=deferred(),commit=deferred();let first=true;
  const f=fixture({sync:async()=>{if(first){first=false;wait.resolve();await commit.promise;}}});
  const call=f.call('session');await wait.promise;const alarm=f.fire();
  commit.resolve();assert.equal((await call).status,204);await alarm;
  assert.equal(f.values.get('buckets').session.count,2);
  assert.equal((await f.call('session-only')).status,204);assert.equal(f.values.get('buckets').session.count,2);
  set(now()+660000);await f.fire();assert.equal(f.values.size,0);
  assert.equal((await f.call('session')).status,204);assert.equal(f.values.get('buckets').session.count,2);
}));

test('generated mixed traffic with evictions never admits a request outside the original limits',async()=>clock(async(set,now)=>{
  const f=fixture(),oracle={};let seed=17;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let i=0;i<10000;i++) {
    if(i%73===0)f.restart();
    if(i%97===0)set(now()+random()%15000);
    const kind=['request','session','session-only'][random()%3];
    const limits=[...(kind!=='session-only'?[['request',3600,60000],['request_burst',600,10000]]:[]),...(kind!=='request'?[['session',120,600000]]:[])];
    const result=await f.call(kind);
    if(result.status!==204){assert.equal(result.status,429);continue;}
    for(const [key,cap,period] of limits) {
      if(!oracle[key]||now()>=oracle[key].until)oracle[key]={count:0,until:now()+period};
      assert.ok(oracle[key].count<cap,`original ${key} cap at event ${i}`);oracle[key].count++;
    }
  }
}));
