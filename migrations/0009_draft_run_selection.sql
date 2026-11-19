-- First-pack provenance is established by both source extractors and their
-- trajectory validators; expose that audited invariant explicitly in storage.
ALTER TABLE draft_run_verified_puzzles ADD COLUMN IF NOT EXISTS pack_number smallint NOT NULL DEFAULT 1 CHECK(pack_number=1);
-- statement
ALTER TABLE draft_run_sessions ADD COLUMN IF NOT EXISTS selection_version text NOT NULL DEFAULT 'balanced-v1';
-- statement
ALTER TABLE draft_run_schedules ADD COLUMN IF NOT EXISTS selection_version text NOT NULL DEFAULT 'balanced-v1';
-- statement
CREATE TABLE IF NOT EXISTS draft_run_environment_policy (
  set_id text PRIMARY KEY REFERENCES draft_run_verified_sets(set_id),
  regular_run boolean NOT NULL,
  maximum_pick smallint NOT NULL CHECK(maximum_pick BETWEEN 1 AND 12),
  daily_weight numeric NOT NULL CHECK(daily_weight BETWEEN 1 AND 1.25),
  selection_version text NOT NULL
);
-- statement
CREATE OR REPLACE VIEW draft_run_eligible_decisions AS
SELECT p.puzzle_id,p.set_id,p.source_draft_hash,p.pack_number,p.pick_number,
  r.rating,r.band,r.difficulty_version,e.regular_run,e.daily_weight,e.selection_version
FROM draft_run_verified_puzzles p
JOIN draft_run_environment_policy e USING(set_id)
JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
WHERE p.corpus_version='elite-trophy-verified-v6' AND p.interesting AND p.pack_number=1 AND p.pick_number<=e.maximum_pick;

-- statement
INSERT INTO draft_run_environment_policy(set_id,regular_run,maximum_pick,daily_weight,selection_version) VALUES
('stx',true,10,1.00,'first-pack-v2'),
('mid',true,10,1.00,'first-pack-v2'),
('vow',true,10,1.00,'first-pack-v2'),
('neo',true,10,1.00,'first-pack-v2'),
('snc',true,10,1.00,'first-pack-v2'),
('hbg',false,10,1.00,'first-pack-v2'),
('dmu',true,10,1.00,'first-pack-v2'),
('bro',true,10,1.00,'first-pack-v2'),
('one',true,10,1.00,'first-pack-v2'),
('sir',false,10,1.00,'first-pack-v2'),
('mom',true,10,1.00,'first-pack-v2'),
('ltr',true,10,1.00,'first-pack-v2'),
('woe',true,10,1.00,'first-pack-v2'),
('lci',true,10,1.00,'first-pack-v2'),
('ktk',true,10,1.00,'first-pack-v2'),
('mkm',true,10,1.00,'first-pack-v2'),
('otj',true,10,1.00,'first-pack-v2'),
('mh3',true,10,1.00,'first-pack-v2'),
('blb',true,10,1.00,'first-pack-v2'),
('sos',true,10,1.25,'first-pack-v2'),
('dsk',true,10,1.10,'first-pack-v2'),
('fdn',true,10,1.10,'first-pack-v2'),
('pio',false,10,1.00,'first-pack-v2'),
('dft',true,10,1.10,'first-pack-v2'),
('tdm',true,10,1.10,'first-pack-v2'),
('fin',true,10,1.10,'first-pack-v2'),
('eoe',true,10,1.10,'first-pack-v2'),
('tla',true,10,1.25,'first-pack-v2'),
('hob',true,10,1.25,'first-pack-v2'),
('msh',true,10,1.25,'first-pack-v2'),
('tmt',true,10,1.25,'first-pack-v2'),
('ecl',true,10,1.25,'first-pack-v2'),
('powered-cube',false,11,1.00,'first-pack-v2')
ON CONFLICT(set_id) DO UPDATE SET regular_run=EXCLUDED.regular_run,maximum_pick=EXCLUDED.maximum_pick,daily_weight=EXCLUDED.daily_weight,selection_version=EXCLUDED.selection_version;

-- statement
ALTER TABLE draft_run_verified_puzzles ADD CONSTRAINT draft_run_first_pack_payload CHECK(COALESCE(payload->>'pack_number','1')='1') NOT VALID;
