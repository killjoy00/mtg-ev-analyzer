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
AS $$
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
$$;
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
CREATE OR REPLACE FUNCTION pack1_fill_creator_challenge_result()
RETURNS trigger
LANGUAGE plpgsql
AS $creator_result$
DECLARE
  run_id uuid;
BEGIN
  IF NEW.creator_challenge_id IS NULL
     AND NEW.mode='draft_run'
     AND NEW.client_result_id ~ '^draft-run:[0-9a-fA-F-]{36}$' THEN
    BEGIN
      run_id := split_part(NEW.client_result_id,':',2)::uuid;
      SELECT session.creator_challenge_id INTO NEW.creator_challenge_id
      FROM draft_run_sessions session
      WHERE session.id=run_id;
    EXCEPTION WHEN invalid_text_representation THEN
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$creator_result$;
-- statement
DROP TRIGGER IF EXISTS creator_challenge_result_fill ON game_results;
-- statement
CREATE TRIGGER creator_challenge_result_fill
BEFORE INSERT ON game_results
FOR EACH ROW EXECUTE FUNCTION pack1_fill_creator_challenge_result();
-- statement
CREATE OR REPLACE FUNCTION pack1_prepare_creator_challenge_player_merge()
RETURNS trigger
LANGUAGE plpgsql
AS $creator_merge$
DECLARE
  target_auth uuid;
  target_attempt_id uuid;
  duplicate_attempt boolean;
BEGIN
  IF NEW.player_id IS NOT DISTINCT FROM OLD.player_id OR OLD.creator_challenge_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT auth_user_id INTO target_auth
  FROM account_links
  WHERE player_id=NEW.player_id
  LIMIT 1;

  SELECT target.id INTO target_attempt_id
  FROM draft_run_sessions target
  WHERE target.id<>OLD.id
    AND target.creator_challenge_id=OLD.creator_challenge_id
    AND (
      target.player_id=NEW.player_id
      OR (target_auth IS NOT NULL AND target.creator_participant_auth_user_id=target_auth)
    )
  ORDER BY
    (target_auth IS NOT NULL AND target.creator_participant_auth_user_id=target_auth) DESC,
    (target.player_id=NEW.player_id) DESC,
    target.created_at,target.id
  LIMIT 1;

  duplicate_attempt=target_attempt_id IS NOT NULL;

  IF duplicate_attempt THEN
    UPDATE draft_run_sessions
    SET creator_participant_auth_user_id=COALESCE(creator_participant_auth_user_id,target_auth)
    WHERE id=target_attempt_id;


    -- merge_pack1_player copies the source result to NEW.player_id and deletes
    -- the source result before it updates draft_run_sessions. Demote that
    -- copied history in the same transaction while preserving its score/grade.
    UPDATE game_results
    SET creator_challenge_id=NULL,
        opponent_name=NULL,
        opponent_score=NULL,
        outcome=NULL
    WHERE player_id=NEW.player_id
      AND client_result_id='draft-run:'||OLD.id::text;

    -- Creator funnel starts are still attached to OLD.player_id at this point;
    -- remove only the duplicate attempt's run-scoped creator telemetry before
    -- merge_pack1_player moves the remaining analytics to the account player.
    DELETE FROM analytics_events
    WHERE player_id=OLD.player_id
      AND event_name IN ('creator_challenge_started','creator_challenge_complete')
      AND event_props->>'run_id'=OLD.id::text;

    NEW.creator_challenge_id=NULL;
    NEW.creator_participant_auth_user_id=NULL;
    NEW.start_idempotency_hash=NULL;
    NEW.start_request_hash=NULL;
  ELSE
    NEW.creator_participant_auth_user_id=COALESCE(NEW.creator_participant_auth_user_id,target_auth);
  END IF;

  RETURN NEW;
END;
$creator_merge$;
-- statement
DROP TRIGGER IF EXISTS creator_challenge_player_merge_guard ON draft_run_sessions;
-- statement
CREATE TRIGGER creator_challenge_player_merge_guard
BEFORE UPDATE OF player_id ON draft_run_sessions
FOR EACH ROW EXECUTE FUNCTION pack1_prepare_creator_challenge_player_merge();
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
