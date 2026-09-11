import test from 'node:test';
import assert from 'node:assert/strict';
import {loadVerifiedPool} from '../worker/draft-run-pool.mjs';
test('pool spans multiple bounded SQL responses without sampling',async()=>{
  const source=Array.from({length:10001},(_,i)=>({puzzle_id:String(i+1).padStart(8,'0'),pick_number:'2',candidate_count:'14',consensus_top_gap:'0.1',support_entropy:'0.7'}));
  let calls=0;
  const actual=await loadVerifiedPool(async(sql,[version,after,limit])=>{
    assert.equal(version,'v6');assert.match(sql,/puzzle_id>\$2.*LIMIT \$3/);assert.equal(limit,5000);calls++;
    return {rows:source.filter(p=>p.puzzle_id>after).slice(0,limit)};
  },'v6');
  assert.equal(calls,3);assert.equal(actual.length,10001);
  assert.equal(actual.at(-1).puzzle_id,'00010001');assert.equal(actual[0].pick_number,2);
});
test('nonadvancing cursor fails instead of looping',async()=>{
  await assert.rejects(loadVerifiedPool(async()=>({rows:[{puzzle_id:'a'}]}),'v6',1),/did not advance/);
});
