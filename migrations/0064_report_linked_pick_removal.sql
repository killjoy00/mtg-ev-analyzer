-- Reversible decision moderation. Never delete source payloads, schedules or results.
-- Identity excludes scoring and artwork, and survives a corpus/source-ID refresh.
CREATE OR REPLACE FUNCTION pack1_decision_identity(p jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(
  p->>'set_id',coalesce(p->>'pack_number','1'),(p->>'pick_number')::int,
  (SELECT jsonb_agg(c->>'id' ORDER BY c->>'id') FROM jsonb_array_elements(p->'candidates') c),
  (SELECT coalesce(jsonb_agg(c->>'id' ORDER BY n),'[]') FROM jsonb_array_elements(p->'prior_picks') WITH ORDINALITY a(c,n)),
  p->>'historical_pick_id'
 )::text,'UTF8')),'hex');
$$;
CREATE TABLE IF NOT EXISTS draft_run_pick_removals (
 decision_key text PRIMARY KEY CHECK(decision_key ~ '^[a-f0-9]{64}$'),
 set_id text NOT NULL, pick_number smallint NOT NULL,
 removed boolean NOT NULL, revision integer NOT NULL CHECK(revision>0),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500),
 report_id uuid REFERENCES draft_run_decision_reports(id),
 actor_id uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS draft_run_pick_removals_group_idx ON draft_run_pick_removals(set_id,pick_number);
CREATE TABLE IF NOT EXISTS draft_run_pick_removal_members (
 puzzle_id text PRIMARY KEY REFERENCES draft_run_verified_puzzles(puzzle_id) ON DELETE CASCADE,
 decision_key text NOT NULL REFERENCES draft_run_pick_removals(decision_key)
);
CREATE INDEX IF NOT EXISTS draft_run_pick_removal_members_key_idx ON draft_run_pick_removal_members(decision_key);
CREATE TABLE IF NOT EXISTS draft_run_pick_removal_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 decision_key text NOT NULL REFERENCES draft_run_pick_removals(decision_key),
 revision integer NOT NULL, removed boolean NOT NULL,
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500),
 report_id uuid NOT NULL REFERENCES draft_run_decision_reports(id),
 actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(decision_key,revision)
);
CREATE OR REPLACE FUNCTION pack1_protect_pick_removal_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Pick removal history is append-only'; END;
$$;
CREATE OR REPLACE TRIGGER protect_pick_removal_history BEFORE UPDATE OR DELETE ON draft_run_pick_removal_events
 FOR EACH ROW EXECUTE FUNCTION pack1_protect_pick_removal_history();
-- Lock before row/rating writers can take the serving-revision lock; this
-- ordering also avoids deadlocks with moderation. Shared import locks coexist.
CREATE OR REPLACE FUNCTION pack1_lock_pick_copy_writes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_advisory_xact_lock_shared(519,1); RETURN NULL; END;
$$;
CREATE OR REPLACE TRIGGER lock_pick_copy_writes BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON draft_run_verified_puzzles
 FOR EACH STATEMENT EXECUTE FUNCTION pack1_lock_pick_copy_writes();
-- The exclusive moderator lock closes the scan/import race.
CREATE OR REPLACE FUNCTION pack1_map_removed_pick_copies()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF EXISTS(SELECT 1 FROM old_copies o JOIN draft_run_pick_removal_members m USING(puzzle_id)
   JOIN draft_run_pick_removals r USING(decision_key) WHERE r.removed
   AND pack1_puzzle_can_affect_serving(o.set_id,o.corpus_version,o.source_snapshot_id)) THEN
   PERFORM pack1_bump_serving_revision();
  END IF;
  DELETE FROM draft_run_pick_removal_members m USING old_copies o WHERE m.puzzle_id=o.puzzle_id;
 END IF;
 INSERT INTO draft_run_pick_removal_members(puzzle_id,decision_key)
  SELECT p.puzzle_id,r.decision_key FROM new_copies p JOIN draft_run_pick_removals r
   ON r.set_id=p.set_id AND r.pick_number=p.pick_number AND r.decision_key=pack1_decision_identity(p.payload)
  ON CONFLICT(puzzle_id) DO UPDATE SET decision_key=excluded.decision_key;
 IF EXISTS(SELECT 1 FROM new_copies p JOIN draft_run_pick_removal_members m USING(puzzle_id)
  JOIN draft_run_pick_removals r USING(decision_key) WHERE r.removed
  AND pack1_puzzle_can_affect_serving(p.set_id,p.corpus_version,p.source_snapshot_id)) THEN
  PERFORM pack1_bump_serving_revision();
 END IF;
 RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER map_removed_pick_insert AFTER INSERT ON draft_run_verified_puzzles
 REFERENCING NEW TABLE AS new_copies FOR EACH STATEMENT EXECUTE FUNCTION pack1_map_removed_pick_copies();
CREATE OR REPLACE TRIGGER map_removed_pick_update AFTER UPDATE ON draft_run_verified_puzzles
 REFERENCING OLD TABLE AS old_copies NEW TABLE AS new_copies FOR EACH STATEMENT EXECUTE FUNCTION pack1_map_removed_pick_copies();

CREATE OR REPLACE FUNCTION pack1_moderate_reported_pick(p_report uuid,p_removed boolean,p_expected integer,p_reason text,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE p draft_run_verified_puzzles%ROWTYPE; k text; old draft_run_pick_removals%ROWTYPE; copies integer; next_revision integer;
BEGIN
 IF p_actor IS NULL OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 OR p_expected IS NULL OR p_expected<0 OR p_removed IS NULL THEN
  RAISE EXCEPTION 'A moderation reason and expected revision are required' USING ERRCODE='22023';
 END IF;
 IF NOT pg_try_advisory_xact_lock(519,1) THEN
  RAISE EXCEPTION 'Pick inventory is being updated; refresh and retry' USING ERRCODE='40001';
 END IF;
 SELECT v.* INTO p FROM draft_run_decision_reports r JOIN draft_run_verified_puzzles v ON v.puzzle_id=r.puzzle_id WHERE r.id=p_report;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reported pick is unavailable' USING ERRCODE='P0002'; END IF;
 k:=pack1_decision_identity(p.payload);
 SELECT * INTO old FROM draft_run_pick_removals WHERE decision_key=k FOR UPDATE;
 IF coalesce(old.revision,0)<>p_expected OR coalesce(old.removed,false)=p_removed THEN
  RAISE EXCEPTION 'Pick moderation changed; refresh before retrying' USING ERRCODE='40001';
 END IF;
 next_revision:=coalesce(old.revision,0)+1;
 INSERT INTO draft_run_pick_removals(decision_key,set_id,pick_number,removed,revision,reason,report_id,actor_id)
  VALUES(k,p.set_id,p.pick_number,p_removed,next_revision,btrim(p_reason),p_report,p_actor)
  ON CONFLICT(decision_key) DO UPDATE SET removed=excluded.removed,revision=excluded.revision,reason=excluded.reason,
   report_id=excluded.report_id,actor_id=excluded.actor_id,updated_at=now();
 INSERT INTO draft_run_pick_removal_members(puzzle_id,decision_key) VALUES(p.puzzle_id,k)
  ON CONFLICT(puzzle_id) DO UPDATE SET decision_key=excluded.decision_key;
 -- The serving window index covers playable copies. A retained uninteresting
 -- copy is mapped by the update trigger before it can become playable.
 INSERT INTO draft_run_pick_removal_members(puzzle_id,decision_key)
  SELECT v.puzzle_id,k FROM draft_run_verified_puzzles v WHERE v.set_id=p.set_id AND v.pick_number=p.pick_number
   AND v.interesting AND v.pack_number=1
   AND pack1_decision_identity(v.payload)=k ON CONFLICT(puzzle_id) DO UPDATE SET decision_key=excluded.decision_key;
 SELECT count(*) INTO copies FROM draft_run_pick_removal_members WHERE decision_key=k;
 INSERT INTO draft_run_pick_removal_events(decision_key,revision,removed,reason,report_id,actor_id)
  VALUES(k,next_revision,p_removed,btrim(p_reason),p_report,p_actor);
 -- Inbox triage is independent: remove/restore never silently reviews or
 -- dismisses the report. The admin's explicit review controls remain valid.
 IF EXISTS(SELECT 1 FROM draft_run_pick_removal_members m JOIN draft_run_verified_puzzles v USING(puzzle_id)
  WHERE m.decision_key=k AND pack1_puzzle_can_affect_serving(v.set_id,v.corpus_version,v.source_snapshot_id)) THEN
  PERFORM pack1_bump_serving_revision();
 END IF;
 RETURN jsonb_build_object('decision_key',k,'removed',p_removed,'revision',next_revision,'copies',copies);
END;
$$;
ALTER TABLE draft_run_decision_reports DROP CONSTRAINT IF EXISTS draft_run_decision_reports_reason_check;
ALTER TABLE draft_run_decision_reports ADD CONSTRAINT draft_run_decision_reports_reason_check
 CHECK(reason IN ('draft_context','card_or_image','score_recommendation','uninteresting','broken','other'));

-- Keep the registered readiness gate and cross-version cutover policy.
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
          ) has_historical_parent
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
              OR (e.has_historical_parent AND e.active_corpus_version<>p.corpus_version)
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
