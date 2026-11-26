-- Fixed 25-day guide scheduling: approval rows no longer require an invented
-- future set/date. Preserve all existing plans, drafts, and publication receipts.
ALTER TABLE patreon_midseason_plans
 ALTER COLUMN next_set_id DROP NOT NULL,
 ALTER COLUMN next_start DROP NOT NULL;
ALTER TABLE patreon_midseason_plans DROP CONSTRAINT IF EXISTS patreon_midseason_schedule_pair;
ALTER TABLE patreon_midseason_plans ADD CONSTRAINT patreon_midseason_schedule_pair
 CHECK ((next_set_id IS NULL) = (next_start IS NULL));
