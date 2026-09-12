-- Run AFTER the new backend is active. Preserve any submitted answers and
-- competitive results. Only unplayed schedules/sessions can be replaced.
-- The table lock prevents a pick from racing this one-time cutover.
LOCK TABLE draft_run_sessions IN SHARE ROW EXCLUSIVE MODE;
-- statement
DELETE FROM draft_run_sessions s
WHERE s.day=(now() AT TIME ZONE 'America/New_York')::date
  AND s.selection_version='balanced-v1' AND jsonb_array_length(s.answers)=0
  AND NOT EXISTS(SELECT 1 FROM draft_run_sessions a WHERE a.day=s.day AND a.environment=s.environment AND jsonb_array_length(a.answers)>0);
-- statement
DELETE FROM draft_run_schedules s
WHERE s.day=(now() AT TIME ZONE 'America/New_York')::date AND s.selection_version='balanced-v1'
  AND NOT EXISTS(SELECT 1 FROM draft_run_sessions a WHERE a.day=s.day AND a.environment=s.environment);
