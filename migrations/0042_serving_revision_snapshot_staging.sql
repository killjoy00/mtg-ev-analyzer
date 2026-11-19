-- Candidate snapshot staging must not churn the live practice cache.
-- New first-class snapshots carry source_snapshot_id; retained historical/component
-- rows remain NULL and therefore conservatively invalidate when changed.

CREATE OR REPLACE FUNCTION pack1_bump_serving_revision()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('pack1.serving_input_xid',true)=pg_current_xact_id()::text THEN RETURN; END IF;
  UPDATE draft_run_serving_revision SET revision=revision+1 WHERE singleton;
  PERFORM set_config('pack1.serving_input_xid',pg_current_xact_id()::text,true);
END;
$$;

CREATE OR REPLACE FUNCTION pack1_invalidate_serving_inputs()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pack1_bump_serving_revision();
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pack1_puzzle_can_affect_serving(p_set_id text,p_source_snapshot_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_source_snapshot_id IS NULL OR EXISTS(
    SELECT 1
    FROM draft_run_environment_policy e
    WHERE e.set_id=p_set_id
      AND e.status='Live'
      AND e.active_snapshot_id=p_source_snapshot_id
  );
$$;

CREATE OR REPLACE FUNCTION pack1_invalidate_inserted_puzzles()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(
    SELECT 1 FROM new_rows p
    WHERE pack1_puzzle_can_affect_serving(p.set_id,p.source_snapshot_id)
  ) THEN
    PERFORM pack1_bump_serving_revision();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pack1_invalidate_deleted_puzzles()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(
    SELECT 1 FROM old_rows p
    WHERE pack1_puzzle_can_affect_serving(p.set_id,p.source_snapshot_id)
  ) THEN
    PERFORM pack1_bump_serving_revision();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pack1_invalidate_updated_puzzle()
RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF pack1_puzzle_can_affect_serving(OLD.set_id,OLD.source_snapshot_id)
     OR pack1_puzzle_can_affect_serving(NEW.set_id,NEW.source_snapshot_id) THEN
    PERFORM pack1_bump_serving_revision();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pack1_rating_can_affect_serving(p_puzzle_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1
    FROM draft_run_verified_puzzles p
    WHERE p.puzzle_id=p_puzzle_id
      AND pack1_puzzle_can_affect_serving(p.set_id,p.source_snapshot_id)
  );
$$;

CREATE OR REPLACE FUNCTION pack1_invalidate_inserted_ratings()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(
    SELECT 1 FROM new_ratings r
    WHERE pack1_rating_can_affect_serving(r.puzzle_id)
  ) THEN
    PERFORM pack1_bump_serving_revision();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pack1_invalidate_deleted_ratings()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(
    SELECT 1 FROM old_ratings r
    WHERE pack1_rating_can_affect_serving(r.puzzle_id)
  ) THEN
    PERFORM pack1_bump_serving_revision();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pack1_invalidate_updated_rating()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
    OLD.puzzle_id,OLD.difficulty_version,OLD.rating,OLD.top_two_ratio,
    OLD.target_support_ratio,OLD.band
  ) IS NOT DISTINCT FROM ROW(
    NEW.puzzle_id,NEW.difficulty_version,NEW.rating,NEW.top_two_ratio,
    NEW.target_support_ratio,NEW.band
  ) THEN
    RETURN NULL;
  END IF;
  IF pack1_rating_can_affect_serving(OLD.puzzle_id)
     OR pack1_rating_can_affect_serving(NEW.puzzle_id) THEN
    PERFORM pack1_bump_serving_revision();
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS serving_puzzle_rows ON draft_run_verified_puzzles;
DROP TRIGGER IF EXISTS serving_puzzle_metadata ON draft_run_verified_puzzles;
DROP TRIGGER IF EXISTS serving_puzzle_insert ON draft_run_verified_puzzles;
DROP TRIGGER IF EXISTS serving_puzzle_delete ON draft_run_verified_puzzles;
DROP TRIGGER IF EXISTS serving_puzzle_truncate ON draft_run_verified_puzzles;

CREATE TRIGGER serving_puzzle_insert
AFTER INSERT ON draft_run_verified_puzzles
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_inserted_puzzles();

CREATE TRIGGER serving_puzzle_delete
AFTER DELETE ON draft_run_verified_puzzles
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_deleted_puzzles();

CREATE TRIGGER serving_puzzle_metadata
AFTER UPDATE OF puzzle_id,set_id,corpus_version,source_snapshot_id,source_draft_hash,interesting,pack_number,pick_number,candidate_count,consensus_top_gap,support_entropy
ON draft_run_verified_puzzles
FOR EACH ROW EXECUTE FUNCTION pack1_invalidate_updated_puzzle();

CREATE TRIGGER serving_puzzle_truncate
AFTER TRUNCATE ON draft_run_verified_puzzles
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_serving_inputs();

DROP TRIGGER IF EXISTS serving_ratings ON draft_run_puzzle_ratings;
DROP TRIGGER IF EXISTS serving_ratings_insert ON draft_run_puzzle_ratings;
DROP TRIGGER IF EXISTS serving_ratings_delete ON draft_run_puzzle_ratings;
DROP TRIGGER IF EXISTS serving_ratings_truncate ON draft_run_puzzle_ratings;

CREATE TRIGGER serving_ratings_insert
AFTER INSERT ON draft_run_puzzle_ratings
REFERENCING NEW TABLE AS new_ratings
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_inserted_ratings();

CREATE TRIGGER serving_ratings_delete
AFTER DELETE ON draft_run_puzzle_ratings
REFERENCING OLD TABLE AS old_ratings
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_deleted_ratings();

CREATE TRIGGER serving_ratings
AFTER UPDATE OF puzzle_id,difficulty_version,rating,top_two_ratio,target_support_ratio,band
ON draft_run_puzzle_ratings
FOR EACH ROW EXECUTE FUNCTION pack1_invalidate_updated_rating();

CREATE TRIGGER serving_ratings_truncate
AFTER TRUNCATE ON draft_run_puzzle_ratings
FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_serving_inputs();
