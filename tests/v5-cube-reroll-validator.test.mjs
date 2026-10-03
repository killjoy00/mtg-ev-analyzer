import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCubeRerollSlack} from '../scripts/verify-v5-cube-rerolls.mjs';

function puzzle(i) {
  const candidates=[
    {id:`a-${i}`,name:'A',model_probability:.4},
    {id:`b-${i}`,name:'B',model_probability:.24},
    {id:`c-${i}`,name:'C',model_probability:.1},
    {id:`d-${i}`,name:'D',model_probability:.08},
  ];
  return {
    puzzle_id:`p-${String(i).padStart(2,'0')}`,
    set_id:'powered-cube',
    source_draft_hash:`source-${String(i).padStart(2,'0')}`,
    pick_number:4,
    historical_pick_id:candidates[0].id,
    prior_picks:Array.from({length:3},(_,j)=>({id:`prior-${i}-${j}`,name:`Prior ${j}`})),
    candidates,
  };
}

test('full Cube reroll validator reserves seven already-used run sources for both rerolls',()=>{
  const safe=validateCubeRerollSlack(Array.from({length:10},(_,i)=>puzzle(i)),{requireV5:false});
  assert.equal(safe.min_first_sources,9);
  assert.equal(safe.min_second_sources,8);
  assert.throws(
    ()=>validateCubeRerollSlack(Array.from({length:9},(_,i)=>puzzle(i)),{requireV5:false}),
    /second Cube reroll sources/,
  );
});
