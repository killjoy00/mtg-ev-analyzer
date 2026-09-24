-- Harden competitive-season reconciliation so settled Latest Set Daily
-- history is never revalidated against mutable corpus policy.
--
-- Before installing the watermark, run the existing 0037 reconciler once.
-- If it cannot reconcile current history, abort rather than declaring that
-- history settled. A successful pass proves every Latest Set schedule through
-- the current maximum day has been examined under the 0037 rules.
CREATE TABLE IF NOT EXISTS draft_run_season_reconciliation_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_reconciled_day date
);
-- statement
INSERT INTO draft_run_season_reconciliation_state(singleton,last_reconciled_day)
VALUES(true,NULL)
ON CONFLICT(singleton) DO NOTHING;
-- statement
DO $$
BEGIN
  PERFORM * FROM pack1_reconcile_draft_run_seasons();
END
$$;
-- statement
UPDATE draft_run_season_reconciliation_state
SET last_reconciled_day=(
  SELECT max(day)::date
  FROM draft_run_schedules
  WHERE environment='latest'
)
WHERE singleton=true;
-- statement

CREATE OR REPLACE FUNCTION pack1_reconcile_draft_run_seasons()
RETURNS SETOF draft_run_seasons
LANGUAGE plpgsql
AS $$
DECLARE
  current_season draft_run_seasons%ROWTYPE;
  prior_season draft_run_seasons%ROWTYPE;
  scheduled record;
  policy record;
  candidate_set text;
  first_ranked_date date;
  inaugural_start date;
  newest_live_set text;
  persisted_count integer;
  reconciled_through date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pack1:draft-run-seasons', 0));

  SELECT last_reconciled_day INTO reconciled_through
  FROM draft_run_season_reconciliation_state
  WHERE singleton=true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pack One season reconciliation watermark is missing.';
  END IF;

  SELECT * INTO current_season
  FROM draft_run_seasons
  WHERE end_date IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT count(*)::integer INTO persisted_count FROM draft_run_seasons;
    IF persisted_count > 0 THEN
      RAISE EXCEPTION 'Pack One season state is invalid: historical seasons exist without a current season.';
    END IF;
    current_season.id := NULL;
  END IF;

  FOR scheduled IN
    SELECT day::date AS day, daily_featured_sets
    FROM draft_run_schedules
    WHERE environment='latest'
      AND (reconciled_through IS NULL OR day::date > reconciled_through)
    ORDER BY day
  LOOP
    IF jsonb_typeof(scheduled.daily_featured_sets) IS DISTINCT FROM 'array'
      OR jsonb_array_length(scheduled.daily_featured_sets) <> 1
      OR jsonb_typeof(scheduled.daily_featured_sets->0) <> 'string'
    THEN
      RAISE EXCEPTION 'Latest Set Daily on % does not identify exactly one set.', scheduled.day;
    END IF;

    candidate_set := scheduled.daily_featured_sets->>0;

    -- Once a schedule day has been reconciled, the watermark makes its result
    -- durable. Matching current schedules and already-known historical sets
    -- therefore never require another mutable-policy lookup.
    IF current_season.id IS NOT NULL AND candidate_set = current_season.set_id THEN
      UPDATE draft_run_season_reconciliation_state
      SET last_reconciled_day=scheduled.day
      WHERE singleton=true;
      CONTINUE;
    END IF;

    SELECT * INTO prior_season
    FROM draft_run_seasons
    WHERE set_id=candidate_set
    LIMIT 1;
    IF FOUND THEN
      UPDATE draft_run_season_reconciliation_state
      SET last_reconciled_day=scheduled.day
      WHERE singleton=true;
      CONTINUE;
    END IF;

    SELECT set_id,set_name,release_date,regular_run,status
      INTO policy
    FROM draft_run_environment_policy
    WHERE set_id=candidate_set
    LIMIT 1;

    IF NOT FOUND
      OR policy.regular_run IS DISTINCT FROM true
      OR policy.set_name IS NULL
      OR btrim(policy.set_name)=''
      OR policy.release_date IS NULL
    THEN
      RAISE EXCEPTION 'Latest Set Daily on % references unvalidated regular set %.', scheduled.day, candidate_set;
    END IF;

    IF current_season.id IS NULL THEN
      SELECT min(challenge_date)::date INTO first_ranked_date
      FROM scores
      WHERE mode='draft_run' AND set_id IN ('mixed','powered-cube','latest');

      inaugural_start := scheduled.day;
      IF first_ranked_date IS NOT NULL AND first_ranked_date < scheduled.day THEN
        IF policy.release_date > first_ranked_date THEN
          RAISE EXCEPTION 'Inaugural season contradiction: scheduled set % released on % after ranked play began on %.',
            candidate_set, policy.release_date, first_ranked_date;
        END IF;

        SELECT p.set_id INTO newest_live_set
        FROM draft_run_environment_policy p
        WHERE p.regular_run=true
          AND p.status IN ('Live','Paused')
          AND p.release_date IS NOT NULL
          AND p.release_date <= first_ranked_date
        ORDER BY p.release_date DESC,p.set_id
        LIMIT 1;

        IF newest_live_set IS NULL OR newest_live_set <> candidate_set THEN
          RAISE EXCEPTION 'Inaugural season contradiction: first Latest Set schedule uses %, but newest published regular set on ranked launch date % is %.',
            candidate_set, first_ranked_date, coalesce(newest_live_set,'none');
        END IF;
        inaugural_start := first_ranked_date;
      END IF;

      INSERT INTO draft_run_seasons(id,set_id,set_name,set_release_date,start_date,established_by_day)
      VALUES(candidate_set,candidate_set,btrim(policy.set_name),policy.release_date,inaugural_start,scheduled.day);

      SELECT * INTO current_season
      FROM draft_run_seasons
      WHERE end_date IS NULL
      LIMIT 1;

      UPDATE draft_run_season_reconciliation_state
      SET last_reconciled_day=scheduled.day
      WHERE singleton=true;
      CONTINUE;
    END IF;

    -- A schedule for an older/equal release is an operational fallback, not a
    -- competitive reset. Mark the day settled without retaining a dependency
    -- on that fallback set's mutable policy row.
    IF policy.release_date <= current_season.set_release_date THEN
      UPDATE draft_run_season_reconciliation_state
      SET last_reconciled_day=scheduled.day
      WHERE singleton=true;
      CONTINUE;
    END IF;

    UPDATE draft_run_seasons
    SET end_date=scheduled.day-1
    WHERE id=current_season.id AND end_date IS NULL;

    INSERT INTO draft_run_seasons(id,set_id,set_name,set_release_date,start_date,established_by_day)
    VALUES(candidate_set,candidate_set,btrim(policy.set_name),policy.release_date,scheduled.day,scheduled.day);

    SELECT * INTO current_season
    FROM draft_run_seasons
    WHERE end_date IS NULL
    LIMIT 1;

    UPDATE draft_run_season_reconciliation_state
    SET last_reconciled_day=scheduled.day
    WHERE singleton=true;
  END LOOP;

  IF current_season.id IS NOT NULL THEN
    RETURN NEXT current_season;
  END IF;
  RETURN;
END;
$$;
