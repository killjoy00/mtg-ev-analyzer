-- Only fixed Daily runs are eligible for post-lock peer comparisons.
-- The existing player/day index cannot efficiently locate all daily rows.
-- Build concurrently so live Draft Run writes are not blocked by the index build.
CREATE INDEX CONCURRENTLY IF NOT EXISTS draft_run_sessions_peer_stats_idx
  ON draft_run_sessions(day,environment) WHERE day IS NOT NULL;
