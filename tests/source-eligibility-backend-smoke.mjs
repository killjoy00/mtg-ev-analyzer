import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DRAFT_RUN_CORPUS_VERSION as version} from '../draft-run.mjs';
import {selectDatabaseRun,loadPuzzleMetadata} from '../worker/draft-run-selection.mjs';
if(!process.argv.includes('--dev-fixtures'))throw Error('Isolated development branch required.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query}=await import('../worker/growth-function.js');
const seed='qa-source-eligibility',before=await selectDatabaseRun(query,version,seed,'mixed');
const chosen=before[0];
const existing=(await query('SELECT 1 FROM corpus_source_exclusions WHERE set_id=$1 AND corpus_version=$2 AND source_draft_hash=$3',[chosen.set_id,version,chosen.source_draft_hash])).rows;
assert.equal(existing.length,0);
try {
 const original=(await query('SELECT payload FROM draft_run_verified_puzzles WHERE puzzle_id=$1',[chosen.puzzle_id])).rows[0].payload;
 await query("INSERT INTO corpus_source_exclusions(set_id,corpus_version,source_draft_hash,reason,evidence) VALUES($1,$2,$3,'qa-fixture','{}')",[chosen.set_id,version,chosen.source_draft_hash]);
 const after=await selectDatabaseRun(query,version,seed,'mixed');
 assert.equal(after.length,8);assert.ok(after.every(p=>p.source_draft_hash!==chosen.source_draft_hash));
 const historical=await loadPuzzleMetadata(query,version,before.map(p=>p.puzzle_id));
 assert.deepEqual(historical.map(p=>p.puzzle_id),before.map(p=>p.puzzle_id),'Existing/shared IDs remain resolvable');
 assert.deepEqual((await query('SELECT payload FROM draft_run_verified_puzzles WHERE puzzle_id=$1',[chosen.puzzle_id])).rows[0].payload,original,'Stored model evidence is immutable');
 console.log('PASS: failed source excluded from new generation while historical IDs and scoring evidence remain intact.');
} finally {
 await query("DELETE FROM corpus_source_exclusions WHERE set_id=$1 AND corpus_version=$2 AND source_draft_hash=$3 AND reason='qa-fixture'",[chosen.set_id,version,chosen.source_draft_hash]);
}
