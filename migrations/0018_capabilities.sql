-- Provider-independent, revocable capability grants. Account and regular
-- practice are derived from authenticated account identity, never a paid tier.
CREATE TABLE IF NOT EXISTS entitlement_grants (
  auth_user_id uuid NOT NULL,
  capability text NOT NULL CHECK(capability IN ('unlimited_cube_practice','custom_corpus')),
  provider text NOT NULL,
  provider_reference text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY(auth_user_id,capability,provider,provider_reference)
);
ALTER TABLE draft_run_sessions ADD COLUMN IF NOT EXISTS custom_set_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(custom_set_ids)='array');
