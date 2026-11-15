-- #1272: The administrative Trends report counts completed sessions only.
-- Restrict its recent time-range scan to a narrow index, rather than reading
-- wide JSONB answers/puzzle columns for every unfinished or historical run.
-- Completion retains its original strict JSONB length equality; practice and
-- fixed Daily completions are both included, excluding measurement QA.
--
-- Isolated production-derived branch (2026-11-15): this index was 640 KiB.
-- Real original Trends SQL and completed-only rewrite produced identical
-- output for two separate report dates. Diagnostic full query ~11.9s before
-- vs ~0.27s afterward (different cache states; not a production p95 claim).
-- Do not replace existing peer/daily indexes or change serving decisions.
-- Build without blocking live Draft Run writes; all release plans run this
-- outside a transaction via a separate guarded psql connection.
CREATE INDEX CONCURRENTLY IF NOT EXISTS draft_run_completed_trends_cover_idx
  ON draft_run_sessions(created_at,player_id,day)
  WHERE NOT measurement_qa
    AND jsonb_array_length(answers)=jsonb_array_length(puzzle_ids);

-- A failed concurrent build can leave a catalog entry that makes
-- IF NOT EXISTS a false positive. Fail closed on any invalid/unready index.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
    WHERE c.oid='draft_run_completed_trends_cover_idx'::regclass
      AND i.indisvalid AND i.indisready
  ) THEN
    RAISE EXCEPTION 'Completed Trends covering index is not valid';
  END IF;
END;
$$;
