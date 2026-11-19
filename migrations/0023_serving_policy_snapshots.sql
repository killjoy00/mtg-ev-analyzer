-- Record which policy generated fixed decisions without changing IDs or scores.
ALTER TABLE draft_run_schedules ADD COLUMN IF NOT EXISTS serving_policy_version text NOT NULL DEFAULT 'legacy-interesting-v1';
ALTER TABLE draft_run_sessions ADD COLUMN IF NOT EXISTS serving_policy_version text NOT NULL DEFAULT 'legacy-interesting-v1';
