-- Short-lived account-deletion verification for passwordless accounts.
-- One authenticated Auth user has at most one active code. New issuance replaces
-- the prior row; the code itself is never stored, only its keyed HMAC.
CREATE TABLE IF NOT EXISTS account_deletion_verifications (
  auth_user_id uuid PRIMARY KEY,
  code_hmac text NOT NULL CHECK (code_hmac ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS account_deletion_verifications_expiry_idx
  ON account_deletion_verifications(expires_at);
