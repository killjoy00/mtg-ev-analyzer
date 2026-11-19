import test from 'node:test';
import assert from 'node:assert/strict';
import {pruneCubeSessionRerollDeadEnds,verifyCubeSessionRerolls} from '../scripts/v5-cube-reroll-admission.mjs';
import {selectDraftRunReroll} from '../draft-run.mjs';
import {rateDraftRunPuzzle} from '../draft-run-difficulty.mjs';

function puzzle(i,rating=60,source=`s${i}`) {
  const candidates=[.6,.6*rating/100,.05,.04].map((p,j)=>({id:`c${j}`,name:`Card ${j}`,model_probability:p}));
  return {puzzle_id:`p${String(i).padStart(3,'0')}`,set_id:'powered-cube',source_draft_hash:source,
    pick_number:4,historical_pick_id:'c0',prior_picks:[{id:'a'},{id:'b'},{id:'c'}],candidates};
}

test('two local replacements do not prove availability after the seven other run sources',()=>{
  const rows=Array.from({length:9},(_,i)=>puzzle(i)),seen=rows.slice(0,8).map(p=>p.source_draft_hash);
  const options={type:'pack',round:2,seed:'session-exclusions',environment:'powered-cube',excludedSources:seen,anchor:rateDraftRunPuzzle(rows[0])};
  const first=selectDraftRunReroll(rows,rows[0],options);
  assert.ok(first);
  assert.equal(selectDraftRunReroll(rows,first,{...options,excludedSources:[...seen,first.source_draft_hash]}),null);
  assert.equal(verifyCubeSessionRerolls(rows).valid,false);
  assert.equal(pruneCubeSessionRerollDeadEnds(rows).rows.length,0);
});

test('ten independent compatible sources guarantee both rerolls under real session exclusions',()=>{
  const rows=Array.from({length:10},(_,i)=>puzzle(i));
  const result=pruneCubeSessionRerollDeadEnds(rows);
  assert.deepEqual(result.rows,rows);assert.equal(result.proof.valid,true);
  assert.equal(result.proof.minimum_first_sources,9);assert.equal(result.proof.minimum_second_sources,8);
  for(const original of rows) {
    const others=rows.filter(p=>p!==original);
    // Every pair that can remain after seven other sources are excluded.
    for(let i=0;i<others.length;i++)for(let j=i+1;j<others.length;j++) {
      const seen=[original,...others.filter((_,k)=>k!==i&&k!==j)].map(p=>p.source_draft_hash);
      const options={type:'pack',round:2,seed:`pair-${i}-${j}`,environment:'powered-cube',excludedSources:seen,anchor:rateDraftRunPuzzle(original)};
      const first=selectDraftRunReroll(rows,original,options);
      const second=selectDraftRunReroll(rows,first,{...options,excludedSources:[...seen,first.source_draft_hash]});
      assert.ok(first&&second);assert.ok(!seen.includes(second.source_draft_hash));
      assert.notEqual(first.source_draft_hash,second.source_draft_hash);
    }
  }
});

test('source counts are independent drafts, not duplicate decisions',()=>{
  const rows=Array.from({length:10},(_,i)=>puzzle(i,60,`s${i%9}`));
  assert.equal(verifyCubeSessionRerolls(rows).valid,false);
});

test('sparse rating fringes are pruned before they can erase a sound dense group',()=>{
  const core=Array.from({length:10},(_,i)=>puzzle(i,60));
  const rows=[...core,puzzle(20,70),puzzle(21,79)];
  const result=pruneCubeSessionRerollDeadEnds(rows);
  assert.equal(result.proof.valid,true);assert.ok(core.every(p=>result.rows.includes(p)));
  assert.ok(result.removed.includes('p021'));
  for(const p of result.rows)assert.equal(p,rows.find(original=>original.puzzle_id===p.puzzle_id),'admission must preserve exact model payloads');
  assert.deepEqual(pruneCubeSessionRerollDeadEnds(result.rows).rows,result.rows);
});
