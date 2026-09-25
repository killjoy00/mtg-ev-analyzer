// Only the disposable backend gate invokes this suite.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadServingSnapshot,selectCachedDatabaseRun,selectDatabaseRun,servingRevisionMatches} from '../worker/draft-run-selection.mjs';
import {DRAFT_RUN_CORPUS_VERSION as version} from '../draft-run.mjs';
if(!process.argv.includes('--dev-fixtures'))throw Error('Isolated branch required.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query}=await import('../worker/growth-function.js');
const revision=async()=>BigInt((await query('SELECT revision::text FROM draft_run_serving_revision WHERE singleton')).rows[0].revision);
const snapshot=await loadServingSnapshot(query,version);
assert.equal((await loadServingSnapshot(query,version)).id,snapshot.id,'warm hit reuses one complete generation');
for(const environment of ['mixed','powered-cube']) {
  const seed='cache-backend-'+environment;
  const cached=await selectCachedDatabaseRun(query,version,seed,environment);
  assert.deepEqual(cached,await selectDatabaseRun(query,version,seed,environment),'exact IDs, source trajectories and difficulty anchors');
  assert.equal(cached.servingRevision,snapshot.revision);
}

// Statement invalidation remains constant-cost even when no row is changed.
// This exercises every input family without modifying production-cloned data.
for(const sql of [
  'UPDATE draft_run_verified_puzzles SET interesting=interesting WHERE false',
  'DELETE FROM draft_run_verified_puzzles WHERE false',
  'UPDATE draft_run_puzzle_ratings SET rating=rating WHERE false',
  'DELETE FROM corpus_source_exclusions WHERE false',
  'UPDATE corpus_components SET status=status WHERE false',
  'UPDATE draft_run_environment_policy SET release_date=release_date WHERE false',
  'UPDATE corpus_set_versions SET corpus_version=corpus_version WHERE false',
  'DELETE FROM corpus_set_versions WHERE false',
]) {
  const before=await revision();await query(sql);
  assert.equal(await revision(),before+1n,sql);
}
assert.equal(await servingRevisionMatches(query,snapshot.revision),false,'old generation cannot be accepted');
const before=await revision();
await query("UPDATE draft_run_verified_puzzles SET payload=payload WHERE false");
assert.equal(await revision(),before,'display payload maintenance does not invalidate eligibility');
await query(`DO $$ BEGIN
  UPDATE draft_run_verified_puzzles SET interesting=interesting WHERE false;
  UPDATE draft_run_puzzle_ratings SET rating=rating WHERE false;
  UPDATE draft_run_environment_policy SET status=status WHERE false;
END $$`);
assert.equal(await revision(),before+1n,'bulk/nested rating writers bump once per transaction');
const rollbackBefore=await revision();
await query(`DO $$ BEGIN BEGIN
  UPDATE draft_run_puzzle_ratings SET rating=rating WHERE false;
  RAISE EXCEPTION 'rollback fixture';
EXCEPTION WHEN raise_exception THEN NULL; END; END $$`);
assert.equal(await revision(),rollbackBefore,'rolled-back changes do not invalidate');

// Empty isolated cache keys make race/cleanup tests cheap, independent of corpus size.
const fixture='qa-cache-'+crypto.randomUUID();
const first=await loadServingSnapshot(query,fixture);
assert.deepEqual(first.groups,[]);
for(let i=0;i<3;i++) {
  await query('UPDATE draft_run_puzzle_ratings SET rating=rating WHERE false');
  assert.notEqual((await loadServingSnapshot(query,fixture)).id,first.id);
}
assert.equal(Number((await query('SELECT count(*) n FROM draft_run_serving_snapshots WHERE corpus_version=$1',[fixture])).rows[0].n),2);
// A held builder lock causes a fast miss rather than another expensive rebuild.
let lockStarted=false;
const holding=query('WITH held AS MATERIALIZED (SELECT pg_advisory_xact_lock(516,1)) SELECT pg_sleep(3) FROM held');
for(let i=0;i<30&&!lockStarted;i++) {
  lockStarted=(await query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=516 AND objid=1 AND granted) held")).rows[0].held==='t';
}
assert.ok(lockStarted);
await assert.rejects(loadServingSnapshot(query,fixture+'-locked'),e=>e.status===503);
await holding;
await query('DELETE FROM draft_run_serving_snapshots WHERE corpus_version=$1',[fixture]);
console.log('PASS: serving cache parity, warm reuse, all input invalidations, transaction rollback, bounded generations and single-builder contention.');
