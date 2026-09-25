-- Measured on a disposable production clone: same reroll query and exact results.
-- Set/pick-first access avoids scanning unrelated sets before rating/distance filters.
-- Concurrent build keeps gameplay writers available. A failed invalid build must
-- be investigated before retry; the release verifier requires indisvalid.
CREATE INDEX CONCURRENTLY IF NOT EXISTS draft_run_reroll_set_window_idx
ON draft_run_verified_puzzles(set_id,pick_number,corpus_version,puzzle_id)
INCLUDE(source_draft_hash,candidate_count,consensus_top_gap,support_entropy,pack_number)
WHERE interesting AND pack_number=1;
