PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 2 AND 24),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  challenge_date TEXT NOT NULL,
  set_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('top3', 'full')),
  score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
  grade TEXT NOT NULL,
  top1 TEXT,
  top2 TEXT,
  top3 TEXT,
  selections_json TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  is_featured INTEGER NOT NULL DEFAULT 0 CHECK(is_featured IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(player_id, challenge_date, set_id, mode)
);

CREATE INDEX IF NOT EXISTS scores_board_idx ON scores(challenge_date, set_id, mode, score DESC);
CREATE INDEX IF NOT EXISTS scores_featured_idx ON scores(is_featured, challenge_date, mode, score DESC);
CREATE INDEX IF NOT EXISTS scores_player_idx ON scores(player_id, challenge_date DESC);

CREATE TABLE IF NOT EXISTS share_challenges (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  set_id TEXT NOT NULL,
  set_name TEXT NOT NULL,
  pack_json TEXT NOT NULL,
  historical_id TEXT NOT NULL DEFAULT '',
  selected_json TEXT NOT NULL,
  score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
  grade TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS share_challenges_created_idx ON share_challenges(created_at DESC);

INSERT OR IGNORE INTO settings(key, value)
VALUES ('player_secret', lower(hex(randomblob(32))));
