-- First-party Pack One browser sessions. Raw session and CSRF values are never
-- persisted; only SHA-256 digests are stored. Existing Neon Auth sessions stay
-- available temporarily for the one-time browser migration path.
CREATE TABLE IF NOT EXISTS account_sessions (
  session_hash text PRIMARY KEY CHECK(session_hash ~ '^[a-f0-9]{64}$'),
  auth_user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS account_sessions_user_idx
  ON account_sessions(auth_user_id,expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS account_sessions_expiry_idx
  ON account_sessions(expires_at);
