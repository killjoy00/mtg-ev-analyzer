-- Preserve the currently deployed parent corpus during a cross-version pointer cutover.
-- The active pointer is environment-wide while workers request an explicit parent
-- corpus version. If a newer parent snapshot is activated before the new worker is
-- deployed, keep the older historical-frozen parent readable. Same-version pointer
-- changes remain exact and fail closed; this fallback applies only across corpus
-- versions and only to immutable historical-frozen parent rows.
--
-- Migration 0043 wraps this builder with the readiness gate. Replace only the
-- underlying builder so registered readiness behavior stays unchanged.
CREATE OR REPLACE FUNCTION pack1_build_serving_snapshot(p_parent_version text,p_difficulty text,p_policy_version text)
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
            AND (
              e.active_snapshot_id IS NULL OR e.active_snapshot_id=p.source_snapshot_id
              OR (p.source_snapshot_id IS NULL AND EXISTS(
                SELECT 1 FROM corpus_source_snapshots hs
                WHERE hs.source_snapshot_id=e.active_snapshot_id AND hs.schema_version='historical-frozen'
              ))
              OR (p.source_snapshot_id IS NULL
                AND EXISTS(
                  SELECT 1 FROM corpus_source_snapshots historical
                  WHERE historical.set_id=p.set_id AND historical.corpus_version=p.corpus_version
                    AND historical.schema_version='historical-frozen'
                )
                AND EXISTS(
                  SELECT 1 FROM corpus_source_snapshots next_snapshot
                  WHERE next_snapshot.source_snapshot_id=e.active_snapshot_id
                    AND next_snapshot.corpus_version<>p.corpus_version
                ))
            )
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


-- Staging a non-serving future corpus must not churn the currently registered
-- serving release. A version row can affect serving only after that parent has a
-- registered readiness key or a retained serving cache generation.
CREATE OR REPLACE FUNCTION pack1_version_can_affect_serving(p_version text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM draft_run_readiness_keys WHERE corpus_version=p_version)
    OR EXISTS(SELECT 1 FROM draft_run_serving_snapshots WHERE corpus_version=p_version);
$$;

-- Puzzle/rating staging follows the same parent-version rule. The v9 checked-in
-- baseline intentionally has NULL source_snapshot_id, so snapshot-awareness
-- alone is insufficient: before v9 has a readiness key/cache, those rows are
-- retained future data and cannot invalidate the serving v8 generation.
CREATE OR REPLACE FUNCTION pack1_puzzle_can_affect_serving(
  p_set_id text,p_corpus_version text,p_source_snapshot_id text
)
RETURNS boolean LANGUAGE sql STABLE AS $
  SELECT pack1_version_can_affect_serving(p_corpus_version) AND (
    p_source_snapshot_id IS NULL OR EXISTS(
      SELECT 1 FROM draft_run_environment_policy e
      WHERE e.set_id=p_set_id AND e.status='Live'
        AND e.active_snapshot_id=p_source_snapshot_id
    )
  );
$;

CREATE OR REPLACE FUNCTION pack1_invalidate_inserted_puzzles()
RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  IF EXISTS(
    SELECT 1 FROM new_rows p
    WHERE pack1_puzzle_can_affect_serving(p.set_id,p.corpus_version,p.source_snapshot_id)
  ) THEN
    PERFORM pack1_bump_serving_revision();
  END IF;
  RETURN NULL;
END;
$;

CREATE OR REPLACE FUNCTION pack1_invalidate_deleted_puzzles()
RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  IF EXISTS(
    SELECT 1 FROM old_rows p
    WHERE pack1_puzzle_can_affect_serving(p.set_id,p.corpus_version,p.source_snapshot_id)
  ) THEN
    PERFORM pack1_bump_serving_revision();
  END IF;
  RETURN NULL;
END;
$;

CREATE OR REPLACE FUNCTION pack1_invalidate_updated_puzzle()
RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  IF ROW(
    OLD.puzzle_id,OLD.set_id,OLD.corpus_version,OLD.source_snapshot_id,
    OLD.source_draft_hash,OLD.interesting,OLD.pack_number,OLD.pick_number,
    OLD.candidate_count,OLD.consensus_top_gap,OLD.support_entropy
  ) IS NOT DISTINCT FROM ROW(
    NEW.puzzle_id,NEW.set_id,NEW.corpus_version,NEW.source_snapshot_id,
    NEW.source_draft_hash,NEW.interesting,NEW.pack_number,NEW.pick_number,
    NEW.candidate_count,NEW.consensus_top_gap,NEW.support_entropy
  ) THEN
    RETURN NULL;
  END IF;
  IF pack1_puzzle_can_affect_serving(OLD.set_id,OLD.corpus_version,OLD.source_snapshot_id)
     OR pack1_puzzle_can_affect_serving(NEW.set_id,NEW.corpus_version,NEW.source_snapshot_id) THEN
    PERFORM pack1_bump_serving_revision();
  END IF;
  RETURN NULL;
END;
$;

CREATE OR REPLACE FUNCTION pack1_rating_can_affect_serving(p_puzzle_id text)
RETURNS boolean LANGUAGE sql STABLE AS $
  SELECT EXISTS(
    SELECT 1 FROM draft_run_verified_puzzles p
    WHERE p.puzzle_id=p_puzzle_id
      AND pack1_puzzle_can_affect_serving(p.set_id,p.corpus_version,p.source_snapshot_id)
  );
$;

CREATE OR REPLACE FUNCTION pack1_invalidate_inserted_versions()
RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  IF EXISTS(SELECT 1 FROM new_versions v WHERE pack1_version_can_affect_serving(v.corpus_version)) THEN
    PERFORM pack1_bump_serving_revision();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pack1_invalidate_deleted_versions()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM old_versions v WHERE pack1_version_can_affect_serving(v.corpus_version)) THEN
    PERFORM pack1_bump_serving_revision();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pack1_invalidate_updated_version_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.set_id,OLD.corpus_version) IS DISTINCT FROM ROW(NEW.set_id,NEW.corpus_version)
     AND (pack1_version_can_affect_serving(OLD.corpus_version)
       OR pack1_version_can_affect_serving(NEW.corpus_version)) THEN
    PERFORM pack1_bump_serving_revision();
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS serving_version_rows ON corpus_set_versions;
DROP TRIGGER IF EXISTS serving_version_insert ON corpus_set_versions;
DROP TRIGGER IF EXISTS serving_version_delete ON corpus_set_versions;
DROP TRIGGER IF EXISTS serving_version_identity ON corpus_set_versions;
CREATE TRIGGER serving_version_insert
AFTER INSERT ON corpus_set_versions REFERENCING NEW TABLE AS new_versions
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_inserted_versions();
CREATE TRIGGER serving_version_delete
AFTER DELETE ON corpus_set_versions REFERENCING OLD TABLE AS old_versions
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_deleted_versions();
CREATE TRIGGER serving_version_identity
AFTER UPDATE OF corpus_version,set_id ON corpus_set_versions
FOR EACH ROW EXECUTE FUNCTION pack1_invalidate_updated_version_identity();

-- Candidate/paused components are retained data, not serving inputs. Invalidate
-- only when the set of Live component rows changes.
CREATE OR REPLACE FUNCTION pack1_invalidate_changed_live_components()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT EXISTS(SELECT 1 FROM new_inputs WHERE status='Live') INTO changed;
  ELSIF TG_OP='DELETE' THEN
    SELECT EXISTS(SELECT 1 FROM old_inputs WHERE status='Live') INTO changed;
  ELSIF TG_OP='UPDATE' THEN
    SELECT EXISTS(
      (SELECT to_jsonb(o) FROM old_inputs o WHERE o.status='Live'
       EXCEPT SELECT to_jsonb(n) FROM new_inputs n WHERE n.status='Live')
      UNION ALL
      (SELECT to_jsonb(n) FROM new_inputs n WHERE n.status='Live'
       EXCEPT SELECT to_jsonb(o) FROM old_inputs o WHERE o.status='Live')
    ) INTO changed;
  ELSE
    RAISE EXCEPTION 'Unexpected component transition operation: %',TG_OP;
  END IF;
  IF changed THEN PERFORM pack1_bump_serving_revision(); END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS serving_components ON corpus_components;
DROP TRIGGER IF EXISTS serving_components_insert ON corpus_components;
DROP TRIGGER IF EXISTS serving_components_delete ON corpus_components;
DROP TRIGGER IF EXISTS serving_components_update ON corpus_components;
DROP TRIGGER IF EXISTS serving_components_truncate ON corpus_components;
CREATE TRIGGER serving_components_insert
AFTER INSERT ON corpus_components REFERENCING NEW TABLE AS new_inputs
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_changed_live_components();
CREATE TRIGGER serving_components_delete
AFTER DELETE ON corpus_components REFERENCING OLD TABLE AS old_inputs
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_changed_live_components();
CREATE TRIGGER serving_components_update
AFTER UPDATE ON corpus_components REFERENCING OLD TABLE AS old_inputs NEW TABLE AS new_inputs
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_changed_live_components();
CREATE TRIGGER serving_components_truncate
AFTER TRUNCATE ON corpus_components
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_serving_inputs();

-- Before carrying a verified cache across a revision, compare every compact
-- selector input and environment metadata in both directions against current
-- serving membership. This turns an otherwise global revision bump into a
-- no-op for a parent whose effective serving data truly did not change.
CREATE OR REPLACE FUNCTION pack1_serving_snapshot_matches_current(
  p_parent text,p_difficulty text,p_policy text,p_snapshot bigint
)
RETURNS boolean LANGUAGE sql STABLE AS $$
WITH expected AS MATERIALIZED (
  SELECT p.puzzle_id,p.set_id,p.pick_number,r.band,p.source_draft_hash
  FROM draft_run_verified_puzzles p
  JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version=p_difficulty
  WHERE p.interesting AND p.pack_number=1 AND r.target_support_ratio>=0.20526315789473684::float8
    AND (p.corpus_version<>p_parent OR EXISTS(
      SELECT 1 FROM draft_run_environment_policy e
      WHERE e.set_id=p.set_id AND e.status='Live'
        AND (
          e.active_snapshot_id IS NULL OR e.active_snapshot_id=p.source_snapshot_id
          OR (p.source_snapshot_id IS NULL AND EXISTS(
            SELECT 1 FROM corpus_source_snapshots hs
            WHERE hs.source_snapshot_id=e.active_snapshot_id AND hs.schema_version='historical-frozen'
          ))
          OR (p.source_snapshot_id IS NULL
            AND EXISTS(
              SELECT 1 FROM corpus_source_snapshots historical
              WHERE historical.set_id=p.set_id AND historical.corpus_version=p.corpus_version
                AND historical.schema_version='historical-frozen'
            )
            AND EXISTS(
              SELECT 1 FROM corpus_source_snapshots next_snapshot
              WHERE next_snapshot.source_snapshot_id=e.active_snapshot_id
                AND next_snapshot.corpus_version<>p.corpus_version
            ))
        )
    ))
    AND p.corpus_version IN (
      SELECT p_parent
      UNION
      SELECT c.component_version FROM corpus_components c
      WHERE c.parent_version=p_parent AND c.status='Live'
    )
    AND (p.corpus_version=p_parent OR EXISTS(
      SELECT 1 FROM corpus_components c
      WHERE c.parent_version=p_parent AND c.component_version=p.corpus_version
        AND c.set_id=p.set_id AND c.status='Live'
    ))
    AND NOT EXISTS(
      SELECT 1 FROM corpus_source_exclusions x
      WHERE x.set_id=p.set_id AND x.corpus_version=p.corpus_version
        AND x.source_draft_hash=p.source_draft_hash
    )
), actual AS MATERIALIZED (
  SELECT puzzle_id,set_id,pick_number,band,source_draft_hash
  FROM draft_run_serving_inventory WHERE snapshot_id=p_snapshot
), current_metadata AS (
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.set_id),'[]'::jsonb) value
  FROM (
    SELECT p.set_id,p.release_date::text,p.status,p.regular_run,p.set_name
    FROM draft_run_environment_policy p
    JOIN corpus_set_versions v ON v.set_id=p.set_id
    WHERE v.corpus_version=p_parent AND p.status='Live'
  ) m
), stored AS (
  SELECT metadata FROM draft_run_serving_snapshots
  WHERE id=p_snapshot AND corpus_version=p_parent
    AND difficulty_version=p_difficulty AND serving_policy_version=p_policy
    AND cache_schema='serving-cache-v1'
), delta AS (
  (SELECT * FROM expected EXCEPT SELECT * FROM actual)
  UNION ALL
  (SELECT * FROM actual EXCEPT SELECT * FROM expected)
)
SELECT EXISTS(SELECT 1 FROM stored)
  AND (SELECT value FROM current_metadata) IS NOT DISTINCT FROM (SELECT metadata FROM stored)
  AND NOT EXISTS(SELECT 1 FROM delta);
$$;

-- The readiness gate is global-revision keyed. During a cross-version cutover,
-- a v9 pointer change invalidates the revision even though the bridge makes v8
-- effective inventory byte-for-byte identical. Carry a prior ready generation
-- forward atomically only after the exact comparison above proves that the
-- registered parent's selector inputs are unchanged. Any real membership or
-- metadata change remains queued and requires the normal readiness verifier.
CREATE OR REPLACE FUNCTION pack1_enqueue_readiness(p_revision bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE carry record; inventory_count integer;
BEGIN
  INSERT INTO draft_run_readiness_jobs(key_id,revision,intent)
  SELECT k.id,p_revision,pack1_readiness_intent(k.corpus_version)
  FROM draft_run_readiness_keys k
  ON CONFLICT(key_id,revision) DO NOTHING;

  FOR carry IN
    SELECT next.id next_job_id,k.corpus_version,k.difficulty_version,k.serving_policy_version,
      prior.revision prior_revision,prior.cache_snapshot_id,prior.evidence,prior.worker_release
    FROM draft_run_readiness_jobs next
    JOIN draft_run_readiness_keys k ON k.id=next.key_id
    JOIN LATERAL (
      SELECT j.revision,j.cache_snapshot_id,j.evidence,j.worker_release
      FROM draft_run_readiness_jobs j
      JOIN draft_run_serving_snapshots s ON s.id=j.cache_snapshot_id AND s.revision=j.revision
      WHERE j.key_id=next.key_id AND j.revision<p_revision AND j.state='ready'
      ORDER BY j.revision DESC LIMIT 1
    ) prior ON true
    WHERE next.revision=p_revision AND next.state='queued'
      AND prior.evidence->>'day'=(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date::text
      AND NOT EXISTS(
        SELECT 1 FROM draft_run_serving_snapshots s
        WHERE s.corpus_version=k.corpus_version
          AND s.difficulty_version=k.difficulty_version
          AND s.serving_policy_version=k.serving_policy_version
          AND s.cache_schema='serving-cache-v1' AND s.revision=p_revision
      )
  LOOP
    IF pack1_serving_snapshot_matches_current(
      carry.corpus_version,carry.difficulty_version,carry.serving_policy_version,carry.cache_snapshot_id
    ) THEN
      UPDATE draft_run_serving_snapshots
      SET revision=p_revision
      WHERE id=carry.cache_snapshot_id AND revision=carry.prior_revision;
      IF FOUND THEN
        SELECT count(*)::integer INTO inventory_count
        FROM draft_run_serving_inventory WHERE snapshot_id=carry.cache_snapshot_id;
        UPDATE draft_run_readiness_jobs SET
          state='ready',attempts=0,lease_token=NULL,lease_expires_at=NULL,
          next_attempt_at=clock_timestamp(),updated_at=clock_timestamp(),finished_at=clock_timestamp(),
          cache_snapshot_id=carry.cache_snapshot_id,worker_release=carry.worker_release,last_error=NULL,
          evidence=jsonb_build_object(
            'revision',p_revision::text,
            'day',(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date::text,
            'cache_snapshot_id',carry.cache_snapshot_id::text,
            'inventory',jsonb_build_object('verified',true,'expected',inventory_count,'actual',inventory_count,'missing',0,'extra',0),
            'samples',jsonb_build_array(jsonb_build_object(
              'mode','exact-serving-input-carry-forward',
              'previous_revision',carry.prior_revision::text,
              'cache_snapshot_id',carry.cache_snapshot_id::text
            ))
          )
        WHERE id=carry.next_job_id AND state='queued';
      END IF;
    END IF;
  END LOOP;

  UPDATE draft_run_readiness_jobs SET state='superseded',lease_token=NULL,lease_expires_at=NULL,
    updated_at=clock_timestamp(),finished_at=coalesce(finished_at,clock_timestamp())
  WHERE revision<p_revision AND state<>'superseded';

  DELETE FROM draft_run_readiness_jobs j WHERE j.state IN ('ready','superseded')
    AND j.id IN (
      SELECT old.id FROM draft_run_readiness_jobs old
      WHERE old.key_id=j.key_id AND old.state IN ('ready','superseded')
      ORDER BY old.revision DESC OFFSET 128
    );
END;
$$;
