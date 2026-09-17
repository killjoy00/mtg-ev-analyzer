-- User-authorized permanent retirement. No environment names are emitted.
--
-- Two differences from 0010, both learned from it failing here:
--
-- 1. CHILD ROWS FIRST. 0010 predates draft_run_decision_observations and
--    draft_run_puzzle_ratings, which both reference draft_run_verified_puzzles.
--    Deleting the parent first raises a foreign key violation and aborts the
--    whole migration. Every dependent is cleared before its parent below.
-- 2. CONSTRAINTS ARE REPLACED, NOT ADDED. 0010 pinned each CHECK to the two
--    fingerprints retired then, so appending a third to the policy alone would
--    delete it once and let the database admit it ever after.

-- statement
DELETE FROM draft_run_decision_observations WHERE puzzle_id IN (SELECT puzzle_id FROM draft_run_verified_puzzles WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d'));
-- statement
DELETE FROM draft_run_puzzle_ratings WHERE puzzle_id IN (SELECT puzzle_id FROM draft_run_verified_puzzles WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d'));
-- statement
DELETE FROM game_result_environments WHERE game_result_id IN (SELECT id FROM game_results WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d'));
-- statement
DELETE FROM draft_run_verified_puzzles WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d');
-- statement
DELETE FROM draft_run_environment_policy WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d');
-- statement
DELETE FROM draft_run_verified_sets WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d');
-- statement
DELETE FROM draft_run_puzzles WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d');
-- statement
DELETE FROM draft_run_sets WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d');
-- statement
DELETE FROM game_result_environments WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d');
-- statement
DELETE FROM game_results WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d');
-- statement
DELETE FROM scores WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d');
-- statement
DELETE FROM share_challenges WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d');
-- statement
ALTER TABLE draft_run_puzzles DROP CONSTRAINT IF EXISTS draft_run_puzzles_supported_set;
-- statement
ALTER TABLE draft_run_puzzles ADD CONSTRAINT draft_run_puzzles_supported_set CHECK(NOT (encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d'))) NOT VALID;
-- statement
ALTER TABLE draft_run_verified_puzzles DROP CONSTRAINT IF EXISTS draft_run_verified_puzzles_supported_set;
-- statement
ALTER TABLE draft_run_verified_puzzles ADD CONSTRAINT draft_run_verified_puzzles_supported_set CHECK(NOT (encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d'))) NOT VALID;
-- statement
ALTER TABLE game_result_environments DROP CONSTRAINT IF EXISTS game_result_environments_supported_set;
-- statement
ALTER TABLE game_result_environments ADD CONSTRAINT game_result_environments_supported_set CHECK(NOT (encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d'))) NOT VALID;
-- statement
ALTER TABLE game_results DROP CONSTRAINT IF EXISTS game_results_supported_set;
-- statement
ALTER TABLE game_results ADD CONSTRAINT game_results_supported_set CHECK(NOT (encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d'))) NOT VALID;
-- statement
ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_supported_set;
-- statement
ALTER TABLE scores ADD CONSTRAINT scores_supported_set CHECK(NOT (encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d'))) NOT VALID;
-- statement
ALTER TABLE share_challenges DROP CONSTRAINT IF EXISTS share_challenges_supported_set;
-- statement
ALTER TABLE share_challenges ADD CONSTRAINT share_challenges_supported_set CHECK(NOT (encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d'))) NOT VALID;
-- statement
ALTER TABLE draft_run_environment_policy DROP CONSTRAINT IF EXISTS draft_run_environment_policy_supported_set;
-- statement
ALTER TABLE draft_run_environment_policy ADD CONSTRAINT draft_run_environment_policy_supported_set CHECK(NOT (encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d'))) NOT VALID;
-- statement
ALTER TABLE draft_run_sets DROP CONSTRAINT IF EXISTS draft_run_sets_supported_set;
-- statement
ALTER TABLE draft_run_sets ADD CONSTRAINT draft_run_sets_supported_set CHECK(NOT (encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d'))) NOT VALID;
-- statement
ALTER TABLE draft_run_verified_sets DROP CONSTRAINT IF EXISTS draft_run_verified_sets_supported_set;
-- statement
ALTER TABLE draft_run_verified_sets ADD CONSTRAINT draft_run_verified_sets_supported_set CHECK(NOT (encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d'))) NOT VALID;
-- statement
DELETE FROM analytics_events WHERE encode(sha256(convert_to(lower("event_props"->>'set_id'),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b','ca2b25a9b0e7a993f09d627d5929fb8cbfaa95403ac921f231149dc98ddce93d');
