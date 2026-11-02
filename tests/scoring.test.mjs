import test from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates } from '../scoring.mjs';
import { gradeDraftRunPick } from '../draft-run.mjs';

const candidates = [
  {id:'a',name:'A',model_probability:.45},
  {id:'b',name:'B',model_probability:.40},
  {id:'c',name:'C',model_probability:.10},
  {id:'d',name:'D',model_probability:.05},
];
const puzzle = {candidates, historical_pick_id:'b',pick_number:5};

test('shared ranking is stable by support then name and does not mutate input',()=>{
  const input=[candidates[2],candidates[0],candidates[1]];
  assert.deepEqual(rankCandidates(input).map(c=>c.id),['a','b','c']);
  assert.equal(input[0].id,'c');
  assert.deepEqual(rankCandidates([{name:'Z',model_probability:.2},{name:'A',model_probability:.2}]).map(c=>c.name),['A','Z']);
});
test('current trophy pick gets 100 even when the model prefers another card',()=>{
  assert.equal(gradeDraftRunPick(puzzle,'b').score,100);
  assert.equal(gradeDraftRunPick(puzzle,'a').score,95);
});
test('current alternatives use the linear 95-point ratio',()=>{
  assert.equal(gradeDraftRunPick({...puzzle,historical_pick_id:'a'},'b').score,84);
  assert.equal(gradeDraftRunPick(puzzle,'d').score,11);
});
test('current scoring rejects a selection outside the pack',()=>{
  assert.throws(()=>gradeDraftRunPick(puzzle,'missing'));
});
