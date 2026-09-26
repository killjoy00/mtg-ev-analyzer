// Only the disposable backend gate invokes this suite.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadServingSnapshot,selectCachedDatabaseRun,selectDatabaseRun,servingRevisionMatches,toPgArray} from '../worker/draft-run-selection.mjs';
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

// Stage a complete first-class snapshot for one currently Live regular set.
// The staging insert intentionally exercises the real per-row rating writer too.
const stageSet=snapshot.metadata.find(s=>s.status==='Live'&&s.regular_run&&s.set_id!=='powered-cube'&&
  Array.from({length:8},(_,i)=>i+1).every(pick=>['medium','hard'].every(band=>
    snapshot.groups.some(g=>g.set_id===s.set_id&&Number(g.pick_number)===pick&&g.band===band&&Number(g.sources)>=16))))?.set_id;
assert.ok(stageSet,'fixture requires one Live regular set with complete custom-practice coverage');
const originalSnapshot=(await query('SELECT active_snapshot_id FROM draft_run_environment_policy WHERE set_id=$1',[stageSet])).rows[0].active_snapshot_id;
const stagedSnapshot=(crypto.randomUUID().replaceAll('-','')+'0'.repeat(64)).slice(0,64);
const stagedGameHash=stagedSnapshot.split('').reverse().join('');
await query(`INSERT INTO corpus_source_snapshots(
  source_snapshot_id,set_id,event_type,corpus_version,schema_version,draft_sha256,game_sha256,
  importer_identity,model_identity,manifest,lifecycle_status
) VALUES($1,$2,'PremierDraft',$3,'premier-modern-skill-buckets-v1',$1,$4,'qa-serving-revision','qa-serving-revision','{"qa":true}','Candidate')`,
[stagedSnapshot,stageSet,version,stagedGameHash]);
const stageBefore=await revision();
await query(`INSERT INTO draft_run_verified_puzzles(
  puzzle_id,set_id,source_draft_hash,corpus_version,pick_number,candidate_count,
  consensus_top_gap,support_entropy,interesting,payload,pack_number,source_snapshot_id
)
SELECT 'qa-'||substr($1,1,8)||'-'||p.puzzle_id,p.set_id,md5($1||p.source_draft_hash),
  p.corpus_version,p.pick_number,p.candidate_count,p.consensus_top_gap,p.support_entropy,p.interesting,
  p.payload || jsonb_build_object(
    'puzzle_id','qa-'||substr($1,1,8)||'-'||p.puzzle_id,
    'source_snapshot_id',$1,
    'source_draft_hash',md5($1||p.source_draft_hash)
  ),
  p.pack_number,$1
FROM draft_run_verified_puzzles p
WHERE p.set_id=$2 AND p.corpus_version=$3 AND p.source_snapshot_id IS NULL`,
[stagedSnapshot,stageSet,version]);
assert.equal(await revision(),stageBefore,'non-active Candidate staging leaves serving revision stable');
assert.equal((await loadServingSnapshot(query,version)).id,snapshot.id,'unrelated staging does not put Practice into refresh churn');

const activationBefore=await revision();
await query('UPDATE draft_run_environment_policy SET active_snapshot_id=$2 WHERE set_id=$1',[stageSet,stagedSnapshot]);
assert.equal(await revision(),activationBefore+1n,'activating a different snapshot invalidates serving exactly once');
const activated=await loadServingSnapshot(query,version);
assert.notEqual(activated.id,snapshot.id,'activation publishes a new serving-cache generation');
const selected=await selectCachedDatabaseRun(query,version,'snapshot-activation-'+stageSet,'mixed',{setIds:[stageSet]});
assert.equal(selected.length,8);
const selectedFromSnapshot=Number((await query(
  'SELECT count(*) n FROM draft_run_verified_puzzles WHERE source_snapshot_id=$1 AND puzzle_id=ANY($2::text[])',
  [stagedSnapshot,toPgArray(selected.map(p=>p.puzzle_id))]
)).rows[0].n);
assert.equal(selectedFromSnapshot,selected.length,'live custom selection uses only the activated source snapshot');

const restoreBefore=await revision();
await query('UPDATE draft_run_environment_policy SET active_snapshot_id=$2 WHERE set_id=$1',[stageSet,originalSnapshot]);
assert.equal(await revision(),restoreBefore+1n,'restoring the prior active snapshot invalidates serving once');
const cleanupBefore=await revision();
await query('DELETE FROM draft_run_verified_puzzles WHERE source_snapshot_id=$1',[stagedSnapshot]);
assert.equal(await revision(),cleanupBefore,'deleting the now-non-serving staged snapshot does not churn Practice');
await query('DELETE FROM corpus_source_snapshots WHERE source_snapshot_id=$1',[stagedSnapshot]);

// Empty/non-serving puzzle and rating statements no longer invalidate. Small
// registries remain conservatively statement-invalidated because each can alter
// membership or metadata independently of puzzle snapshot identity.
for(const sql of [
  'UPDATE draft_run_verified_puzzles SET interesting=interesting WHERE false',
  'DELETE FROM draft_run_verified_puzzles WHERE false',
  'UPDATE draft_run_puzzle_ratings SET rating=rating WHERE false',
]) {
  const before=await revision();await query(sql);
  assert.equal(await revision(),before,sql);
}
for(const sql of [
  'DELETE FROM corpus_source_exclusions WHERE false',
  'UPDATE corpus_components SET status=status WHERE false',
  'UPDATE draft_run_environment_policy SET release_date=release_date WHERE false',
  'UPDATE corpus_set_versions SET corpus_version=corpus_version WHERE false',
  'DELETE FROM corpus_set_versions WHERE false',
]) {
  const before=await revision();await query(sql);
  assert.equal(await revision(),before+1n,sql);
}
assert.equal(await servingRevisionMatches(query,snapshot.revision),false,'old generation cannot be accepted after real serving changes');
const before=await revision();
await query("UPDATE draft_run_verified_puzzles SET payload=payload WHERE false");
assert.equal(await revision(),before,'display payload maintenance does not invalidate eligibility');

// Empty isolated cache keys make race/cleanup tests cheap, independent of corpus size.
const fixture='qa-cache-'+crypto.randomUUID();
const first=await loadServingSnapshot(query,fixture);
assert.deepEqual(first.groups,[]);
for(let i=0;i<3;i++) {
  await query('UPDATE draft_run_environment_policy SET release_date=release_date WHERE false');
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
console.log('PASS: serving cache parity, non-serving snapshot staging isolation, activation invalidation, live snapshot selection, bounded generations and single-builder contention.');
