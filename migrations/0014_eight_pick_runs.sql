-- Eight-pick releases coexist with immutable ten-pick sessions and shares.
-- Apply before deploying the new function. No schedule or result is rewritten.
ALTER TABLE draft_run_sessions DROP CONSTRAINT IF EXISTS draft_run_sessions_puzzle_ids_check;
ALTER TABLE draft_run_sessions ADD CONSTRAINT draft_run_sessions_puzzle_ids_check CHECK(jsonb_array_length(puzzle_ids) IN (8,10));
ALTER TABLE draft_run_sessions DROP CONSTRAINT IF EXISTS draft_run_sessions_answers_check;
ALTER TABLE draft_run_sessions ADD CONSTRAINT draft_run_sessions_answers_check CHECK(jsonb_array_length(answers)<=jsonb_array_length(puzzle_ids));
ALTER TABLE draft_run_schedules DROP CONSTRAINT IF EXISTS draft_run_schedules_puzzle_ids_check;
ALTER TABLE draft_run_schedules ADD CONSTRAINT draft_run_schedules_puzzle_ids_check CHECK(jsonb_array_length(puzzle_ids) IN (8,10));
ALTER TABLE draft_run_sessions ADD COLUMN IF NOT EXISTS daily_featured_sets jsonb NOT NULL DEFAULT '[]';
ALTER TABLE draft_run_schedules ADD COLUMN IF NOT EXISTS daily_featured_sets jsonb NOT NULL DEFAULT '[]';
-- The existing observation round ceiling of ten remains for historical runs.
CREATE OR REPLACE VIEW draft_run_measurements AS
SELECT o.*,s.player_id,s.environment,s.day,s.corpus_version,s.scoring_version,s.difficulty_version,s.selection_version,
  CASE WHEN s.day IS NOT NULL THEN 'daily' WHEN s.challenge_id IS NOT NULL THEN 'challenge' ELSE 'practice' END run_type,
  jsonb_array_length(s.answers)=jsonb_array_length(s.puzzle_ids) run_complete,
  s.measurement_qa OR p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)' is_qa,
  v.set_id,v.pick_number,r.rating,r.band,r.target_support_ratio<0.2 model_disagreement,
  o.outcome IS NULL AND jsonb_array_length(s.answers)<jsonb_array_length(s.puzzle_ids) AND greatest(o.last_seen_at,s.updated_at)<now()-interval '24 hours' likely_abandoned,
  NOT EXISTS (
    SELECT 1 FROM draft_run_decision_observations prior JOIN draft_run_sessions ps ON ps.id=prior.session_id
    WHERE prior.observed AND prior.puzzle_id=o.puzzle_id AND ps.player_id=s.player_id
      AND (prior.first_seen_at,prior.session_id,prior.revision)<(o.first_seen_at,o.session_id,o.revision)
  ) AND NOT EXISTS (
    SELECT 1 FROM draft_run_sessions old WHERE old.player_id=s.player_id AND old.id<>s.id AND old.created_at<s.created_at
      AND old.answers @> jsonb_build_array(jsonb_build_object('puzzle',jsonb_build_object('puzzle_id',o.puzzle_id)))
  ) first_encounter
FROM draft_run_decision_observations o
JOIN draft_run_sessions s ON s.id=o.session_id
JOIN players p ON p.id=s.player_id
JOIN draft_run_verified_puzzles v ON v.puzzle_id=o.puzzle_id
LEFT JOIN draft_run_puzzle_ratings r ON r.puzzle_id=o.puzzle_id AND r.difficulty_version=s.difficulty_version;

-- Auditable release-date weight snapshot; runtime uses the versioned JSON policy.
ALTER TABLE draft_run_environment_policy DROP CONSTRAINT IF EXISTS draft_run_environment_policy_daily_weight_check;
ALTER TABLE draft_run_environment_policy ADD CONSTRAINT draft_run_environment_policy_daily_weight_check CHECK(daily_weight BETWEEN 1 AND 6);
UPDATE draft_run_environment_policy SET selection_version='eight-pick-v3',daily_weight=1;
UPDATE draft_run_environment_policy p SET daily_weight=w.weight FROM (VALUES
('hob',6),
('msh',6),
('sos',6),
('tmt',4),
('ecl',4),
('tla',4),
('eoe',2),
('fin',2),
('tdm',2),
('dft',2),
('fdn',2),
('dsk',2),
('blb',1),
('mh3',1),
('otj',1),
('mkm',1),
('lci',1),
('woe',1),
('ltr',1),
('mom',1),
('one',1),
('bro',1),
('dmu',1),
('snc',1),
('neo',1),
('vow',1),
('mid',1),
('stx',1),
('ktk',1)) w(set_id,weight) WHERE p.set_id=w.set_id;
