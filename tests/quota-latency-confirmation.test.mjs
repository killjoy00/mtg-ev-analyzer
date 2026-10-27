import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFIRMATION_PLAN,confirmQuotaLatency,analyzeConfirmation} from '../scripts/quota-latency-confirmation.mjs';
function summary(value,samples=1024){return {client:{samples,p95_ms:value,p99_ms:value+5},handler:{samples,p95_ms:value,p99_ms:value+5}};}
function fixtureRepeats(right=10) {
  return CONFIRMATION_PLAN.map((comparison,i)=>({repeat:i+1,comparison,baseline:summary(20),right:summary(comparison==='aa'?20:right),
    cohorts:Array.from({length:8},(_,index)=>({cohort:index+1,baseline:summary(20,128),right:summary(comparison==='aa'?20:right,128)}))}));
}
test('identical A/A is neutral; confirmation still requires every A/B repeat to meet the existing rule',()=>{
  const rows=fixtureRepeats(),analysis=analyzeConfirmation(rows);
  assert.equal(analysis.latency_confirmation_passed,true);assert.equal(analysis.production_ready,false);
  assert.equal(analysis.by_metric.handler_p99.control.max_absolute_delta_ms,0);
  for(let i=0;i<3;i++)rows[1].cohorts[i].right=summary(21,128);
  assert.equal(analyzeConfirmation(rows).latency_confirmation_passed,false,'five winning cohorts cannot pass');
});
test('control variation is descriptive and cannot waive a failed candidate gate',()=>{
  const rows=fixtureRepeats();for(const row of rows.filter(r=>r.comparison==='aa'))for(const cohort of row.cohorts)cohort.right=summary(120,128);
  for(let i=0;i<3;i++)rows[2].cohorts[i].right=summary(21,128);
  const analysis=analyzeConfirmation(rows);
  assert.equal(analysis.by_metric.client_p95.candidate_regressions_within_observed_control_p95,3);
  assert.equal(analysis.latency_confirmation_passed,false);
  assert.throws(()=>analyzeConfirmation(rows.slice(0,3)),/incomplete_confirmation_plan/);
  const wrong=structuredClone(rows);wrong[0].comparison='ab';assert.throws(()=>analyzeConfirmation(wrong),/invalid_confirmation_sequence/);
  const missing=structuredClone(rows);missing[1].right.client.samples=1000;assert.throws(()=>analyzeConfirmation(missing),/incomplete_confirmation_coverage/);
});
function transport({alias=false,wrongImplementation=false,actorMismatch=false,failAfter=Infinity}={}) {
  const states=new Map();let calls=0;
  return {calls:()=>calls,fetcher:async(url,options)=>{
    if(++calls>failAfter)throw Error('private transport detail');
    const {mode,cohort}=JSON.parse(options.body),id=mode+cohort;
    const count=(states.get(id)||0)+1;states.set(id,count);
    return new Response(null,{status:204,headers:{'x-quota-counter-write-total':String(mode==='candidate'?Math.ceil(count/8):count),
      'x-pack1-quota-handler-ms':mode==='candidate'?'2':'20','x-quota-instance':(alias?'a':{baseline:'a',control:'b',candidate:'c'}[mode]).repeat(32),
      'x-quota-actor-instance':(actorMismatch&&mode!=='baseline'?'e':'d').repeat(32),
      'x-quota-implementation':mode==='candidate'||(wrongImplementation&&mode==='control')?'coalesced-preview':'per-request'}});
  }};
}
test('the entire fixed balanced experiment runs once within budget and retains all repeats',async()=>{
  const f=transport(),progress=[];let now=0;
  const report=await confirmQuotaLatency({url:'https://synthetic.invalid',key:'synthetic-key',fetcher:f.fetcher,clock:()=>now++,onRepeat:r=>progress.push(r)});
  assert.equal(f.calls(),8256);assert.equal(report.requests,8256);assert.deepEqual(report.plan,['aa','ab','ab','aa']);
  assert.deepEqual(progress.map(r=>r.comparison),report.plan);assert.equal(progress.length,4);
  for(const repeat of report.repetitions) {
    assert.equal(repeat.baseline.client.samples,1024);assert.equal(repeat.right.client.samples,1024);assert.equal(repeat.cohorts.length,8);
    assert.equal(repeat.counter_write_decisions.baseline,1032);
    assert.equal(repeat.counter_write_decisions.right,repeat.comparison==='aa'?1032:136);
  }
  assert.equal(report.production_ready,false);assert.doesNotMatch(JSON.stringify(report),/synthetic-key|authorization|synthetic\.invalid|aaaaaaaa/);
});
test('the control must be a separate per-request implementation with real evidence',async()=>{
  for(const [options,reason] of [[{alias:true},/confirmation_wrappers_not_distinct/],[{wrongImplementation:true},/wrong_confirmation_implementation/],[{actorMismatch:true},/confirmation_actor_not_shared/]])
    await assert.rejects(confirmQuotaLatency({url:'https://synthetic.invalid',key:'key',fetcher:transport(options).fetcher}),reason);
  await assert.rejects(confirmQuotaLatency({url:'https://synthetic.invalid',key:'key',fetcher:async()=>new Response(null,{status:204})}),/missing_confirmation_evidence/);
});
test('a failed later repeat preserves earlier evidence and never retries to obtain a pass',async()=>{
  const f=transport({failAfter:4128}),progress=[];
  await assert.rejects(confirmQuotaLatency({url:'https://synthetic.invalid',key:'key',fetcher:f.fetcher,onRepeat:r=>progress.push(r)}),/confirmation_baseline_transport/);
  assert.equal(progress.length,2);assert.equal(f.calls(),4129);
});

// Exercise the actual crossover object, not only the client protocol fixture.
const {CrossoverQuota}=await import('../edge/quota-benchmark.mjs');
function crossoverFixture(sync=async()=>{}) {
  const values=new Map();let alarm=null,tail=Promise.resolve(),deletions=0;
  const storage={get:async keys=>Array.isArray(keys)?new Map(keys.filter(k=>values.has(k)).map(k=>[k,structuredClone(values.get(k))])):structuredClone(values.get(keys)),
    put:async(k,v)=>values.set(k,structuredClone(v)),getAlarm:async()=>alarm,setAlarm:async at=>{alarm=at;},sync,
    deleteAll:async()=>{deletions++;values.clear();}};
  storage.transaction=fn=>{const pending=tail.then(()=>fn(storage));tail=pending.catch(()=>{});return pending;};
  const quota=new CrossoverQuota({storage}),call=mode=>quota.fetch(new Request('https://quota/request',{method:'POST',headers:{'x-quota-probe-mode':mode}}));
  return {values,call,quota,deletions:()=>deletions};
}
test('crossover uses one native counter without resets or separate per-policy storage keys',async()=>{
  const original=Date.now;Date.now=()=>1000000;
  try {
    for(const right of ['control','candidate']) {
      const f=crossoverFixture();let actor;
      for(let i=0;i<129;i++)for(const mode of ['baseline',right]) {
        const response=await f.call(mode);assert.equal(response.status,204);
        actor??=response.headers.get('x-quota-actor-instance');assert.equal(response.headers.get('x-quota-actor-instance'),actor);
      }
      assert.deepEqual([...f.values.keys()],['buckets']);assert.equal(f.deletions(),0);
      assert.equal(f.values.get('buckets').request.count,right==='control'?258:265);
    }
  } finally {Date.now=original;}
});
test('the combined crossover modes cannot each obtain an independent burst allowance',async()=>{
  const original=Date.now;Date.now=()=>1000000;
  try {
    const f=crossoverFixture(),responses=[];
    for(let sent=0;sent<650;sent+=10)responses.push(...await Promise.all(Array.from({length:Math.min(10,650-sent)},()=>f.call(sent%20?'control':'baseline'))));
    assert.equal(responses.filter(r=>r.status===204).length,600);assert.equal(responses.filter(r=>r.status===429).length,50);
    assert.equal(f.values.get('buckets').request_burst.count,600);
  } finally {Date.now=original;}
});
test('a policy cannot switch while another policy has an unacknowledged call',async()=>{
  let release,waiting;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{waiting=resolve;});let first=true;
  const f=crossoverFixture(async()=>{if(first){first=false;waiting();await gate;}});
  const baseline=f.call('baseline');await ready;
  assert.equal((await f.call('candidate')).status,409);
  assert.equal(f.values.get('buckets').request.count,1);
  release();assert.equal((await baseline).status,204);assert.equal((await f.call('candidate')).status,204);
});
