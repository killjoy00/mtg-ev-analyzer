import assert from 'node:assert/strict';
import {corpusDatabase} from './neon-corpus-db.mjs';
import {
  loadServingSnapshot,
  selectCachedDatabaseRun,
  selectDatabaseRun,
  selectDatabaseReroll,
  servingRevisionMatches,
  toPgArray,
} from '../worker/draft-run-selection.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_SELECTION_VERSION} from '../draft-run-policy.mjs';
import {DAILY_SELECTION_VERSION} from '../daily-selection.mjs';
import {gameDateKey} from '../game-date.mjs';

export async function smokeActivatedSnapshot(query,{setId,sourceSnapshotId,day=gameDateKey()}={}) {
  if(!/^[a-z0-9-]{2,40}$/.test(String(setId||'')))throw Error('A valid set ID is required.');
  if(!/^[a-f0-9]{64}$/.test(String(sourceSnapshotId||'')))throw Error('A valid 64-hex source snapshot ID is required.');

  const active=(await query(`SELECT p.set_id,p.status,p.regular_run,p.release_date::text,p.active_snapshot_id,
      s.lifecycle_status,s.corpus_version,s.schema_version
    FROM draft_run_environment_policy p
    JOIN corpus_source_snapshots s ON s.source_snapshot_id=p.active_snapshot_id
    WHERE p.set_id=$1`,[setId])).rows[0];
  assert.ok(active,`${setId}: active serving policy/snapshot is absent`);
  assert.equal(active.status,'Live',`${setId}: set is not Live`);
  assert.equal(active.active_snapshot_id,sourceSnapshotId,`${setId}: expected snapshot is not active`);
  assert.equal(active.lifecycle_status,'Approved',`${setId}: active snapshot is not Approved`);
  assert.equal(active.corpus_version,DRAFT_RUN_CORPUS_VERSION,`${setId}: active snapshot uses a different corpus version`);

  const assertActiveSelection=async(selected,label,{expectedSet=null,expectedSnapshot=null}={})=>{
    assert.equal(selected.length,8,`${label}: selector did not return eight decisions`);
    const ids=selected.map(p=>p.puzzle_id);
    const provenance=(await query(`SELECT p.puzzle_id,p.set_id,p.source_snapshot_id,e.active_snapshot_id,
        EXISTS(
          SELECT 1 FROM corpus_source_snapshots hs
          WHERE hs.source_snapshot_id=e.active_snapshot_id AND hs.schema_version='historical-frozen'
        ) historical_active
      FROM draft_run_verified_puzzles p
      JOIN draft_run_environment_policy e ON e.set_id=p.set_id
      WHERE p.puzzle_id=ANY($1::text[])`,[toPgArray(ids)])).rows;
    assert.equal(provenance.length,ids.length,`${label}: selected puzzle provenance is incomplete`);
    for(const row of provenance){
      assert.equal(row.active_snapshot_id!=null,true,`${label}: ${row.set_id} has no active snapshot`);
      const activeMatch=row.source_snapshot_id===row.active_snapshot_id ||
        (row.source_snapshot_id==null && [true,'t'].includes(row.historical_active));
      assert.equal(activeMatch,true,`${label}: selected puzzle is not from its set's active snapshot`);
      if(expectedSet&&row.set_id===expectedSet&&expectedSnapshot){
        assert.equal(row.source_snapshot_id,expectedSnapshot,`${label}: ${expectedSet} did not select the expected active snapshot`);
      }
    }
    return provenance;
  };

  const cache=await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION);
  assert.equal(await servingRevisionMatches(query,cache.revision),true,'serving cache revision is already stale');

  // Custom-set practice forces every round through the newly activated set and
  // uses the revision-keyed serving cache path.
  const custom=await selectCachedDatabaseRun(
    query,DRAFT_RUN_CORPUS_VERSION,`post-activation:${sourceSnapshotId}:custom`,'mixed',{setIds:[setId]},
  );
  await assertActiveSelection(custom,'custom practice',{expectedSet:setId,expectedSnapshot:sourceSnapshotId});

  // Latest also uses the cached selector. If the activated set is the newest
  // eligible release this forces all eight rounds through it; otherwise it still
  // proves the Latest plan remains healthy after activation.
  const latest=await selectCachedDatabaseRun(
    query,DRAFT_RUN_CORPUS_VERSION,`post-activation:${sourceSnapshotId}:latest`,'latest',
  );
  const latestRows=await assertActiveSelection(latest,'Latest practice',{expectedSet:setId,expectedSnapshot:sourceSnapshotId});

  // Daily intentionally uses its schedule/planning selector rather than the
  // mutable practice cache. Exercise that production path independently.
  const daily=await selectDatabaseRun(
    query,DRAFT_RUN_CORPUS_VERSION,`post-activation:${sourceSnapshotId}:daily`,'mixed',
    {daily:true,day,selectionVersion:DAILY_SELECTION_VERSION},
  );
  const dailyRows=await assertActiveSelection(daily,'Daily planning',{expectedSet:setId,expectedSnapshot:sourceSnapshotId});

  // Rerolls use the real serving membership query. Search the started custom
  // run for a comparable pack replacement, matching real seen-source exclusion.
  let replacement=null;
  const excludedSources=custom.map(p=>p.source_draft_hash);
  for(let round=0;round<custom.length&&!replacement;round++){
    replacement=await selectDatabaseReroll(query,DRAFT_RUN_CORPUS_VERSION,custom[round],{
      type:'pack',
      round,
      seed:`post-activation:${sourceSnapshotId}:reroll`,
      excludedSources,
      environment:'mixed',
      selectionVersion:DRAFT_RUN_SELECTION_VERSION,
      setIds:[setId],
    });
  }
  assert.ok(replacement,`${setId}: no comparable real reroll is available after activation`);
  const rerollProvenance=(await query(
    'SELECT source_snapshot_id FROM draft_run_verified_puzzles WHERE puzzle_id=$1',
    [replacement.puzzle_id],
  )).rows[0];
  assert.equal(rerollProvenance?.source_snapshot_id,sourceSnapshotId,`${setId}: reroll escaped the active snapshot`);

  assert.equal(await servingRevisionMatches(query,cache.revision),true,'serving revision changed during post-activation smoke');
  const result={
    ok:true,
    set_id:setId,
    source_snapshot_id:sourceSnapshotId,
    serving_revision:String(cache.revision),
    custom_puzzles:custom.length,
    latest_sets:[...new Set(latestRows.map(r=>r.set_id))],
    daily_sets:[...new Set(dailyRows.map(r=>r.set_id))],
    reroll_puzzle_id:replacement.puzzle_id,
  };
  console.log(JSON.stringify(result));
  return result;
}

if(import.meta.url===`file://${process.argv[1]}`){
  const [, , connectionFile,setId,sourceSnapshotId]=process.argv;
  if(!connectionFile||!setId||!sourceSnapshotId){
    console.error('Usage: node scripts/post-activation-serving-smoke.mjs <connection-file> <set-id> <source-snapshot-id>');
    process.exit(2);
  }
  await smokeActivatedSnapshot(corpusDatabase(connectionFile),{setId,sourceSnapshotId});
}
