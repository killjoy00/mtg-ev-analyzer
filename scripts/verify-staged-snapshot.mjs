// A completed Candidate is closed to imports. A staging retry may only prove
// that its existing payloads and ledger equal the already-validated artifact.
export async function verifyStagedSnapshot(query, set, puzzles, ledger) {
  const guard = `EXISTS(SELECT 1 FROM corpus_source_snapshots s
    WHERE s.source_snapshot_id=$1 AND s.lifecycle_status='Candidate'
      AND NOT EXISTS(SELECT 1 FROM draft_run_environment_policy p WHERE p.active_snapshot_id=s.source_snapshot_id))`;
  let batch = [], puzzleCount = 0, ledgerCount = 0;
  const verifyPuzzles = async () => {
    if (!batch.length) return;
    const result = (await query(`SELECT count(*)::int matched
      FROM jsonb_array_elements($2::jsonb) incoming(payload)
      JOIN draft_run_verified_puzzles p ON p.puzzle_id=incoming.payload->>'puzzle_id'
      WHERE p.source_snapshot_id=$1 AND p.payload=incoming.payload
        AND p.set_id=incoming.payload->>'set_id'
        AND p.corpus_version=incoming.payload->>'corpus_version'
        AND p.source_draft_hash=incoming.payload->>'source_draft_hash'
        AND p.pick_number=(incoming.payload->>'pick_number')::smallint
        AND ${guard}`, [set.source_snapshot_id, JSON.stringify(batch)])).rows[0];
    if (Number(result?.matched) !== batch.length) throw Error(set.id + ': immutable Candidate puzzle verification failed');
    puzzleCount += batch.length; batch = [];
  };
  for await (const puzzle of puzzles) { batch.push(puzzle); if (batch.length === 250) await verifyPuzzles(); }
  await verifyPuzzles();
  const verifyLedger = async () => {
    if (!batch.length) return;
    const result = (await query(`SELECT count(*)::int matched
      FROM jsonb_to_recordset($2::jsonb) i(source_draft_hash text,event_type text,wins smallint,losses smallint,
        qualified boolean,included boolean,puzzle_count integer,exclusion_reason text)
      JOIN corpus_source_snapshot_trajectories e ON e.source_snapshot_id=$1 AND e.source_draft_hash=i.source_draft_hash
      WHERE ROW(e.event_type,e.wins,e.losses,e.qualified,e.included,e.puzzle_count,e.exclusion_reason)
        IS NOT DISTINCT FROM ROW(i.event_type,i.wins,i.losses,i.qualified,i.included,i.puzzle_count,i.exclusion_reason)
        AND ${guard}`, [set.source_snapshot_id, JSON.stringify(batch)])).rows[0];
    if (Number(result?.matched) !== batch.length) throw Error(set.id + ': immutable Candidate ledger verification failed');
    ledgerCount += batch.length; batch = [];
  };
  for await (const row of ledger) { batch.push(row); if (batch.length === 1000) await verifyLedger(); }
  await verifyLedger();
  const counts = (await query(`SELECT
    (SELECT count(*)::int FROM draft_run_verified_puzzles WHERE source_snapshot_id=$1) puzzles,
    (SELECT count(*)::int FROM corpus_source_snapshot_trajectories WHERE source_snapshot_id=$1) ledger
    WHERE ${guard}`, [set.source_snapshot_id])).rows[0];
  if (puzzleCount !== set.total_puzzles || ledgerCount !== set.source_trophies
    || Number(counts?.puzzles) !== puzzleCount || Number(counts?.ledger) !== ledgerCount) {
    throw Error(set.id + ': immutable Candidate counts differ from the artifact');
  }
  return {puzzles: puzzleCount, ledger: ledgerCount};
}
