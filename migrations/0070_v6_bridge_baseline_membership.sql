-- v6 release repair: the cross-version bridge must keep serving exactly what
-- the previous parent served. 0049 bridges NULL-snapshot baseline rows for any
-- set with a historical-frozen parent snapshot once its pointer leaves that
-- parent. That is right while the baseline is what the set served, as in v8.
-- Every v9 environment instead serves a first-class snapshot, while its
-- checked-in v9 baseline rows stay unserved beside a historical-frozen v9
-- snapshot. On v10 activation those rows joined the v9 bridge cache and carry
-- check, so the verified v9 cache no longer matched and was not carried, and
-- the runtime membership (worker/corpus-components.mjs) rejects a rebuild that
-- contains them. When the active snapshot superseded a first-class parent
-- snapshot, that snapshot alone is bridged. Builder and carry check stay equal.

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
      WITH active_parent_sets AS MATERIALIZED (
        SELECT e.set_id,e.active_snapshot_id,a.corpus_version active_corpus_version,
          a.schema_version active_schema_version,
          EXISTS(
            SELECT 1 FROM corpus_source_snapshots h
            WHERE h.set_id=e.set_id AND h.corpus_version=p_parent_version
              AND h.schema_version='historical-frozen'
          ) has_historical_parent,
          -- A first-class parent snapshot that the active one superseded is what
          -- the previous runtime served; it takes precedence over the baseline.
          EXISTS(
            SELECT 1 FROM corpus_source_snapshots f
            WHERE f.set_id=e.set_id AND f.corpus_version=p_parent_version
              AND f.schema_version<>'historical-frozen' AND f.superseded_by=e.active_snapshot_id
          ) superseded_first_class
        FROM draft_run_environment_policy e
        LEFT JOIN corpus_source_snapshots a ON a.source_snapshot_id=e.active_snapshot_id
        WHERE e.status='Live'
      ), live_components AS MATERIALIZED (
        SELECT c.set_id,c.component_version
        FROM corpus_components c
        WHERE c.parent_version=p_parent_version AND c.status='Live'
      )
      INSERT INTO draft_run_serving_inventory(snapshot_id,puzzle_id,set_id,pick_number,band,source_draft_hash)
      SELECT snapshot.id,p.puzzle_id,p.set_id,p.pick_number,r.band,p.source_draft_hash
      FROM draft_run_verified_puzzles p
      JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version=p_difficulty
      LEFT JOIN active_parent_sets e
        ON e.set_id=p.set_id AND p.corpus_version=p_parent_version
      LEFT JOIN live_components component
        ON component.set_id=p.set_id AND component.component_version=p.corpus_version
      WHERE p.interesting AND p.pack_number=1 AND r.target_support_ratio>=0.20526315789473684::float8
        AND (
          (p.corpus_version=p_parent_version AND e.set_id IS NOT NULL AND (
            e.active_snapshot_id IS NULL OR e.active_snapshot_id=p.source_snapshot_id
            OR (p.source_snapshot_id IS NULL AND (
              e.active_schema_version='historical-frozen'
              OR (e.has_historical_parent AND NOT e.superseded_first_class AND e.active_corpus_version<>p.corpus_version)
            ))
            -- Cross-version bridge: the previous parent keeps serving the exact
            -- snapshot the active one superseded until its runtime is replaced.
            -- Same-version refreshes never qualify, so no set serves two snapshots.
            OR (p.source_snapshot_id IS NOT NULL AND e.active_corpus_version<>p.corpus_version
              AND EXISTS(
                SELECT 1 FROM corpus_source_snapshots previous
                WHERE previous.source_snapshot_id=p.source_snapshot_id AND previous.set_id=p.set_id
                  AND previous.superseded_by=e.active_snapshot_id
              ))
          ))
          OR (p.corpus_version<>p_parent_version AND component.component_version IS NOT NULL)
        )
        AND NOT EXISTS(SELECT 1 FROM draft_run_pick_removal_members m JOIN draft_run_pick_removals q USING(decision_key)
          WHERE m.puzzle_id=p.puzzle_id AND q.removed)
        AND NOT EXISTS(
          SELECT 1 FROM corpus_source_exclusions x
          WHERE x.set_id=p.set_id AND x.corpus_version=p.corpus_version
            AND x.source_draft_hash=p.source_draft_hash
        );
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

-- Cache carry must use the same cross-version membership as the builder.
-- Otherwise activation queues the still-serving previous runtime instead of
-- preserving its verified cache at the new revision.
CREATE OR REPLACE FUNCTION pack1_serving_snapshot_matches_current(
  p_parent text,p_difficulty text,p_policy text,p_snapshot bigint
)
RETURNS boolean LANGUAGE sql STABLE AS $$
WITH active_parent_sets AS MATERIALIZED (
  SELECT e.set_id,e.active_snapshot_id,a.corpus_version active_corpus_version,
    a.schema_version active_schema_version,
    EXISTS(
      SELECT 1 FROM corpus_source_snapshots h
      WHERE h.set_id=e.set_id AND h.corpus_version=p_parent
        AND h.schema_version='historical-frozen'
    ) has_historical_parent,
    -- A first-class parent snapshot that the active one superseded is what
    -- the previous runtime served; it takes precedence over the baseline.
    EXISTS(
      SELECT 1 FROM corpus_source_snapshots f
      WHERE f.set_id=e.set_id AND f.corpus_version=p_parent
        AND f.schema_version<>'historical-frozen' AND f.superseded_by=e.active_snapshot_id
    ) superseded_first_class
  FROM draft_run_environment_policy e
  LEFT JOIN corpus_source_snapshots a ON a.source_snapshot_id=e.active_snapshot_id
  WHERE e.status='Live'
), live_components AS MATERIALIZED (
  SELECT c.set_id,c.component_version
  FROM corpus_components c
  WHERE c.parent_version=p_parent AND c.status='Live'
), expected AS MATERIALIZED (
  SELECT p.puzzle_id,p.set_id,p.pick_number,r.band,p.source_draft_hash
  FROM draft_run_verified_puzzles p
  JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version=p_difficulty
  LEFT JOIN active_parent_sets e
    ON e.set_id=p.set_id AND p.corpus_version=p_parent
  LEFT JOIN live_components component
    ON component.set_id=p.set_id AND component.component_version=p.corpus_version
  WHERE p.interesting AND p.pack_number=1 AND r.target_support_ratio>=0.20526315789473684::float8
    AND (
      (p.corpus_version=p_parent AND e.set_id IS NOT NULL AND (
        e.active_snapshot_id IS NULL OR e.active_snapshot_id=p.source_snapshot_id
        OR (p.source_snapshot_id IS NULL AND (
          e.active_schema_version='historical-frozen'
          OR (e.has_historical_parent AND NOT e.superseded_first_class AND e.active_corpus_version<>p.corpus_version)
        ))
        OR (p.source_snapshot_id IS NOT NULL AND e.active_corpus_version<>p.corpus_version
          AND EXISTS(
            SELECT 1 FROM corpus_source_snapshots previous
            WHERE previous.source_snapshot_id=p.source_snapshot_id AND previous.set_id=p.set_id
              AND previous.superseded_by=e.active_snapshot_id
          ))
      ))
      OR (p.corpus_version<>p_parent AND component.component_version IS NOT NULL)
    )
    AND NOT EXISTS(SELECT 1 FROM draft_run_pick_removal_members m JOIN draft_run_pick_removals q USING(decision_key)
      WHERE m.puzzle_id=p.puzzle_id AND q.removed)
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
