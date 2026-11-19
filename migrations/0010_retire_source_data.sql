-- User-authorized permanent retirement. No environment names are emitted.
DELETE FROM draft_run_puzzles WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b');
-- statement
ALTER TABLE draft_run_puzzles ADD CONSTRAINT draft_run_puzzles_supported_set CHECK(encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') NOT IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b')) NOT VALID;
-- statement
DELETE FROM draft_run_verified_puzzles WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b');
-- statement
ALTER TABLE draft_run_verified_puzzles ADD CONSTRAINT draft_run_verified_puzzles_supported_set CHECK(encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') NOT IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b')) NOT VALID;
-- statement
DELETE FROM game_result_environments WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b');
-- statement
ALTER TABLE game_result_environments ADD CONSTRAINT game_result_environments_supported_set CHECK(encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') NOT IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b')) NOT VALID;
-- statement
DELETE FROM game_results WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b');
-- statement
ALTER TABLE game_results ADD CONSTRAINT game_results_supported_set CHECK(encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') NOT IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b')) NOT VALID;
-- statement
DELETE FROM scores WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b');
-- statement
ALTER TABLE scores ADD CONSTRAINT scores_supported_set CHECK(encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') NOT IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b')) NOT VALID;
-- statement
DELETE FROM share_challenges WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b');
-- statement
ALTER TABLE share_challenges ADD CONSTRAINT share_challenges_supported_set CHECK(encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') NOT IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b')) NOT VALID;
-- statement
DELETE FROM draft_run_environment_policy WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b');
-- statement
ALTER TABLE draft_run_environment_policy ADD CONSTRAINT draft_run_environment_policy_supported_set CHECK(encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') NOT IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b')) NOT VALID;
-- statement
DELETE FROM draft_run_sets WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b');
-- statement
ALTER TABLE draft_run_sets ADD CONSTRAINT draft_run_sets_supported_set CHECK(encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') NOT IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b')) NOT VALID;
-- statement
DELETE FROM draft_run_verified_sets WHERE encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b');
-- statement
ALTER TABLE draft_run_verified_sets ADD CONSTRAINT draft_run_verified_sets_supported_set CHECK(encode(sha256(convert_to(lower(set_id),'UTF8')),'hex') NOT IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b')) NOT VALID;
-- statement
DELETE FROM analytics_events WHERE encode(sha256(convert_to(lower(event_props->>'set_id'),'UTF8')),'hex') IN ('f8272fb2c87fbdf3e6c933649a30f2663ba60983247b85ec223fc22b08358988','79b159b843b0aaba706b57fc165afa2d49c3680c43503ed36af6b4f66cbade5b');
