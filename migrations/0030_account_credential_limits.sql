-- Signed-in credential-management throttling for Issue #179B.
-- auth_user_id is the stable authenticated account dimension and is deliberately
-- stored directly. network_hash is either empty for the account-global bucket
-- or a gateway-produced HMAC digest; raw network identifiers are never stored.
CREATE TABLE IF NOT EXISTS account_credential_rate_limits (
  auth_user_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN (
    'current_password',
    'password_change_network'
  )),
  network_hash text NOT NULL DEFAULT '' CHECK (
    network_hash = '' OR network_hash ~ '^[a-f0-9]{64}$'
  ),
  attempts integer NOT NULL CHECK (attempts > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (auth_user_id, purpose, network_hash)
);

CREATE INDEX IF NOT EXISTS account_credential_rate_limits_expiry_idx
  ON account_credential_rate_limits(expires_at);
