import assert from 'node:assert/strict';
import {corpusDatabase} from '../scripts/neon-corpus-db.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {gameDateKey} from '../game-date.mjs';
import {loadServingSnapshot,customSetsFromSnapshot} from '../worker/draft-run-selection.mjs';
import {runActivatedSnapshotSmoke,runRecentActivationSmokes} from '../scripts/activated-snapshot-smoke.mjs';

const connectionFile=process.argv[2];
if(!connectionFile||!process.argv.includes('--dev-fixtures'))
 throw Error('Usage: node tests/activated-snapshot-backend-smoke.mjs CONNECTION_FILE --dev-fixtures');
const query=corpusDatabase(connectionFile);
const day=gameDateKey();

// The newest Live set offered for single-set practice exercises the cache,
// practice, reroll and (when it is the newest release) Daily/Latest paths.
const eligible=customSetsFromSnapshot(await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION),day);
assert.ok(eligible.length>0,'Expected at least one Live set offered for single-set practice.');
const setId=eligible[0].set_id;
const result=await runActivatedSnapshotSmoke(query,{setId,day,log:()=>{}});
assert.equal(result.checks.practice.puzzles.length,8);
assert.ok(result.checks.reroll.replacement);

await assert.rejects(runActivatedSnapshotSmoke(query,{setId:'qa-missing-environment',day,log:()=>{}}),/has no serving environment/);
await assert.rejects(runActivatedSnapshotSmoke(query,{setId,snapshotId:'0'.repeat(64),day,log:()=>{}}),/not the expected/);
// The scheduled mode finds an activation from its Live status event alone.
const event=(await query(`INSERT INTO corpus_status_events(set_id,old_status,new_status,reason)
 VALUES($1,'Live','Live','QA activation smoke') RETURNING id`,[setId])).rows[0].id;
try {
 const recent=await runRecentActivationSmokes(query,{hours:1,day,log:()=>{}});
 assert.ok(recent.some(r=>r.set_id===setId),'recent activation smoke must include the activated environment');
} finally {
 await query('DELETE FROM corpus_status_events WHERE id=$1::bigint',[event]);
}
console.log(JSON.stringify({smoke:'activated_snapshot_backend',set:setId,active_snapshot_id:result.active_snapshot_id,daily:result.checks.daily}));
