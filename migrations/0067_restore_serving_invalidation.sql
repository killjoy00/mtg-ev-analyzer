-- Restore the current serving definitions after historical replay.
-- No input data, serving revision, Daily, score, or saved run is changed.
-- Keep the removal-aware comparison installed by 0066.

CREATE OR REPLACE FUNCTION pack1_invalidate_inserted_puzzles()
RETURNS trigger LANGUAGE plpgsql AS $insert_puzzles$
BEGIN
  IF EXISTS(
    SELECT 1 FROM new_rows p
    WHERE pack1_puzzle_can_affect_serving(p.set_id,p.corpus_version,p.source_snapshot_id)
  ) THEN
    PERFORM pack1_bump_serving_revision();
  END IF;
  RETURN NULL;
END;
$insert_puzzles$;

CREATE OR REPLACE FUNCTION pack1_invalidate_deleted_puzzles()
RETURNS trigger LANGUAGE plpgsql AS $delete_puzzles$
BEGIN
  IF EXISTS(
    SELECT 1 FROM old_rows p
    WHERE pack1_puzzle_can_affect_serving(p.set_id,p.corpus_version,p.source_snapshot_id)
  ) THEN
    PERFORM pack1_bump_serving_revision();
  END IF;
  RETURN NULL;
END;
$delete_puzzles$;

CREATE OR REPLACE FUNCTION pack1_invalidate_updated_puzzle()
RETURNS trigger LANGUAGE plpgsql AS $update_puzzle$
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
$update_puzzle$;

CREATE OR REPLACE FUNCTION pack1_rating_can_affect_serving(p_puzzle_id text)
RETURNS boolean LANGUAGE sql STABLE AS $rating$
  SELECT EXISTS(
    SELECT 1 FROM draft_run_verified_puzzles p
    WHERE p.puzzle_id=p_puzzle_id
      AND pack1_puzzle_can_affect_serving(p.set_id,p.corpus_version,p.source_snapshot_id)
  );
$rating$;

CREATE OR REPLACE FUNCTION pack1_invalidate_inserted_versions()
RETURNS trigger LANGUAGE plpgsql AS $insert_versions$
BEGIN
  IF EXISTS(SELECT 1 FROM new_versions v WHERE pack1_version_can_affect_serving(v.corpus_version)) THEN
    PERFORM pack1_bump_serving_revision();
  END IF;
  RETURN NULL;
END;
$insert_versions$;

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
      AND prior.evidence->'inventory'->>'verified'='true'
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
            -- Exact-equivalent carry does not pretend to re-run date-sensitive
            -- gameplay samples. Preserve the original evidence day verbatim.
            'day',carry.evidence->>'day',
            'cache_snapshot_id',carry.cache_snapshot_id::text,
            'inventory',jsonb_build_object('verified',true,'expected',inventory_count,'actual',inventory_count,'missing',0,'extra',0),
            'samples',jsonb_build_array(jsonb_build_object(
              'mode','exact-serving-input-carry-forward',
              'previous_revision',carry.prior_revision::text,
              'cache_snapshot_id',carry.cache_snapshot_id::text,
              'carried_evidence_day',carry.evidence->>'day'
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
