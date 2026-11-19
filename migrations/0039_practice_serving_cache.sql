-- Derived serving data only. Puzzle payloads, schedules and scores are unchanged.
CREATE TABLE IF NOT EXISTS draft_run_serving_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  revision bigint NOT NULL DEFAULT 1
);
INSERT INTO draft_run_serving_revision(singleton) VALUES(true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION pack1_invalidate_serving_inputs()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A bulk puzzle INSERT also invokes the existing per-row rating writer.
  -- Bump once per transaction, not once per generated rating. This transaction-
  -- local marker and the row update both roll back with a failed subtransaction.
  IF current_setting('pack1.serving_input_xid',true)=pg_current_xact_id()::text THEN RETURN NULL; END IF;
  UPDATE draft_run_serving_revision SET revision=revision+1 WHERE singleton;
  PERFORM set_config('pack1.serving_input_xid',pg_current_xact_id()::text,true);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER serving_puzzle_rows AFTER INSERT OR DELETE OR TRUNCATE ON draft_run_verified_puzzles
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_serving_inputs();
CREATE OR REPLACE TRIGGER serving_puzzle_metadata AFTER UPDATE OF puzzle_id,set_id,corpus_version,source_draft_hash,interesting,pack_number,pick_number,candidate_count,consensus_top_gap,support_entropy ON draft_run_verified_puzzles
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_serving_inputs();
CREATE OR REPLACE TRIGGER serving_ratings AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON draft_run_puzzle_ratings
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_serving_inputs();
CREATE OR REPLACE TRIGGER serving_exclusions AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON corpus_source_exclusions
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_serving_inputs();
CREATE OR REPLACE TRIGGER serving_components AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON corpus_components
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_serving_inputs();
CREATE OR REPLACE TRIGGER serving_policy AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON draft_run_environment_policy
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_serving_inputs();
CREATE OR REPLACE TRIGGER serving_version_rows AFTER INSERT OR DELETE OR TRUNCATE ON corpus_set_versions
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_serving_inputs();
CREATE OR REPLACE TRIGGER serving_version_identity AFTER UPDATE OF corpus_version,set_id ON corpus_set_versions
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_serving_inputs();

CREATE TABLE IF NOT EXISTS draft_run_serving_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  corpus_version text NOT NULL,
  difficulty_version text NOT NULL,
  serving_policy_version text NOT NULL,
  cache_schema text NOT NULL,
  revision bigint NOT NULL,
  metadata jsonb NOT NULL DEFAULT '[]',
  groups jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(corpus_version,difficulty_version,serving_policy_version,cache_schema,revision)
);
CREATE TABLE IF NOT EXISTS draft_run_serving_inventory (
  snapshot_id bigint NOT NULL REFERENCES draft_run_serving_snapshots(id) ON DELETE CASCADE,
  puzzle_id text COLLATE "C" NOT NULL,
  set_id text NOT NULL,
  pick_number smallint NOT NULL,
  band text NOT NULL,
  source_draft_hash text NOT NULL,
  PRIMARY KEY(snapshot_id,puzzle_id)
);
CREATE INDEX IF NOT EXISTS draft_run_inventory_draw_idx
ON draft_run_serving_inventory(snapshot_id,set_id,band,puzzle_id COLLATE "C")
INCLUDE(pick_number,source_draft_hash);

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
