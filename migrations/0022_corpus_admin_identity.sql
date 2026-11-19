-- Preserve app-account audits; separately identify authenticated release automation.
ALTER TABLE corpus_status_events ADD COLUMN IF NOT EXISTS admin_identity jsonb;
