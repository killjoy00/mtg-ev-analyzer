-- Derived selection features for verified puzzles, written by
-- scripts/score-puzzle-selection.mjs when puzzles are imported. Payloads and
-- grading are untouched. The latest-set Daily ranks contested decisions by
-- stakes_points and gates late picks on the trophy deck and land answers; a set
-- whose serving puzzles are not all scored keeps the band draw.
CREATE TABLE IF NOT EXISTS draft_run_puzzle_selection_features (
  puzzle_id text NOT NULL REFERENCES draft_run_verified_puzzles(puzzle_id) ON DELETE CASCADE,
  feature_version text NOT NULL,
  -- Card strength table used (corpus/card-strength); null when the set has none.
  strength_version text,
  strength_sha256 text CHECK (strength_sha256 ~ '^[a-f0-9]{64}$'),
  -- Strongest credible option's smoothed game-in-hand win rate minus the set
  -- average, in percentage points. Null without a table or a rated option.
  stakes_points real,
  -- Options with at least 35% of the leader's model support, top three.
  credible_count smallint NOT NULL CHECK (credible_count BETWEEN 1 AND 3),
  -- Null when the trophy decklist is unavailable.
  trophy_in_main_deck boolean,
  trophy_is_land boolean NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (puzzle_id, feature_version),
  CHECK ((strength_version IS NULL) = (strength_sha256 IS NULL)),
  CHECK (stakes_points IS NULL OR strength_version IS NOT NULL)
);

-- Which rule chose a Daily's puzzles. Null means the band draw.
ALTER TABLE draft_run_schedules ADD COLUMN IF NOT EXISTS selection_rule text;
