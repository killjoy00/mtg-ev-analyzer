-- Derived ratings leave immutable puzzle payloads and scores untouched.
CREATE TABLE IF NOT EXISTS draft_run_puzzle_ratings (
  puzzle_id text NOT NULL REFERENCES draft_run_verified_puzzles(puzzle_id) ON DELETE CASCADE,
  difficulty_version text NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 0 AND 100),
  top_two_ratio double precision NOT NULL CHECK (top_two_ratio BETWEEN 0 AND 1),
  target_support_ratio double precision NOT NULL CHECK (target_support_ratio BETWEEN 0 AND 1),
  band text GENERATED ALWAYS AS (CASE WHEN rating < 50 THEN 'easy' WHEN rating < 80 THEN 'medium' ELSE 'hard' END) STORED,
  PRIMARY KEY (puzzle_id, difficulty_version)
);

CREATE OR REPLACE FUNCTION draft_run_rate_v1(p jsonb)
RETURNS TABLE(rating smallint, top_two_ratio double precision, target_support_ratio double precision)
LANGUAGE sql IMMUTABLE STRICT AS $$
  WITH supports AS (
    SELECT (c->>'model_probability')::double precision AS support, c->>'id' AS id
    FROM jsonb_array_elements(p->'candidates') c
  ), summary AS (
    SELECT array_agg(support ORDER BY support DESC) AS ranked,
      max(support) FILTER (WHERE id = p->>'historical_pick_id') AS target FROM supports
  ) SELECT floor(100 * ranked[2] / NULLIF(ranked[1],0) + 0.5)::smallint,
      ranked[2] / NULLIF(ranked[1],0), target / NULLIF(ranked[1],0) FROM summary;
$$;

CREATE OR REPLACE FUNCTION draft_run_rate_inserted_puzzle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO draft_run_puzzle_ratings(puzzle_id,difficulty_version,rating,top_two_ratio,target_support_ratio)
    SELECT NEW.puzzle_id,'support-ratio-v1',r.* FROM draft_run_rate_v1(NEW.payload) r
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER draft_run_rate_new_puzzle
AFTER INSERT ON draft_run_verified_puzzles
FOR EACH ROW EXECUTE FUNCTION draft_run_rate_inserted_puzzle();

ALTER TABLE draft_run_sessions ADD COLUMN IF NOT EXISTS difficulty_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE draft_run_sessions ADD COLUMN IF NOT EXISTS difficulty_anchors jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE draft_run_schedules ADD COLUMN IF NOT EXISTS difficulty_version text NOT NULL DEFAULT 'legacy';

-- Backfill existing ratings with scripts/backfill_draft_run_ratings.mjs before
-- deploying the new backend. The insertion trigger covers future imports.
