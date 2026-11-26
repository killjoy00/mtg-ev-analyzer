import test from 'node:test';
import assert from 'node:assert/strict';
import {corpusQueryKind,corpusOperationProfiler} from './support/corpus-operation-profiler.mjs';

test('corpus profiling emits only fixed operation categories',()=>{
  assert.equal(corpusQueryKind('SELECT pack1_build_serving_snapshot($1,$2,$3) snapshot'),'snapshot_build_or_reuse');
  assert.equal(corpusQueryKind('SELECT pack1_serving_snapshot($1,$2,$3) snapshot'),'snapshot_read');
  assert.equal(corpusQueryKind('WITH expected AS MATERIALIZED (SELECT * FROM private) SELECT * FROM draft_run_serving_inventory EXCEPT SELECT * FROM private'),'inventory_exact_verification');
  assert.equal(corpusQueryKind('SELECT pack1_complete_readiness($1,$2,$3,$4)'),'readiness_complete');
  assert.equal(corpusQueryKind('SELECT private_data'),'other');
});
test('only the exact disposable SQL endpoint is timed; fetch response is unchanged',async()=>{
  const original=globalThis.fetch,logs=[],response={untouched:true},calls=[];
  const fake=async(...args)=>{calls.push(args);return response;};
  globalThis.fetch=fake;
  const connection='postgresql://fixture:PRIVATE_PASSWORD@ep-test.us-east-2.aws.neon.tech/fixture';
  let t=0;
  const profile=corpusOperationProfiler({suite:'corpus-admin',connection,
    env:{CI:'true',GITHUB_HEAD_REF:'perf/corpus-readiness-profile',PACK1_CI_BRANCH_ID:'br-fixture'},
    emit:line=>logs.push(line),clock:()=>t+=300});
  const init={method:'POST',headers:{'Neon-Connection-String':connection},body:JSON.stringify({query:'SELECT pack1_build_serving_snapshot($1,$2,$3) snapshot',params:['PRIVATE_PARAMETER']})};
  try {
    assert.equal(await fetch('https://api.us-east-2.aws.neon.tech/sql',init),response);
    assert.equal(await fetch('https://unrelated.invalid/sql',init),response);
    profile.mark();profile.finish();
    assert.equal(globalThis.fetch,fake);
    assert.equal(calls.length,2);
    assert.equal(calls[0][1],init);
    const summary=JSON.parse(logs.at(-1));
    assert.deepEqual(summary.operations,{snapshot_build_or_reuse:{calls:1,total_ms:300,max_ms:300}});
    assert.doesNotMatch(logs.join(' '),/PRIVATE|ep-test|br-fixture|SELECT|unrelated\.invalid/);
  } finally {profile.finish();globalThis.fetch=original;}
});
test('no extra profiling outside the explicit benchmark branch',()=>{
  const original=globalThis.fetch;
  const profile=corpusOperationProfiler({suite:'corpus-readiness',connection:'not a connection',env:{CI:'true',GITHUB_HEAD_REF:'main'},emit:()=>{throw Error('Unexpected output');}});
  profile.mark();profile.finish();
  assert.equal(globalThis.fetch,original);
});
