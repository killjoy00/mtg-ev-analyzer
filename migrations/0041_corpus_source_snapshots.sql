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
CREATE TABLE IF NOT EXISTS corpus_source_snapshot_trajectories (
  source_snapshot_id text NOT NULL REFERENCES corpus_source_snapshots(source_snapshot_id),
  source_draft_hash text NOT NULL,
  event_type text NOT NULL CHECK(event_type='PremierDraft'),
  wins smallint NOT NULL,
  losses smallint,
  qualified boolean NOT NULL,
  included boolean NOT NULL,
  puzzle_count integer NOT NULL DEFAULT 0,
  exclusion_reason text,
  PRIMARY KEY(source_snapshot_id,source_draft_hash)
);
ALTER TABLE draft_run_environment_policy
  ADD COLUMN IF NOT EXISTS active_snapshot_id text REFERENCES corpus_source_snapshots(source_snapshot_id);
ALTER TABLE corpus_status_events
  ADD COLUMN IF NOT EXISTS source_snapshot_id text REFERENCES corpus_source_snapshots(source_snapshot_id),
  ADD COLUMN IF NOT EXISTS previous_source_snapshot_id text REFERENCES corpus_source_snapshots(source_snapshot_id);

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
CREATE INDEX IF NOT EXISTS corpus_snapshot_trajectory_source_idx
  ON corpus_source_snapshot_trajectories(source_snapshot_id,source_draft_hash);

-- Keep revision-keyed practice cache construction on the active Premier snapshot.
CREATE OR REPLACE FUNCTION pack1_serving_snapshot(p_parent_version text,p_difficulty text,p_policy_version text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  input_revision bigint;
  final_revision bigint;
  snapshot draft_run_serving_snapshots%ROWTYPE;
BEGIN
  IF p_difficulty<>'support-ratio-v1' OR p_policy_version<>'trophy-implied-score-20-v1' THEN
    RAISE EXCEPTION 'Unsupported serving cache policy';
  END IF;
  SELECT revision INTO input_revision FROM draft_run_serving_revision WHERE singleton;
  SELECT * INTO snapshot FROM draft_run_serving_snapshots s
    WHERE s.corpus_version=p_parent_version AND s.difficulty_version=p_difficulty
      AND s.serving_policy_version=p_policy_version AND s.cache_schema='serving-cache-v1' AND s.revision=input_revision;
  IF NOT FOUND THEN
    -- No waiting herd of expensive aggregate queries. Other starts can retry
    -- briefly, then return a documented retryable 503 while a rebuild is active.
    IF NOT pg_try_advisory_xact_lock(516,1) THEN RETURN NULL; END IF;
    -- Fresh snapshots are intentional: recheck after winning the builder lock.
    SELECT revision INTO input_revision FROM draft_run_serving_revision WHERE singleton;
    SELECT * INTO snapshot FROM draft_run_serving_snapshots s
      WHERE s.corpus_version=p_parent_version AND s.difficulty_version=p_difficulty
        AND s.serving_policy_version=p_policy_version AND s.cache_schema='serving-cache-v1' AND s.revision=input_revision;
    IF NOT FOUND THEN
      INSERT INTO draft_run_serving_snapshots(corpus_version,difficulty_version,serving_policy_version,cache_schema,revision)
        VALUES(p_parent_version,p_difficulty,p_policy_version,'serving-cache-v1',input_revision) RETURNING * INTO snapshot;
      INSERT INTO draft_run_serving_inventory(snapshot_id,puzzle_id,set_id,pick_number,band,source_draft_hash)
      SELECT snapshot.id,p.puzzle_id,p.set_id,p.pick_number,r.band,p.source_draft_hash
      FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version=p_difficulty
      WHERE p.interesting AND p.pack_number=1 AND r.target_support_ratio>=0.20526315789473684::float8
        AND (p.corpus_version<>p_parent_version OR EXISTS(
          SELECT 1 FROM draft_run_environment_policy e
          WHERE e.set_id=p.set_id AND e.status='Live'
            AND (e.active_snapshot_id IS NULL OR e.active_snapshot_id=p.source_snapshot_id)
        ))
        AND p.corpus_version IN (SELECT p_parent_version UNION SELECT c.component_version FROM corpus_components c WHERE c.parent_version=p_parent_version AND c.status='Live')
        AND (p.corpus_version=p_parent_version OR EXISTS(SELECT 1 FROM corpus_components c WHERE c.parent_version=p_parent_version AND c.component_version=p.corpus_version AND c.set_id=p.set_id AND c.status='Live'))
        AND NOT EXISTS(SELECT 1 FROM corpus_source_exclusions x WHERE x.set_id=p.set_id AND x.corpus_version=p.corpus_version AND x.source_draft_hash=p.source_draft_hash);
      SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.set_id,g.pick_number,g.band),'[]') INTO snapshot.groups
      FROM (SELECT set_id,pick_number,band,count(*)::int n,count(DISTINCT source_draft_hash)::int sources
        FROM draft_run_serving_inventory WHERE snapshot_id=snapshot.id GROUP BY set_id,pick_number,band) g;
      SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.set_id),'[]') INTO snapshot.metadata
      FROM (SELECT p.set_id,p.release_date::text,p.status,p.regular_run,p.set_name
        FROM draft_run_environment_policy p JOIN corpus_set_versions v ON v.set_id=p.set_id
        WHERE v.corpus_version=p_parent_version AND p.status='Live') m;
      SELECT revision INTO final_revision FROM draft_run_serving_revision WHERE singleton;
      IF final_revision<>input_revision THEN
        -- Roll back the entire partial build. Never publish mixed-revision data.
        RAISE EXCEPTION 'Serving inputs changed during rebuild' USING ERRCODE='40001';
      END IF;
      UPDATE draft_run_serving_snapshots SET metadata=snapshot.metadata,groups=snapshot.groups WHERE id=snapshot.id;
      -- Bound retained inventory to the newest two snapshots for this cache key.
      -- A superseded in-flight selection must fail its final revision check.
      DELETE FROM draft_run_serving_snapshots s WHERE s.corpus_version=p_parent_version
        AND s.difficulty_version=p_difficulty AND s.serving_policy_version=p_policy_version AND s.cache_schema='serving-cache-v1'
        AND s.id NOT IN (SELECT id FROM draft_run_serving_snapshots k WHERE k.corpus_version=p_parent_version
          AND k.difficulty_version=p_difficulty AND k.serving_policy_version=p_policy_version AND k.cache_schema='serving-cache-v1' ORDER BY id DESC LIMIT 2);
    END IF;
  END IF;
  RETURN jsonb_build_object('id',snapshot.id::text,'revision',snapshot.revision::text,'metadata',snapshot.metadata,'groups',snapshot.groups);
END;
$$;
