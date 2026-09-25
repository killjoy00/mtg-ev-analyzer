import test from 'node:test';
import assert from 'node:assert/strict';
import {customSetsFromSnapshot,selectCachedDatabaseRun,loadCachedCustomSetMetadata} from '../worker/draft-run-selection.mjs';

const snapshot={id:'1',revision:'1',metadata:[{set_id:'hob',release_date:'2020-01-01',status:'Live',regular_run:true,set_name:'HOB'}],
  groups:Array.from({length:8},(_,i)=>['medium','hard'].map(band=>({set_id:'hob',pick_number:i+1,band,n:100,sources:16}))).flat()};
test('custom coverage uses distinct sources for every pick and band; dates remain request-time policy',()=>{
  assert.equal(customSetsFromSnapshot(snapshot,'2026-09-25').length,1);
  assert.equal(customSetsFromSnapshot(snapshot,'2019-12-31').length,0);
  const incomplete=structuredClone(snapshot);incomplete.groups[0].sources=15;
  assert.equal(customSetsFromSnapshot(incomplete,'2026-09-25').length,0);
  incomplete.groups[0].n=100000;
  assert.equal(customSetsFromSnapshot(incomplete,'2026-09-25').length,0);
});
test('builder contention is retryable and never falls back to expensive live aggregates',async()=>{
  let calls=0;
  await assert.rejects(selectCachedDatabaseRun(async sql=>{calls++;assert.match(sql,/pack1_serving_snapshot/);return {rows:[{snapshot:null}]};},'v','seed'),e=>e.status===503);
  assert.equal(calls,1);
});
test('custom listing discards a stale revision and reads one new complete snapshot',async()=>{
  let builds=0,checks=0;
  const query=async sql=>sql.includes('pack1_serving_snapshot')?{rows:[{snapshot:{...snapshot,revision:String(++builds)}}]}:
    {rows:[{revision:String(++checks===1?2:builds)}]};
  assert.deepEqual(await loadCachedCustomSetMetadata(query,'v','2026-09-25'),snapshot.metadata);
  assert.equal(builds,2);
});
test('persistent revision churn is bounded and returns a retryable error',async()=>{
  let builds=0;
  const query=async sql=>sql.includes('pack1_serving_snapshot')?(builds++,{rows:[{snapshot}]}):{rows:[{revision:'2'}]};
  await assert.rejects(loadCachedCustomSetMetadata(query,'v'),e=>e.status===503);
  assert.equal(builds,2);
});
