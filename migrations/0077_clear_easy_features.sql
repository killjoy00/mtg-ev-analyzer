-- Clear-Easy selection features (puzzle-selection.mjs, EASY_RULE), written by
-- scripts/score-puzzle-selection.mjs beside the stakes features. Payloads,
-- ratings and grading are untouched. Both columns are null on rows scored
-- before this migration; the backfill treats such rows as stale, and a Daily
-- whose planned sets still hold one keeps the previous uniform Easy draw.
ALTER TABLE draft_run_puzzle_selection_features
  -- Trophy pick's card strength minus the strongest other rated card in the
  -- pack, in percentage points. Null without a table, an unrated trophy pick
  -- or no other rated card.
  ADD COLUMN IF NOT EXISTS trophy_strength_margin real,
  -- The trophy pick is coloured and shares no colour with the coloured prior
  -- picks. Null only on rows scored before this migration.
  ADD COLUMN IF NOT EXISTS trophy_off_colour boolean;
