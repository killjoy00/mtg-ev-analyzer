import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePuzzleMetadata,toPgArray,loadPuzzleMetadata} from '../worker/draft-run-selection.mjs';

test('unknown trophy support remains unknown instead of becoming disagreement',()=>{
  assert.equal(decodePuzzleMetadata({target_support_ratio:null}).target_support_ratio,null);
  assert.equal(decodePuzzleMetadata({target_support_ratio:'0'}).target_support_ratio,0);
});
test('metadata requests preserve stored challenge order and missing IDs',async()=>{
  const rows=await loadPuzzleMetadata(async()=>({rows:[{puzzle_id:'b'},{puzzle_id:'a'}]}),'v6',['a','missing','b']);
  assert.deepEqual(rows.map(p=>p?.puzzle_id),['a',undefined,'b']);
  assert.equal(toPgArray([]),'{}');assert.equal(toPgArray(['a,b','"quoted"','a\\b']),'{'+'"a,b","\\"quoted\\"","a\\\\b"'+'}');
});
