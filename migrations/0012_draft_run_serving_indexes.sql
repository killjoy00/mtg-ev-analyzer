-- Bounded database selection needs metadata without repeatedly reading the
-- large payload heap. Apply and benchmark on an isolated branch first.
CREATE INDEX IF NOT EXISTS draft_run_serving_window_idx
ON draft_run_verified_puzzles(corpus_version,pick_number,set_id,puzzle_id)
INCLUDE(source_draft_hash,candidate_count,consensus_top_gap,support_entropy,pack_number)
WHERE interesting;

CREATE INDEX IF NOT EXISTS draft_run_rating_band_idx
ON draft_run_puzzle_ratings(difficulty_version,band,puzzle_id)
INCLUDE(rating,top_two_ratio,target_support_ratio);

-- Completion repair is retryable without rerunning career writes on every GET.
ALTER TABLE draft_run_sessions ADD COLUMN IF NOT EXISTS result_persisted_at timestamptz;

-- Retrieving the selected source's remaining decisions updates the in-memory
-- group counts without rescanning the corpus for every round.
CREATE INDEX IF NOT EXISTS draft_run_serving_source_idx
ON draft_run_verified_puzzles(corpus_version,source_draft_hash)
INCLUDE(puzzle_id,set_id,pick_number,pack_number,candidate_count,consensus_top_gap,support_entropy)
WHERE interesting;
