-- Exclude failed source trajectories only from newly generated decisions.
-- Do not edit puzzle payloads, ratings, history or already-created schedules.
CREATE TABLE IF NOT EXISTS corpus_source_exclusions (
 set_id text NOT NULL,
 corpus_version text NOT NULL,
 source_draft_hash text NOT NULL CHECK(source_draft_hash ~ '^[a-f0-9]{32}$'),
 reason text NOT NULL,
 evidence jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(set_id,corpus_version,source_draft_hash),
 FOREIGN KEY(set_id,corpus_version) REFERENCES corpus_set_versions(set_id,corpus_version)
);
