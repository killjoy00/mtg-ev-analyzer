import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDraftRun,runPickWindows,summarizeDraftRun} from '../draft-run.mjs';
import {dailyRequiredSets,dailySetWeight,releasedRunSets,TEN_PICK_SELECTION_VERSION} from '../draft-run-policy.mjs';
import {draftRunLength} from '../draft-run-format.mjs';

const day='2026-09-14';
const pool=releasedRunSets(day).flatMap(set=>Array.from({length:10},(_,i)=>i+1).flatMap(pick=>[30,65,90].map(rating=>({
  puzzle_id:`${set}-${pick}-${rating}`,source_draft_hash:`${set}-${pick}-${rating}`,set_id:set,pick_number:pick,
  candidate_count:15-pick,consensus_top_gap:.1,support_entropy:.8,top_two_ratio:rating/100,
  difficulty_version:'support-ratio-v1',target_support_ratio:1,
}))));

test('historical v3 Daily guarantees released top three and distinct sets/sources',()=>{
  assert.deepEqual(dailyRequiredSets(day),['hob','msh','sos']);
  for(let i=0;i<100;i++) {
    const run=selectDraftRun(pool,'required-'+i,'mixed',{daily:true,day,selectionVersion:'eight-pick-v3'});
    assert.equal(run.length,8);assert.equal(new Set(run.map(p=>p.set_id)).size,8);
    assert.equal(new Set(run.map(p=>p.source_draft_hash)).size,8);
    for(const id of dailyRequiredSets(day))assert.equal(run.filter(p=>p.set_id===id).length,1);
    assert.deepEqual(run,selectDraftRun(pool,'required-'+i,'mixed',{daily:true,day,selectionVersion:'eight-pick-v3'}));
  }
  assert.deepEqual(['tmt','ecl','tla','eoe','ktk'].map(id=>dailySetWeight(id,undefined,day)),[4,4,4,2,1]);
});

test('release dates, not archive timestamps, determine the guarantee and exclude future releases',()=>{
  const earlier='2026-07-01';assert.deepEqual(dailyRequiredSets(earlier),['msh','sos','tmt']);
  for(let i=0;i<20;i++)assert.ok(selectDraftRun(pool,'release-'+i,'mixed',{daily:true,day:earlier,selectionVersion:'eight-pick-v3'}).every(p=>p.set_id!=='hob'));
});

test('missing or infeasible required sets fail instead of silently weakening the guarantee',()=>{
  assert.throws(()=>selectDraftRun(pool.filter(p=>p.set_id!=='hob'),'missing','mixed',{daily:true,day,selectionVersion:'eight-pick-v3'}),/latest released sets/);
  const constrained=pool.filter(p=>!dailyRequiredSets(day).includes(p.set_id)||p.pick_number===1);
  assert.throws(()=>selectDraftRun(constrained,'impossible','mixed',{daily:true,day,selectionVersion:'eight-pick-v3'}),/latest released sets/);
});

test('ten-pick version retains its composition, windows and recency weighting',()=>{
  const run=selectDraftRun(pool,'historical','mixed',{selectionVersion:TEN_PICK_SELECTION_VERSION,daily:true,day});
  assert.equal(run.length,10);assert.deepEqual(runPickWindows('mixed',TEN_PICK_SELECTION_VERSION)[9],[8,10]);
  assert.equal(dailySetWeight('hob',TEN_PICK_SELECTION_VERSION,day),1.25);
  assert.equal(dailySetWeight('eoe',TEN_PICK_SELECTION_VERSION,day),1.1);
});

test('new and historical responses retain their own progress and scoring denominators',()=>{
  const p={historical_pick_id:'trophy',candidates:[{id:'leader',name:'Leader',model_probability:.6},{id:'trophy',name:'Trophy',model_probability:.4}]};
  for(const length of [8,10]) {
    const selected=Array(length).fill('trophy');selected[0]='leader';
    const result=summarizeDraftRun(Array(length).fill(p),selected);
    assert.equal(result.score,length===8?99:100);
    assert.equal(draftRunLength({run_length:length}),length);
  }
  assert.equal(draftRunLength({answers:[],complete:false}),10,'old API fallback');
  assert.equal(draftRunLength({answers:Array(8),complete:true}),8);
});
