-- A third independent Daily; existing schedules and attempts remain unchanged.
ALTER TABLE draft_run_sessions DROP CONSTRAINT draft_run_sessions_environment_check;
ALTER TABLE draft_run_sessions ADD CONSTRAINT draft_run_sessions_environment_check CHECK(environment IN ('mixed','powered-cube','latest'));
ALTER TABLE draft_run_schedules DROP CONSTRAINT draft_run_schedules_environment_check;
ALTER TABLE draft_run_schedules ADD CONSTRAINT draft_run_schedules_environment_check CHECK(environment IN ('mixed','powered-cube','latest'));
