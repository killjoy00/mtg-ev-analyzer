-- Durable secure-account deletion state for Issue #179C1.
-- Tombstones deliberately have no foreign key to Auth or player rows: they must
-- survive deletion and permanently deny stale identity/session restoration.
CREATE TABLE IF NOT EXISTS account_deletion_operations (
  operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE,
  player_id uuid,
  state text NOT NULL CHECK (state IN (
    'pending',
    'app_cleanup_complete',
    'provider_delete_pending',
    'provider_deleted',
    'complete',
    'operator_review'
  )),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  app_cleanup_completed_at timestamptz,
  provider_deleted_at timestamptz,
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_player_tombstone_uq
  ON account_deletion_operations(player_id)
  WHERE player_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS account_deletion_nonterminal_idx
  ON account_deletion_operations(updated_at, operation_id)
  WHERE state <> 'complete';

-- Identity attachment/deletion serialization must take a fresh visibility
-- snapshot after waiting on the per-Auth-user advisory lock. Keeping the lock
-- and tombstone check inside one caller statement can retain a pre-wait
-- READ COMMITTED snapshot and miss a deletion that committed while blocked.
CREATE OR REPLACE FUNCTION pack1_identity_attachment_allowed(p_auth_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
AS $pack1$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_auth_user_id::text,0));
  RETURN NOT EXISTS (
    SELECT 1
    FROM account_deletion_operations
    WHERE auth_user_id=p_auth_user_id
      AND state IN ('pending','app_cleanup_complete','provider_delete_pending','provider_deleted','complete','operator_review')
  );
END;
$pack1$;

CREATE OR REPLACE FUNCTION pack1_begin_account_deletion(p_auth_user_id uuid,p_player_id uuid DEFAULT NULL)
RETURNS SETOF account_deletion_operations
LANGUAGE plpgsql
VOLATILE
AS $pack1$
DECLARE
  resolved_player uuid;
  op account_deletion_operations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_auth_user_id::text,0));

  SELECT a.player_id INTO resolved_player
  FROM account_links a
  WHERE a.auth_user_id=p_auth_user_id
  LIMIT 1;

  INSERT INTO account_deletion_operations(auth_user_id,player_id,state)
  VALUES(p_auth_user_id,COALESCE(p_player_id,resolved_player),'pending')
  ON CONFLICT(auth_user_id) DO UPDATE SET
    updated_at=account_deletion_operations.updated_at
  RETURNING account_deletion_operations.* INTO op;

  UPDATE account_sessions
  SET revoked_at=COALESCE(revoked_at,now())
  WHERE auth_user_id=p_auth_user_id AND revoked_at IS NULL;

  RETURN NEXT op;
END;
$pack1$;


-- Reuse the signed-in credential limiter storage for destructive verification
-- and deletion initiation. The account UUID and authenticated gateway network
-- HMAC are the only identity dimensions; raw network data is never stored.
DO $$ BEGIN
  ALTER TABLE account_credential_rate_limits
    DROP CONSTRAINT IF EXISTS account_credential_rate_limits_purpose_check;
  ALTER TABLE account_credential_rate_limits
    ADD CONSTRAINT account_credential_rate_limits_purpose_check CHECK (purpose IN (
      'current_password',
      'password_change_network',
      'account_delete_verify',
      'account_delete_network',
      'account_delete_init'
    ));
END $$;
