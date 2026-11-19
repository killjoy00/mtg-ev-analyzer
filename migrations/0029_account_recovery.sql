-- Anonymous password-recovery throttling. Identity is a server-secret HMAC of
-- normalized email; raw email is never persisted for rate limiting.
CREATE TABLE IF NOT EXISTS account_recovery_rate_limits (
  limit_key text PRIMARY KEY CHECK (limit_key ~ '^[a-f0-9]{64}$'),
  attempts integer NOT NULL CHECK (attempts > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS account_recovery_rate_limits_expiry_idx
  ON account_recovery_rate_limits(expires_at);
