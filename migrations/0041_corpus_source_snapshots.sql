-- First-class immutable Premier source snapshots.
-- Historical puzzle IDs and payloads are preserved; only new imports receive snapshot identity.

ALTER TABLE corpus_sources
  ADD COLUMN IF NOT EXISTS game_archive_url text,
  ADD COLUMN IF NOT EXISTS game_archive_available boolean,
  ADD COLUMN IF NOT EXISTS game_archive_etag text,
  ADD COLUMN IF NOT EXISTS game_archive_last_modified text;

CREATE TABLE IF NOT EXISTS corpus_source_snapshots (
  source_snapshot_id text PRIMARY KEY,
  set_id text NOT NULL,
  event_type text NOT NULL CHECK(event_type='PremierDraft'),
  corpus_version text NOT NULL,
  schema_version text NOT NULL,
  draft_sha256 text,
  game_sha256 text,
  draft_etag text,
  game_etag text,
  draft_last_modified text,
  game_last_modified text,
  importer_identity text NOT NULL,
  model_identity text NOT NULL,
  manifest jsonb NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'Blocked'
    CHECK(lifecycle_status IN ('Blocked','Candidate','Approved','Superseded','Retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  superseded_by text REFERENCES corpus_source_snapshots(source_snapshot_id),
  UNIQUE(set_id,event_type,corpus_version,draft_sha256,game_sha256,importer_identity,model_identity)
);

CREATE INDEX IF NOT EXISTS corpus_source_snapshots_set_status_idx
  ON corpus_source_snapshots(set_id,corpus_version,lifecycle_status,created_at DESC);

ALTER TABLE draft_run_verified_puzzles
  ADD COLUMN IF NOT EXISTS source_snapshot_id text REFERENCES corpus_source_snapshots(source_snapshot_id);
ALTER TABLE corpus_health_checks
  ADD COLUMN IF NOT EXISTS source_snapshot_id text REFERENCES corpus_source_snapshots(source_snapshot_id);
ALTER TABLE corpus_trophy_trajectories
  ADD COLUMN IF NOT EXISTS source_snapshot_id text REFERENCES corpus_source_snapshots(source_snapshot_id);
ALTER TABLE draft_run_environment_policy
  ADD COLUMN IF NOT EXISTS active_snapshot_id text REFERENCES corpus_source_snapshots(source_snapshot_id);

-- Freeze one synthesized identity around every historical set/version. These rows
-- describe retained history only; they do not recalculate any existing puzzle ID.
INSERT INTO corpus_source_snapshots(
  source_snapshot_id,set_id,event_type,corpus_version,schema_version,
  importer_identity,model_identity,manifest,lifecycle_status
)
SELECT
  'historical-' || substr(encode(sha256(convert_to(v.set_id || '|' || v.corpus_version,'UTF8')),'hex'),1,32),
  v.set_id,'PremierDraft',v.corpus_version,'historical-frozen',
  'historical-frozen','historical-frozen',v.manifest,
  CASE
    WHEN p.status='Live' THEN 'Approved'
    WHEN p.status='Retired' THEN 'Retired'
    WHEN p.status='Candidate' THEN 'Candidate'
    ELSE 'Blocked'
  END
FROM corpus_set_versions v
LEFT JOIN draft_run_environment_policy p USING(set_id)
ON CONFLICT(source_snapshot_id) DO NOTHING;

UPDATE draft_run_verified_puzzles p
SET source_snapshot_id='historical-' || substr(encode(sha256(convert_to(p.set_id || '|' || p.corpus_version,'UTF8')),'hex'),1,32)
WHERE source_snapshot_id IS NULL
  AND EXISTS (
    SELECT 1 FROM corpus_source_snapshots s
    WHERE s.source_snapshot_id='historical-' || substr(encode(sha256(convert_to(p.set_id || '|' || p.corpus_version,'UTF8')),'hex'),1,32)
  );

UPDATE corpus_health_checks h
SET source_snapshot_id='historical-' || substr(encode(sha256(convert_to(h.set_id || '|' || h.corpus_version,'UTF8')),'hex'),1,32)
WHERE source_snapshot_id IS NULL
  AND EXISTS (
    SELECT 1 FROM corpus_source_snapshots s
    WHERE s.source_snapshot_id='historical-' || substr(encode(sha256(convert_to(h.set_id || '|' || h.corpus_version,'UTF8')),'hex'),1,32)
  );

UPDATE corpus_trophy_trajectories t
SET source_snapshot_id='historical-' || substr(encode(sha256(convert_to(t.set_id || '|' || t.corpus_version,'UTF8')),'hex'),1,32)
WHERE source_snapshot_id IS NULL
  AND EXISTS (
    SELECT 1 FROM corpus_source_snapshots s
    WHERE s.source_snapshot_id='historical-' || substr(encode(sha256(convert_to(t.set_id || '|' || t.corpus_version,'UTF8')),'hex'),1,32)
  );

UPDATE draft_run_environment_policy p
SET active_snapshot_id=s.source_snapshot_id
FROM draft_run_verified_sets v
JOIN corpus_source_snapshots s
  ON s.set_id=v.set_id AND s.corpus_version=v.corpus_version
WHERE p.set_id=v.set_id
  AND p.active_snapshot_id IS NULL
  AND s.source_snapshot_id='historical-' || substr(encode(sha256(convert_to(v.set_id || '|' || v.corpus_version,'UTF8')),'hex'),1,32);

CREATE INDEX IF NOT EXISTS draft_run_verified_puzzles_snapshot_idx
  ON draft_run_verified_puzzles(source_snapshot_id,puzzle_id);
CREATE INDEX IF NOT EXISTS corpus_health_snapshot_latest_idx
  ON corpus_health_checks(source_snapshot_id,checked_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS corpus_trophy_snapshot_idx
  ON corpus_trophy_trajectories(source_snapshot_id,source_draft_hash);
