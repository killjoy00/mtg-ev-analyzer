CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 24),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
  id bigserial PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  challenge_date date NOT NULL,
  set_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('top3', 'full')),
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  grade text NOT NULL,
  top1 text,
  top2 text,
  top3 text,
  selections_json jsonb NOT NULL,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(player_id, challenge_date, set_id, mode)
);

CREATE INDEX IF NOT EXISTS scores_board_idx ON scores(challenge_date, set_id, mode, score DESC);
CREATE INDEX IF NOT EXISTS scores_featured_idx ON scores(is_featured, challenge_date, mode, score DESC);
CREATE INDEX IF NOT EXISTS scores_player_idx ON scores(player_id, challenge_date DESC);

CREATE TABLE IF NOT EXISTS share_challenges (
  id text PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  set_id text NOT NULL,
  set_name text NOT NULL,
  pack_json jsonb NOT NULL,
  historical_id text NOT NULL DEFAULT '',
  selected_json jsonb NOT NULL,
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  grade text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS share_challenges_created_idx ON share_challenges(created_at DESC);

INSERT INTO settings(key, value)
VALUES ('player_secret', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text))
ON CONFLICT (key) DO NOTHING;
