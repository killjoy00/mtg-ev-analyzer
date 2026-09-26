import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePuzzleMetadata,toPgArray,loadPuzzleMetadata,selectDatabaseReroll} from '../worker/draft-run-selection.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';

test('unknown trophy support remains unknown instead of becoming disagreement',()=>{
  assert.equal(decodePuzzleMetadata({target_support_ratio:null}).target_support_ratio,null);
  assert.equal(decodePuzzleMetadata({target_support_ratio:'0'}).target_support_ratio,0);
});
test('metadata requests preserve stored challenge order and missing IDs',async()=>{
  const rows=await loadPuzzleMetadata(async()=>({rows:[{puzzle_id:'b'},{puzzle_id:'a'}]}),'v6',['a','missing','b']);
  assert.deepEqual(rows.map(p=>p?.puzzle_id),['a',undefined,'b']);
  assert.equal(toPgArray([]),'{}');assert.equal(toPgArray(['a,b','"quoted"','a\\b']),'{'+'"a,b","\\"quoted\\"","a\\\\b"'+'}');
});
test('current Daily rerolls follow Live metadata, not the checked-in release list',async()=>{
  // A set newer than data/selection-policy.json (FRA) must still find same-set replacements.
  const source={puzzle_id:'x',set_id:'fra',pick_number:3,source_draft_hash:'h',corpus_version:DRAFT_RUN_CORPUS_VERSION,historical_pick_id:'a',
    candidates:[{id:'a',model_probability:0.5},{id:'b',model_probability:0.35},{id:'c',model_probability:0.15}],prior_picks:[{id:'p1'},{id:'p2'}]};
  const releaseListBound=async selectionVersion=>{
    const calls=[];
    await selectDatabaseReroll(async(sql,params)=>{calls.push({sql,params});return {rows:[]};},DRAFT_RUN_CORPUS_VERSION,source,
      {type:'pack',round:2,seed:'s',environment:'mixed',selectionVersion,difficultyVersion:'support-ratio-v1',daily:true,day:'2026-10-20',excludedSources:[]});
    return calls[0].params.some(p=>typeof p==='string'&&p.includes('"hob"'));
  };
  assert.equal(await releaseListBound('eight-pick-v4'),false);
  assert.equal(await releaseListBound('eight-pick-v3'),true);
});
