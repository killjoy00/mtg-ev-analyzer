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
