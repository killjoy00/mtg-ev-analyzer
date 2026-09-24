-- Pack One competitive seasons are durable product history derived from immutable
-- Latest Set Daily schedules. They intentionally do not reference mutable corpus
-- policy rows so retired source metadata cannot erase an established season.
CREATE TABLE IF NOT EXISTS draft_run_seasons (
  id text PRIMARY KEY,
  set_id text NOT NULL UNIQUE,
  set_name text NOT NULL CHECK (char_length(set_name) BETWEEN 1 AND 120),
  set_release_date date NOT NULL,
  start_date date NOT NULL,
  end_date date,
  established_by_day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
-- statement
CREATE UNIQUE INDEX IF NOT EXISTS draft_run_seasons_current_uq
  ON draft_run_seasons ((true)) WHERE end_date IS NULL;
-- statement
CREATE INDEX IF NOT EXISTS draft_run_seasons_start_idx
  ON draft_run_seasons (start_date DESC);

-- Reconciliation is one serialized transaction. Persisted season metadata wins
-- over mutable policy state once a season exists; policy is consulted only when
-- a previously unseen scheduled set needs to establish a new season.
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
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pack1:draft-run-seasons', 0));

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
    ORDER BY day
  LOOP
    IF jsonb_typeof(scheduled.daily_featured_sets) IS DISTINCT FROM 'array'
      OR jsonb_array_length(scheduled.daily_featured_sets) <> 1
      OR jsonb_typeof(scheduled.daily_featured_sets->0) <> 'string'
    THEN
      RAISE EXCEPTION 'Latest Set Daily on % does not identify exactly one set.', scheduled.day;
    END IF;

    candidate_set := scheduled.daily_featured_sets->>0;

    -- Matching current schedules and already-closed fallback sets need no mutable
    -- policy lookup. This is what makes temporary A -> B -> A serving monotonic.
    IF current_season.id IS NOT NULL AND candidate_set = current_season.set_id THEN
      CONTINUE;
    END IF;

    SELECT * INTO prior_season
    FROM draft_run_seasons
    WHERE set_id=candidate_set
    LIMIT 1;
    IF FOUND THEN
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
          RAISE EXCEPTION 'Inaugural season contradiction: first Latest Set schedule uses %, but newest Live regular set on ranked launch date % is %.',
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
      CONTINUE;
    END IF;

    -- A schedule for an older/equal release is an operational fallback, not a
    -- competitive reset. Only a strictly later release may advance the season.
    IF policy.release_date <= current_season.set_release_date THEN
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
  END LOOP;

  IF current_season.id IS NOT NULL THEN
    RETURN NEXT current_season;
  END IF;
  RETURN;
END;
$$;
