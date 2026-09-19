-- Add a covering lookup for selected puzzle IDs. Keep all frozen ratings and
-- payloads unchanged; ordinary gameplay reads continue during index creation.
CREATE INDEX IF NOT EXISTS draft_run_rating_serving_lookup_idx
 ON draft_run_puzzle_ratings(puzzle_id)
 INCLUDE (band,rating,top_two_ratio,target_support_ratio)
 WHERE difficulty_version='support-ratio-v1';
ANALYZE public.corpus_components (parent_version, component_version, set_id, status);
ANALYZE public.corpus_source_exclusions (corpus_version, set_id, source_draft_hash);
