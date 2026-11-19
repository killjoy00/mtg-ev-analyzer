-- Empty compatibility shells for the pre-verified corpus tables. Their original
-- DDL predates the migration manifest and is not present in this repository.
-- Only historical retirement migrations use these tables (set_id predicates).
-- Current runtime data and constraints come from the real verified schema.
CREATE TABLE draft_run_sets (LIKE draft_run_verified_sets INCLUDING ALL);
CREATE TABLE draft_run_puzzles (LIKE draft_run_verified_puzzles INCLUDING ALL);
