-- Additive launch schema. Imported historical tables remain untouched.
CREATE TABLE IF NOT EXISTS draft_run_verified_sets (
  set_id text PRIMARY KEY,
  corpus_version text NOT NULL,
  manifest jsonb NOT NULL
);
-- statement
CREATE TABLE IF NOT EXISTS draft_run_verified_puzzles (
  puzzle_id text PRIMARY KEY,
  set_id text NOT NULL REFERENCES draft_run_verified_sets(set_id),
  source_draft_hash text NOT NULL,
  corpus_version text NOT NULL,
  pick_number smallint NOT NULL CHECK (pick_number BETWEEN 1 AND 11),
  candidate_count smallint NOT NULL CHECK (candidate_count >= 4),
  consensus_top_gap real NOT NULL,
  support_entropy real NOT NULL,
  interesting boolean NOT NULL,
  payload jsonb NOT NULL,
  CHECK ((payload->>'event_match_wins')::int = 7),
  CHECK ((payload->>'player_games_lower_bound')::int >= 100),
  CHECK ((payload->>'player_win_rate_bucket')::numeric BETWEEN 0.6 AND 1),
  CHECK (jsonb_array_length(payload->'prior_picks') = pick_number - 1),
  CHECK (jsonb_array_length(payload->'candidates') = candidate_count),
  UNIQUE(corpus_version, set_id, source_draft_hash, pick_number)
);
-- statement
CREATE INDEX IF NOT EXISTS draft_run_verified_selection_idx ON draft_run_verified_puzzles(corpus_version, pick_number, set_id) WHERE interesting;
-- statement
CREATE TABLE IF NOT EXISTS draft_run_schedules (
  day date PRIMARY KEY,
  corpus_version text NOT NULL,
  puzzle_ids jsonb NOT NULL CHECK (jsonb_array_length(puzzle_ids)=10)
);
-- statement
CREATE TABLE IF NOT EXISTS draft_run_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES players(id),
  day date,
  seed text NOT NULL,
  corpus_version text NOT NULL,
  scoring_version text NOT NULL,
  puzzle_ids jsonb NOT NULL CHECK (jsonb_array_length(puzzle_ids)=10),
  answers jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_array_length(answers)<=10),
  seen_sources jsonb NOT NULL,
  rerolls jsonb NOT NULL DEFAULT '{"set":1,"pack":1}',
  revision integer NOT NULL DEFAULT 0,
  challenge_id text,
  score smallint CHECK (score BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- statement
CREATE UNIQUE INDEX IF NOT EXISTS draft_run_daily_attempt_idx ON draft_run_sessions(player_id,day) WHERE day IS NOT NULL;
-- statement
CREATE INDEX IF NOT EXISTS draft_run_sessions_player_idx ON draft_run_sessions(player_id,created_at DESC);
-- statement
CREATE TABLE IF NOT EXISTS draft_run_shares (
  id text PRIMARY KEY,
  session_id uuid NOT NULL UNIQUE REFERENCES draft_run_sessions(id),
  display_name text NOT NULL,
  score smallint NOT NULL,
  puzzle_ids jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- statement
CREATE TABLE IF NOT EXISTS game_result_environments (
  game_result_id bigint NOT NULL REFERENCES game_results(id) ON DELETE CASCADE,
  set_id text NOT NULL,
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  PRIMARY KEY(game_result_id,set_id)
);
-- statement
CREATE TABLE IF NOT EXISTS player_achievements (
  player_id uuid NOT NULL REFERENCES players(id),
  achievement_id text NOT NULL,
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(player_id,achievement_id)
);
-- statement
CREATE INDEX IF NOT EXISTS players_public_name_idx ON players(lower(display_name)) WHERE profile_public;
-- statement
CREATE INDEX IF NOT EXISTS scores_draft_run_period_idx ON scores(challenge_date,player_id) INCLUDE(score) WHERE mode='draft_run';
