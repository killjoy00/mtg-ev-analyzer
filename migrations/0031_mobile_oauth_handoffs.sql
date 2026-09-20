-- One-time native OAuth bridge. Neither the OAuth flow token nor the final
-- handoff token is stored in plaintext. The handoff stays bound to the Pack One
-- player identity that initiated the system-browser sign-in.
CREATE TABLE IF NOT EXISTS mobile_oauth_handoffs (
  flow_hash text PRIMARY KEY CHECK(flow_hash ~ '^[a-f0-9]{64}$'),
  handoff_hash text UNIQUE CHECK(handoff_hash IS NULL OR handoff_hash ~ '^[a-f0-9]{64}$'),
  guest_player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  auth_user_id uuid REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK(provider IN ('google','apple')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  authenticated_at timestamptz,
  consumed_at timestamptz,
  CHECK(expires_at > created_at),
  CHECK(
    (authenticated_at IS NULL AND auth_user_id IS NULL AND handoff_hash IS NULL)
    OR
    (authenticated_at IS NOT NULL AND auth_user_id IS NOT NULL AND handoff_hash IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS mobile_oauth_handoffs_expiry_idx
  ON mobile_oauth_handoffs(expires_at)
  WHERE consumed_at IS NULL;
