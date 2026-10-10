-- Only fixed Daily runs are eligible for post-lock peer comparisons.
-- The existing player/day index cannot efficiently locate all daily rows.
CREATE INDEX IF NOT EXISTS draft_run_sessions_peer_stats_idx
  ON draft_run_sessions(day,environment) WHERE day IS NOT NULL;
