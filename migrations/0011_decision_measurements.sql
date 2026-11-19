ALTER TABLE draft_run_sessions ADD COLUMN IF NOT EXISTS measurement_qa boolean NOT NULL DEFAULT false;
-- statement
CREATE TABLE IF NOT EXISTS draft_run_decision_observations (
  session_id uuid NOT NULL REFERENCES draft_run_sessions(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  round smallint NOT NULL CHECK(round BETWEEN 1 AND 10),
  puzzle_id text NOT NULL REFERENCES draft_run_verified_puzzles(puzzle_id),
  observed boolean NOT NULL DEFAULT false,
  view_id uuid,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  timing_reliable boolean NOT NULL DEFAULT true,
  outcome text CHECK(outcome IN ('pick','set','pack')),
  answered_at timestamptz,
  active_ms integer CHECK(active_ms BETWEEN 0 AND 1800000),
  selected_id text,
  score smallint CHECK(score BETWEEN 0 AND 100),
  trophy_match boolean,
  PRIMARY KEY(session_id,revision)
);
-- statement
CREATE INDEX IF NOT EXISTS draft_run_observations_date_idx ON draft_run_decision_observations(first_seen_at);
-- statement
CREATE INDEX IF NOT EXISTS draft_run_observations_puzzle_idx ON draft_run_decision_observations(puzzle_id,first_seen_at);
-- statement
CREATE TABLE IF NOT EXISTS pack1_admins (
  auth_user_id uuid PRIMARY KEY REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- statement
CREATE TABLE IF NOT EXISTS pack1_admin_invites (
  token_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  redeemed_by uuid REFERENCES neon_auth."user"(id),
  redeemed_at timestamptz
);
-- statement
CREATE OR REPLACE VIEW draft_run_measurements AS
SELECT o.*,s.player_id,s.environment,s.day,s.corpus_version,s.scoring_version,s.difficulty_version,s.selection_version,
  CASE WHEN s.day IS NOT NULL THEN 'daily' WHEN s.challenge_id IS NOT NULL THEN 'challenge' ELSE 'practice' END run_type,
  jsonb_array_length(s.answers)=10 run_complete,
  s.measurement_qa OR p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)' is_qa,
  v.set_id,v.pick_number,r.rating,r.band,r.target_support_ratio<0.2 model_disagreement,
  o.outcome IS NULL AND jsonb_array_length(s.answers)<10 AND greatest(o.last_seen_at,s.updated_at)<now()-interval '24 hours' likely_abandoned,
  NOT EXISTS (
    SELECT 1 FROM draft_run_decision_observations prior JOIN draft_run_sessions ps ON ps.id=prior.session_id
    WHERE prior.observed AND prior.puzzle_id=o.puzzle_id AND ps.player_id=s.player_id
      AND (prior.first_seen_at,prior.session_id,prior.revision)<(o.first_seen_at,o.session_id,o.revision)
  ) AND NOT EXISTS (
    SELECT 1 FROM draft_run_sessions old WHERE old.player_id=s.player_id AND old.id<>s.id AND old.created_at<s.created_at
      AND old.answers @> jsonb_build_array(jsonb_build_object('puzzle',jsonb_build_object('puzzle_id',o.puzzle_id)))
  ) first_encounter
FROM draft_run_decision_observations o
JOIN draft_run_sessions s ON s.id=o.session_id
JOIN players p ON p.id=s.player_id
JOIN draft_run_verified_puzzles v ON v.puzzle_id=o.puzzle_id
LEFT JOIN draft_run_puzzle_ratings r ON r.puzzle_id=o.puzzle_id AND r.difficulty_version=s.difficulty_version;
