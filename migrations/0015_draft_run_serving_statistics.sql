-- Metadata-only, repeatable maintenance after migrations 0008/0009/0012.
-- The defaulted pack_number column lacked statistics even though the older
-- columns had auto-analyze history. Its underestimated selectivity selected
-- hundreds of thousands of nested-loop rating lookups for mixed run counts.
-- Keep these statements aligned with worker/serving-statistics.mjs. Bulk
-- imports/backfills repeat them once after successful accounting checks.
-- No puzzle payload, score, session, schedule or policy is modified.
ANALYZE public.draft_run_verified_puzzles (corpus_version, interesting, pack_number, set_id, pick_number, puzzle_id, source_draft_hash, candidate_count, consensus_top_gap, support_entropy);
ANALYZE public.draft_run_puzzle_ratings (difficulty_version, puzzle_id, band, rating, top_two_ratio, target_support_ratio);
