import test from 'node:test';
import assert from 'node:assert/strict';
import {rateDraftRunPuzzle,publicDifficulty,difficultyBand,DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';
import {selectDraftRun,selectDraftRunReroll} from '../draft-run.mjs';

const meta=(id,rating,{set='a',pick=1,entropy=.8,gap=.1}={})=>({puzzle_id:id,source_draft_hash:id,set_id:set,pick_number:pick,candidate_count:15-pick,
  consensus_top_gap:gap,support_entropy:entropy,top_two_ratio:rating/100,target_support_ratio:1,difficulty_version:DRAFT_RUN_DIFFICULTY_VERSION});

test('difficulty boundaries are explicit; ratios are independent of support scale',()=>{
  assert.deepEqual([0,49,50,79,80,100].map(difficultyBand),['easy','easy','medium','medium','hard','hard']);
  const puzzle={historical_pick_id:'c',candidates:[{id:'a',model_probability:.5},{id:'b',model_probability:.4},{id:'c',model_probability:.05},{id:'d',model_probability:.05}]};
  const rating=rateDraftRunPuzzle(puzzle);
  assert.equal(rating.rating,80);assert.equal(rating.band,'hard');assert.equal(rating.modelTargetDisagreement,true);
  assert.equal(rateDraftRunPuzzle({...puzzle,candidates:puzzle.candidates.map(c=>({...c,model_probability:c.model_probability*3}))}).rating,80);
  assert.deepEqual(Object.keys(publicDifficulty(puzzle)).sort(),['band','rating','version']);
  assert.throws(()=>rateDraftRunPuzzle({candidate_count:4}),/Missing/);
});

test('balanced runs enforce the easy cap and maintain a medium majority across seeds',()=>{
  const pool=[];
  for(let pick=1;pick<=12;pick++)for(let set=0;set<12;set++)for(const rating of [30,65,90])pool.push(meta(`${pick}-${set}-${rating}`,rating,{set:`s${set}`,pick}));
  for(let i=0;i<100;i++) {
    const run=selectDraftRun(pool,`difficulty-${i}`),bands=run.map(p=>rateDraftRunPuzzle(p).band);
    assert.equal(bands.filter(b=>b==='easy').length,1);
    assert.equal(bands.filter(b=>b==='medium').length,6);
    assert.equal(bands.filter(b=>b==='hard').length,3);
    assert.equal(new Set(run.map(p=>p.source_draft_hash)).size,10);
  }
  const noEasy=pool.filter(p=>p.top_two_ratio>=.5);
  assert.equal(selectDraftRun(noEasy,'no-easy').filter(p=>rateDraftRunPuzzle(p).band==='medium').length,7);
  assert.throws(()=>selectDraftRun(pool.filter(p=>p.top_two_ratio>=.8),'only-hard'),/balanced/);
});

test('rerolls cannot cross bands, jump ratings, drift after two uses, or consume an unavailable replacement',()=>{
  const source=meta('source',49),crossBand=meta('cross',50),tooFar=meta('far',30),near=meta('near',45);
  const options={type:'pack',round:0,seed:'test'};
  assert.equal(selectDraftRunReroll([crossBand,tooFar],source,options),null);
  assert.equal(selectDraftRunReroll([crossBand,tooFar,near],source,options).puzzle_id,'near');
  const original=meta('original',60),first=meta('first',70),drift=meta('drift',79),valid=meta('valid',67);
  assert.equal(selectDraftRunReroll([drift],first,{...options,anchor:publicDifficulty(original)}),null);
  assert.equal(selectDraftRunReroll([drift,valid],first,{...options,anchor:publicDifficulty(original)}).puzzle_id,'valid');
  assert.ok(selectDraftRunReroll([crossBand],source,{...options,difficultyVersion:'legacy'}));
});

test('equal difficulty does not override source, environment, depth, or decision-shape restrictions',()=>{
  const source=meta('source',65,{set:'powered-cube',pick:2});
  const options={type:'pack',round:0,seed:'test',environment:'powered-cube',excludedSources:['seen']};
  const candidates=[meta('seen',65,{set:'powered-cube',pick:2}),meta('expansion',65,{pick:2}),meta('late',65,{set:'powered-cube',pick:12}),meta('shape',65,{set:'powered-cube',pick:2,entropy:0,gap:1})];
  assert.equal(selectDraftRunReroll(candidates,source,options),null);
});
