-- Rerolls retain their exact candidate SQL, source authority, distance ordering
-- and RNG. Include the active-snapshot key so that the geometry scan can use
-- index-only access instead of fetching thousands of wide puzzle heap pages.
-- Keep 0040's index for rollback. A failed concurrent build remains invalid;
-- release verification must reject it rather than silently accepting its name.
CREATE INDEX CONCURRENTLY IF NOT EXISTS draft_run_reroll_covering_idx
ON draft_run_verified_puzzles(set_id,pick_number,corpus_version,puzzle_id)
INCLUDE(source_draft_hash,candidate_count,consensus_top_gap,support_entropy,pack_number,source_snapshot_id)
WHERE interesting AND pack_number=1;
