import assert from 'node:assert/strict';

// Keep the rebuilt catalog as the minimum release inventory while admitting
// later, explicitly approved sets. A total alone can hide a missing old set.
export function assertPracticeReleaseCoverage(rows,{requiredSetIds,corpusVersion}) {
  assert.ok(Array.isArray(rows),'Practice coverage rows are required');
  assert.ok(Array.isArray(requiredSetIds)&&requiredSetIds.length>0,'A rebuilt catalog is required');
  const required=new Set(requiredSetIds);
  assert.equal(required.size,requiredSetIds.length,'Rebuilt catalog set identities must be unique');
  const byId=new Map();
  for(const row of rows) {
    assert.ok(typeof row?.set_id==='string'&&row.set_id,'Coverage must identify every environment');
    assert.ok(!byId.has(row.set_id),`Duplicate environment coverage: ${row.set_id}`);
    byId.set(row.set_id,row);
  }
  for(const id of required)assert.ok(byId.has(id),`Missing rebuilt environment: ${id}`);
  for(const [id,row] of byId) {
    assert.equal(row.corpus_version,corpusVersion,`Environment must point at the released corpus: ${id}`);
    if(!required.has(id))assert.equal(row.lifecycle_status,'Approved',`Additional environment must have an approved snapshot: ${id}`);
  }
  return {required:required.size,covered:byId.size,additional:byId.size-required.size};
}
