-- Run through psql after bulk puzzle/rating writes have committed. This file
-- deliberately runs outside a transaction: ordinary VACUUM restores visibility
-- bits needed by covering indexes, whereas ANALYZE alone cannot do so.
-- Never use FULL or truncate the heap; player reads and row writes remain allowed.
DO $$
BEGIN
  IF current_database()<>'pack1' THEN
    RAISE EXCEPTION 'Serving maintenance requires the pack1 database';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid IN ('public.draft_run_verified_puzzles'::regclass,
                  'public.draft_run_puzzle_ratings'::regclass)
      AND NOT pg_has_role(current_user,relowner,'USAGE')
  ) THEN
    RAISE EXCEPTION 'Serving maintenance requires table ownership';
  END IF;
END $$;
SET lock_timeout='5s';
SET statement_timeout='8min';
VACUUM (ANALYZE, TRUNCATE FALSE) public.draft_run_verified_puzzles
  (corpus_version,interesting,pack_number,set_id,pick_number,puzzle_id,source_draft_hash,candidate_count,consensus_top_gap,support_entropy);
VACUUM (ANALYZE, TRUNCATE FALSE) public.draft_run_puzzle_ratings
  (difficulty_version,puzzle_id,band,rating,top_two_ratio,target_support_ratio);
SELECT relname,relpages,relallvisible FROM pg_class
WHERE oid IN ('public.draft_run_verified_puzzles'::regclass,
              'public.draft_run_puzzle_ratings'::regclass)
ORDER BY relname;
RESET statement_timeout;
RESET lock_timeout;
