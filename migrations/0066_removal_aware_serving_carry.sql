-- 0064 excluded report-removed picks from pack1_build_serving_snapshot but not
-- from this exact-equivalence comparison, so after the first removal a verified
-- cache could never be carried across a revision. Mirror the builder's filter.
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
    ) has_historical_parent
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
          OR (e.has_historical_parent AND e.active_corpus_version<>p.corpus_version)
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
