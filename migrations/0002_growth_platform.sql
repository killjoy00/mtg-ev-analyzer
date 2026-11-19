CREATE TABLE IF NOT EXISTS account_links (
  auth_user_id uuid PRIMARY KEY REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  player_id uuid NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id bigserial PRIMARY KEY,
  player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  event_name text NOT NULL CHECK (char_length(event_name) BETWEEN 2 AND 64),
  event_props jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_events_name_created_idx ON analytics_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_player_created_idx ON analytics_events(player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_results (
  id bigserial PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  played_at timestamptz NOT NULL DEFAULT now(),
  set_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('top3','full')),
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  grade text NOT NULL,
  seed text,
  is_daily boolean NOT NULL DEFAULT false,
  challenge_id text,
  opponent_name text,
  opponent_score smallint,
  outcome text CHECK (outcome IN ('win','tie','loss') OR outcome IS NULL),
  client_result_id text NOT NULL,
  UNIQUE(player_id, client_result_id)
);
CREATE INDEX IF NOT EXISTS game_results_player_played_idx ON game_results(player_id, played_at DESC);
CREATE INDEX IF NOT EXISTS game_results_player_set_mode_idx ON game_results(player_id, set_id, mode);
