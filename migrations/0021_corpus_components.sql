-- Widen source eligibility without rewriting or rescoring retained Premier rows.
-- NOT VALID avoids a table scan; every new/updated payload is still checked.
ALTER TABLE draft_run_verified_puzzles DROP CONSTRAINT IF EXISTS draft_run_verified_puzzles_payload_check;
ALTER TABLE draft_run_verified_puzzles DROP CONSTRAINT IF EXISTS draft_run_evidence_required;
ALTER TABLE draft_run_verified_puzzles DROP CONSTRAINT IF EXISTS draft_run_source_evidence_required;
ALTER TABLE draft_run_verified_puzzles ADD CONSTRAINT draft_run_source_evidence_required CHECK ((
 (payload->>'event_match_wins')::int=7 AND coalesce(payload->>'source_event_type','PremierDraft')='PremierDraft'
 AND (payload->>'player_games_lower_bound')::int>=100
 AND ((payload->>'player_win_rate_bucket')::numeric BETWEEN .6 AND 1
      OR (set_id IN ('stx','mid','vow') AND payload->>'skill_evidence'='earliest_game_arena_rank'
          AND payload->>'player_rank_tier' IN ('diamond','mythic')))
 OR (payload->>'source_event_type'='TradDraft' AND (payload->>'event_match_wins')::int=3
     AND (payload->>'event_match_losses')::int=0 AND pick_number BETWEEN 1 AND 8
     AND ((set_id='powered-cube' AND corpus_version='traditional-cube-p2p7-v3-v1' AND pick_number BETWEEN 2 AND 7)
          OR (set_id<>'powered-cube' AND corpus_version='traditional-premier-v3-v1'))
     AND payload->>'corpus_version'=corpus_version
     AND payload->>'model_version'='strong-player-colour-stage-v3' AND payload->>'model_source_event'='PremierDraft'
     AND payload->>'skill_evidence'='win_rate_bucket' AND (payload->>'player_games_lower_bound')::int>=100
     AND (payload->>'player_win_rate_bucket')::numeric BETWEEN .6 AND 1)
) IS TRUE) NOT VALID;

-- Independent source publication; never copy or rebuild Premier puzzles.
CREATE TABLE IF NOT EXISTS corpus_components (
 set_id text NOT NULL,
 parent_version text NOT NULL,
 component_version text NOT NULL,
 event_type text NOT NULL CHECK(event_type='TradDraft'),
 model_version text NOT NULL CHECK(model_version='strong-player-colour-stage-v3'),
 status text NOT NULL DEFAULT 'Candidate' CHECK(status IN ('Candidate','Live','Paused','Retired')),
 created_at timestamptz NOT NULL DEFAULT now(),
 status_changed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(set_id,component_version),
 FOREIGN KEY(set_id,parent_version) REFERENCES corpus_set_versions(set_id,corpus_version),
 FOREIGN KEY(set_id,component_version) REFERENCES corpus_set_versions(set_id,corpus_version),
 CHECK(parent_version<>component_version)
);
CREATE INDEX IF NOT EXISTS corpus_components_serving ON corpus_components(parent_version,status,component_version,set_id);
CREATE OR REPLACE FUNCTION preserve_corpus_component_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(OLD.set_id,OLD.parent_version,OLD.component_version,OLD.event_type,OLD.model_version)
 IS DISTINCT FROM ROW(NEW.set_id,NEW.parent_version,NEW.component_version,NEW.event_type,NEW.model_version)
 THEN RAISE EXCEPTION 'Corpus component identity is immutable; publish a new component revision'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS preserve_corpus_component_identity ON corpus_components;
CREATE TRIGGER preserve_corpus_component_identity BEFORE UPDATE ON corpus_components
 FOR EACH ROW EXECUTE FUNCTION preserve_corpus_component_identity();
ALTER TABLE corpus_status_events ADD COLUMN IF NOT EXISTS component_version text;
ALTER TABLE draft_run_sessions ADD COLUMN IF NOT EXISTS source_components jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE draft_run_schedules ADD COLUMN IF NOT EXISTS source_components jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE OR REPLACE FUNCTION snapshot_run_components() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.puzzle_ids=NEW.puzzle_ids THEN RETURN NEW; END IF;
 SELECT coalesce(jsonb_agg(v ORDER BY v),'[]'::jsonb) INTO NEW.source_components
 FROM (SELECT DISTINCT p.corpus_version v FROM draft_run_verified_puzzles p
       JOIN jsonb_array_elements_text(NEW.puzzle_ids) ids(value) ON ids.value=p.puzzle_id) components;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS snapshot_run_components ON draft_run_sessions;
CREATE TRIGGER snapshot_run_components BEFORE INSERT OR UPDATE OF puzzle_ids ON draft_run_sessions
 FOR EACH ROW EXECUTE FUNCTION snapshot_run_components();
DROP TRIGGER IF EXISTS snapshot_schedule_components ON draft_run_schedules;
CREATE TRIGGER snapshot_schedule_components BEFORE INSERT OR UPDATE OF puzzle_ids ON draft_run_schedules
 FOR EACH ROW EXECUTE FUNCTION snapshot_run_components();
CREATE OR REPLACE VIEW draft_run_source_measurements AS
 SELECT m.*,coalesce(p.payload->>'source_event_type','PremierDraft') source_event_type
 FROM draft_run_measurements m JOIN draft_run_verified_puzzles p USING(puzzle_id);
