-- Additive operational state; existing sessions, schedules and corpus are retained.
ALTER TABLE draft_run_environment_policy ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Candidate' CHECK(status IN ('Candidate','Live','Paused','Retired'));
ALTER TABLE draft_run_environment_policy ADD COLUMN IF NOT EXISTS release_date date;
ALTER TABLE draft_run_environment_policy ADD COLUMN IF NOT EXISTS set_name text;
ALTER TABLE draft_run_environment_policy ADD COLUMN IF NOT EXISTS source_event_type text NOT NULL DEFAULT 'PremierDraft';
ALTER TABLE draft_run_environment_policy ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now();
-- One-time migration of the reviewed serving snapshot; future inserts stay Candidate.
UPDATE draft_run_environment_policy p SET status='Live',release_date=s.release_date::date,set_name=s.set_name
FROM (VALUES
('hob','The Hobbit','2026-08-14'),
('msh','Marvel Super Heroes','2026-06-26'),
('sos','Secrets of Strixhaven','2026-04-24'),
('tmt','Teenage Mutant Ninja Turtles','2026-03-06'),
('ecl','Lorwyn Eclipsed','2026-01-23'),
('tla','Avatar: The Last Airbender','2025-11-21'),
('eoe','Edge of Eternities','2025-08-01'),
('fin','Final Fantasy','2025-06-13'),
('tdm','Tarkir: Dragonstorm','2025-04-11'),
('dft','Aetherdrift','2025-02-14'),
('fdn','Foundations','2024-11-15'),
('dsk','Duskmourn: House of Horror','2024-09-27'),
('blb','Bloomburrow','2024-08-02'),
('mh3','Modern Horizons 3','2024-06-14'),
('otj','Outlaws of Thunder Junction','2024-04-19'),
('mkm','Murders at Karlov Manor','2024-02-09'),
('ktk','Khans of Tarkir','2014-09-26'),
('lci','The Lost Caverns of Ixalan','2023-11-17'),
('woe','Wilds of Eldraine','2023-09-08'),
('ltr','The Lord of the Rings: Tales of Middle-earth','2023-06-23'),
('mom','March of the Machine','2023-04-21'),
('one','Phyrexia: All Will Be One','2023-02-10'),
('bro','The Brothers'' War','2022-11-18'),
('dmu','Dominaria United','2022-09-09'),
('snc','Streets of New Capenna','2022-04-29'),
('neo','Kamigawa: Neon Dynasty','2022-02-18'),
('vow','Innistrad: Crimson Vow','2021-11-19'),
('mid','Innistrad: Midnight Hunt','2021-09-24')) s(set_id,set_name,release_date) WHERE p.set_id=s.set_id AND p.release_date IS NULL;
UPDATE draft_run_environment_policy SET status='Live',set_name='Powered Cube' WHERE set_id='powered-cube' AND set_name IS NULL;

CREATE TABLE IF NOT EXISTS corpus_status_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 set_id text NOT NULL,
 auth_user_id uuid,
 changed_at timestamptz NOT NULL DEFAULT now(),
 old_status text NOT NULL,
 new_status text NOT NULL CHECK(new_status IN ('Candidate','Live','Paused','Retired')),
 reason text
);
ALTER TABLE draft_run_schedules ADD COLUMN IF NOT EXISTS scoring_version text NOT NULL DEFAULT 'trophy-consensus-v3';
ALTER TABLE draft_run_sessions ADD COLUMN IF NOT EXISTS daily_account_id uuid;
ALTER TABLE draft_run_sessions ADD COLUMN IF NOT EXISTS leaderboard_eligible boolean NOT NULL DEFAULT false;
-- Preserve account first-attempt identity without changing answers or scores.
UPDATE draft_run_sessions s SET daily_account_id=a.auth_user_id FROM account_links a
WHERE s.player_id=a.player_id AND s.day IS NOT NULL AND s.daily_account_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS draft_run_account_daily_unique ON draft_run_sessions(daily_account_id,day,environment) WHERE day IS NOT NULL AND daily_account_id IS NOT NULL;
