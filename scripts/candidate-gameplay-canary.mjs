import assert from 'node:assert/strict';
import {corpusDatabase} from './neon-corpus-db.mjs';
import {DRAFT_RUN_CORPUS_VERSION,gradeDraftRunPick,runPickWindows,validateDraftRunPuzzle} from '../draft-run.mjs';
import {SERVING_QUALITY_SQL} from '../serving-quality.mjs';

const query=corpusDatabase(process.argv[2]);
const snapshots=(await query(`SELECT s.source_snapshot_id,s.set_id
 FROM corpus_source_snapshots s
 JOIN LATERAL (
   SELECT * FROM corpus_health_checks h
   WHERE h.source_snapshot_id=s.source_snapshot_id
   ORDER BY checked_at DESC,id DESC LIMIT 1
 ) h ON true
 WHERE s.corpus_version=$1 AND s.lifecycle_status='Candidate'
   AND h.ready AND h.manifest_hash=md5(s.manifest::text)
   AND h.checked_at>now()-interval '7 days'
 ORDER BY s.set_id,s.created_at DESC`,[DRAFT_RUN_CORPUS_VERSION])).rows;

for(const snapshot of snapshots) {
  const windows=runPickWindows(snapshot.set_id==='powered-cube'?'powered-cube':'mixed');
  const picks=[...new Set(windows.map(window=>Number(window[0])))];
  const rows=(await query(`SELECT DISTINCT ON (p.pick_number) p.pick_number,p.payload
    FROM draft_run_verified_puzzles p
    JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
    WHERE p.source_snapshot_id=$1 AND p.interesting
      AND ${SERVING_QUALITY_SQL}
      AND p.pick_number=ANY($2::smallint[])
      AND NOT EXISTS (
        SELECT 1 FROM corpus_source_exclusions x
        WHERE x.set_id=p.set_id AND x.corpus_version=p.corpus_version
          AND x.source_draft_hash=p.source_draft_hash
      )
    ORDER BY p.pick_number,p.puzzle_id`,[snapshot.source_snapshot_id,picks])).rows;
  assert.equal(rows.length,picks.length,`${snapshot.set_id}: Candidate canary lacks complete pick coverage`);
  assert.deepEqual(rows.map(row=>Number(row.pick_number)),picks,`${snapshot.set_id}: Candidate canary pick window changed`);
  for(const row of rows) {
    const puzzle=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
    assert.equal(puzzle.source_snapshot_id,snapshot.source_snapshot_id,`${snapshot.set_id}: snapshot provenance mismatch`);
    assert.equal(validateDraftRunPuzzle(puzzle),true,`${snapshot.set_id}: invalid Candidate puzzle`);
    const grade=gradeDraftRunPick(puzzle,puzzle.historical_pick_id);
    assert.equal(grade.score,100,`${snapshot.set_id}: trophy pick no longer grades to 100`);
  }
  console.log(JSON.stringify({set:snapshot.set_id,source_snapshot_id:snapshot.source_snapshot_id,picks,canary:'pass'}));
}
if(!snapshots.length)console.log(JSON.stringify({canary:'no_candidate_snapshots'}));
