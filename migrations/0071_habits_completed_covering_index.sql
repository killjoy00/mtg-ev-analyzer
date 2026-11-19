-- #1272: Exclude wide JSONB answer/puzzle payloads from the Habits
-- completed-session scan. This index only contains completed, non-QA Daily
-- sessions and covers the identity/day/created_at columns needed by that
-- report. Daily completion still means JSONB array lengths are equal.
--
-- Measured on an isolated production-derived Neon branch (2026-11-15):
-- 11,674 eligible rows, ~584 KiB index; the wide heap scan was ~17.3 s on
-- the production read-only EXPLAIN ANALYZE and the indexed scan ~6 ms on a
-- separate branch. Full report was ~8.2 s on the branch, vs ~25 s before.
-- These are diagnostic samples, NOT a controlled production SLO guarantee.
--
-- Run outside a transaction, as all existing concurrent-index migrations do.
-- Keep the existing player/day and peer-statistics indexes for gameplay.
CREATE INDEX CONCURRENTLY IF NOT EXISTS draft_run_habits_completed_cover_idx
  ON draft_run_sessions(player_id,day,created_at)
  WHERE day IS NOT NULL AND NOT measurement_qa
    AND jsonb_array_length(answers)=jsonb_array_length(puzzle_ids);

-- A failed prior concurrent build may leave an invalid index with this name.
-- IF NOT EXISTS would otherwise silently skip it on a future release.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid=i.indexrelid
    WHERE c.oid='draft_run_habits_completed_cover_idx'::regclass
      AND i.indisvalid AND i.indisready
  ) THEN
    RAISE EXCEPTION 'Habits completed-session covering index is not valid';
  END IF;
END;
$$;
