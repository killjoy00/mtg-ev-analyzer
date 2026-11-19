-- #1272: Habits acquisition attribution finds each cohort player's first
-- acquisition touch. The generic player/created index scanned unrelated
-- event types for ~3,000 cohort players on production-derived evidence.
-- Restrict to the original event name and deterministic (created_at, id)
-- ordering without changing query/attribution semantics.
--
-- Isolated production-derived branch, 2026-11-15: real Habits SQL
-- EXPLAIN ANALYZE: 5,163 ms before, 3,739 ms after (cache state differs;
-- not a production p95 comparison). No changes to player data or scoring.
-- Build outside a transaction, with the protected release migration runner.
CREATE INDEX CONCURRENTLY IF NOT EXISTS analytics_events_acquisition_first_touch_idx
  ON analytics_events(player_id,created_at,id)
  WHERE event_name='acquisition_touch' AND player_id IS NOT NULL;

-- CREATE INDEX IF NOT EXISTS can mask an invalid concurrent index. Fail closed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
    WHERE c.oid='analytics_events_acquisition_first_touch_idx'::regclass
      AND i.indisvalid AND i.indisready
  ) THEN
    RAISE EXCEPTION 'Habits first-touch index is not valid';
  END IF;
END;
$$;
