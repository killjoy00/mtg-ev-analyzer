-- Beat the Creator: durable campaign metadata plus explicit challenger association.
-- Gameplay authority stays in draft_run_sessions; this table only promotes one
-- immutable completed source run and stores sanitized campaign presentation data.
CREATE TABLE IF NOT EXISTS creator_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (
    length(slug) BETWEEN 1 AND 64
    AND slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'
  ),
  source_session_id uuid REFERENCES draft_run_sessions(id) ON DELETE SET NULL,
  source_owner_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  source_owner_auth_user_id uuid,
  source_share_id text REFERENCES draft_run_shares(id) ON DELETE SET NULL,
  source_type text NOT NULL CHECK (source_type IN ('practice','daily')),
  source_day date,
  source_environment text NOT NULL CHECK (source_environment IN ('mixed','powered-cube','latest')),
  creator_public_name text,
  creator_handle text,
  headline text,
  creator_post_run_note text CHECK (
    creator_post_run_note IS NULL OR length(creator_post_run_note) BETWEEN 1 AND 500
  ),
  acquisition_source text NOT NULL,
  acquisition_campaign text NOT NULL,
  acquisition_medium text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','publishing','published','failed','retired')),
  publication_operation_ref uuid,
  publication_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  publication_error text,
  created_by_admin_auth_user_id uuid NOT NULL,
  published_by_admin_auth_user_id uuid,
  retired_by_admin_auth_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  retired_at timestamptz,
  privacy_removed_at timestamptz,
  CHECK (
    (source_type='practice' AND source_day IS NULL)
    OR (source_type='daily' AND source_day IS NOT NULL)
  )
);
-- statement
CREATE INDEX IF NOT EXISTS creator_challenges_source_idx
  ON creator_challenges(source_session_id);
-- statement
CREATE INDEX IF NOT EXISTS creator_challenges_owner_idx
  ON creator_challenges(source_owner_player_id,status,created_at DESC);
-- statement
CREATE INDEX IF NOT EXISTS creator_challenges_status_idx
  ON creator_challenges(status,created_at DESC);
-- statement
CREATE OR REPLACE FUNCTION pack1_sync_creator_challenge_source_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $
BEGIN
  IF NEW.player_id IS DISTINCT FROM OLD.player_id THEN
    UPDATE creator_challenges
    SET source_owner_player_id=NEW.player_id,
        source_owner_auth_user_id=COALESCE(
          (SELECT auth_user_id FROM account_links WHERE player_id=NEW.player_id LIMIT 1),
          source_owner_auth_user_id
        ),
        updated_at=now()
    WHERE source_session_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$;
-- statement
DROP TRIGGER IF EXISTS creator_challenge_source_owner_sync ON draft_run_sessions;
-- statement
CREATE TRIGGER creator_challenge_source_owner_sync
AFTER UPDATE OF player_id ON draft_run_sessions
FOR EACH ROW EXECUTE FUNCTION pack1_sync_creator_challenge_source_owner();
-- statement
ALTER TABLE draft_run_sessions
  ADD COLUMN IF NOT EXISTS creator_challenge_id uuid;
-- statement
ALTER TABLE draft_run_sessions
  ADD COLUMN IF NOT EXISTS creator_participant_auth_user_id uuid;
-- statement
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='draft_run_sessions_creator_challenge_fk'
      AND conrelid='draft_run_sessions'::regclass
  ) THEN
    ALTER TABLE draft_run_sessions
      ADD CONSTRAINT draft_run_sessions_creator_challenge_fk
      FOREIGN KEY (creator_challenge_id) REFERENCES creator_challenges(id) ON DELETE SET NULL;
  END IF;
END $$;
-- statement
CREATE UNIQUE INDEX IF NOT EXISTS draft_run_creator_challenge_participant_uq
  ON draft_run_sessions(creator_challenge_id,creator_participant_auth_user_id)
  WHERE creator_challenge_id IS NOT NULL AND creator_participant_auth_user_id IS NOT NULL;
-- statement
CREATE INDEX IF NOT EXISTS draft_run_creator_challenge_idx
  ON draft_run_sessions(creator_challenge_id,created_at DESC)
  WHERE creator_challenge_id IS NOT NULL;
-- statement
ALTER TABLE game_results
  ADD COLUMN IF NOT EXISTS creator_challenge_id uuid;
-- statement
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='game_results_creator_challenge_fk'
      AND conrelid='game_results'::regclass
  ) THEN
    ALTER TABLE game_results
      ADD CONSTRAINT game_results_creator_challenge_fk
      FOREIGN KEY (creator_challenge_id) REFERENCES creator_challenges(id) ON DELETE SET NULL;
  END IF;
END $$;
-- statement
CREATE INDEX IF NOT EXISTS game_results_creator_challenge_idx
  ON game_results(creator_challenge_id,played_at DESC)
  WHERE creator_challenge_id IS NOT NULL;
-- statement
CREATE TABLE IF NOT EXISTS creator_challenge_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creator_challenge_id uuid NOT NULL REFERENCES creator_challenges(id) ON DELETE CASCADE,
  admin_auth_user_id uuid,
  action text NOT NULL CHECK (action IN ('created','publish_requested','published','publish_failed','retired','privacy_retired')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- statement
CREATE INDEX IF NOT EXISTS creator_challenge_audit_challenge_idx
  ON creator_challenge_audit(creator_challenge_id,created_at DESC);
