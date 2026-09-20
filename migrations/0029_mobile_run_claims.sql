-- Native guest-run claim tokens are short-lived, hashed at rest and one-use.
-- guest_player_id deliberately remains a UUID value rather than a players FK:
-- account linking can merge/delete the guest player before the claim is
-- atomically consumed against the moved Draft Run session.
CREATE TABLE IF NOT EXISTS mobile_run_claims (
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  run_id uuid NOT NULL UNIQUE REFERENCES draft_run_sessions(id) ON DELETE CASCADE,
  guest_player_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK(expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS mobile_run_claims_expiry_idx
  ON mobile_run_claims(expires_at)
  WHERE consumed_at IS NULL;
