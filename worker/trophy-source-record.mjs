// Served Premier puzzle payloads keep the trophy's seven wins but not its
// losses. The verified source ledgers do, keyed by set and source draft:
// immutable source snapshots for current imports and the frozen per-version
// ledger for older corpora (whose rows have null source_snapshot_id). A source
// draft can appear in several snapshots and versions, so every row that
// records losses must show a 7-win trophy with 0-2 losses and the same count.
// Anything else returns null and the record is omitted, never guessed.
// Every lookup is an index probe bounded by the set's few snapshots/versions.
export const TROPHY_SOURCE_LOSSES_SQL=`SELECT CASE WHEN count(*)>0
    AND bool_and(ledger.wins=7 AND ledger.losses BETWEEN 0 AND 2)
    AND count(DISTINCT ledger.losses)=1 THEN min(ledger.losses) END AS losses
  FROM draft_run_verified_puzzles p,
  LATERAL (
    SELECT t.wins,t.losses FROM corpus_source_snapshots s
    JOIN corpus_source_snapshot_trajectories t
      ON t.source_snapshot_id=s.source_snapshot_id AND t.source_draft_hash=p.source_draft_hash
    WHERE s.set_id=p.set_id AND t.losses IS NOT NULL
    UNION ALL
    SELECT l.wins,l.losses FROM corpus_set_versions v
    JOIN corpus_trophy_trajectories l
      ON l.set_id=v.set_id AND l.corpus_version=v.corpus_version AND l.source_draft_hash=p.source_draft_hash
    WHERE v.set_id=p.set_id AND l.event_type='PremierDraft' AND l.losses IS NOT NULL
  ) ledger
  WHERE p.puzzle_id=$1`;

// Background only: a failed lookup must never block grading a pick.
export async function trophySourceLosses(query,puzzleId) {
  try {
    const result=await query(TROPHY_SOURCE_LOSSES_SQL,[puzzleId]);
    const losses=result.rows[0]?.losses;
    return losses==null?null:Number(losses);
  } catch(error) {
    console.error('Trophy source record lookup failed',error?.message);
    return null;
  }
}
