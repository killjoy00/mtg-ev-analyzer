-- Additive operational records. Never rewrite/delete puzzle payloads or play history.
CREATE TABLE IF NOT EXISTS corpus_set_versions (
 set_id text NOT NULL REFERENCES draft_run_verified_sets(set_id),
 corpus_version text NOT NULL,
 manifest jsonb NOT NULL,
 manifest_updated_at timestamptz NOT NULL DEFAULT now(),
 last_successful_import timestamptz,
 PRIMARY KEY(set_id,corpus_version)
);
INSERT INTO corpus_set_versions(set_id,corpus_version,manifest)
SELECT set_id,corpus_version,manifest FROM draft_run_verified_sets
ON CONFLICT DO NOTHING;
-- Older payloads remain usable even when their original manifest is unavailable.
INSERT INTO corpus_set_versions(set_id,corpus_version,manifest)
SELECT DISTINCT set_id,corpus_version,'{"historical_manifest_unavailable":true}'::jsonb
FROM draft_run_verified_puzzles ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION retain_corpus_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO corpus_set_versions(set_id,corpus_version,manifest,last_successful_import)
 VALUES(NEW.set_id,NEW.corpus_version,NEW.manifest,CASE WHEN NEW.manifest ? 'full_import' THEN now() END)
 ON CONFLICT(set_id,corpus_version) DO UPDATE SET
 manifest=EXCLUDED.manifest,manifest_updated_at=now(),
 last_successful_import=CASE WHEN corpus_set_versions.manifest->'full_import' IS DISTINCT FROM EXCLUDED.manifest->'full_import'
 THEN EXCLUDED.last_successful_import ELSE corpus_set_versions.last_successful_import END;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS retain_corpus_manifest ON draft_run_verified_sets;
CREATE TRIGGER retain_corpus_manifest AFTER INSERT OR UPDATE ON draft_run_verified_sets
FOR EACH ROW EXECUTE FUNCTION retain_corpus_manifest();

CREATE TABLE IF NOT EXISTS corpus_sources (
 set_id text NOT NULL,
 event_type text NOT NULL,
 set_name text,
 release_date date,
 archive_url text,
 archive_available boolean,
 archive_etag text,
 archive_last_modified text,
 last_checked_at timestamptz,
 import_status text NOT NULL DEFAULT 'discovered' CHECK(import_status IN ('discovered','fetching','building','validating','complete','failed')),
 last_error text,
 PRIMARY KEY(set_id,event_type)
);
CREATE TABLE IF NOT EXISTS corpus_health_checks (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 set_id text NOT NULL,
 corpus_version text NOT NULL,
 checked_at timestamptz NOT NULL DEFAULT now(),
 manifest_hash text NOT NULL,
 gate_version text NOT NULL,
 ready boolean NOT NULL,
 report jsonb NOT NULL,
 FOREIGN KEY(set_id,corpus_version) REFERENCES corpus_set_versions(set_id,corpus_version)
);
CREATE INDEX IF NOT EXISTS corpus_health_latest ON corpus_health_checks(set_id,corpus_version,checked_at DESC);
CREATE TABLE IF NOT EXISTS corpus_trophy_trajectories (
 set_id text NOT NULL,
 corpus_version text NOT NULL,
 source_draft_hash text NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('PremierDraft','TradDraft')),
 wins smallint NOT NULL,
 losses smallint,
 qualified boolean NOT NULL,
 included boolean NOT NULL,
 puzzle_count integer NOT NULL DEFAULT 0,
 exclusion_reason text,
 PRIMARY KEY(set_id,corpus_version,source_draft_hash),
 FOREIGN KEY(set_id,corpus_version) REFERENCES corpus_set_versions(set_id,corpus_version)
);
-- Match the existing retired-source policy without removing retained records.
UPDATE draft_run_environment_policy SET status='Retired',status_changed_at=now()
WHERE set_id='stx' AND status='Candidate';
