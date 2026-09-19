-- Link authenticated Pack One accounts to external entitlement providers without
-- making the provider the application's authentication system. OAuth tokens are
-- deliberately not persisted; webhooks maintain current membership state.
CREATE TABLE IF NOT EXISTS provider_accounts (
  auth_user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK(provider ~ '^[a-z0-9-]{2,40}$'),
  provider_user_id text NOT NULL,
  provider_member_id text,
  provider_campaign_id text,
  membership_status text,
  currently_entitled_amount_cents integer CHECK(currently_entitled_amount_cents IS NULL OR currently_entitled_amount_cents >= 0),
  is_free_trial boolean NOT NULL DEFAULT false,
  is_gifted boolean NOT NULL DEFAULT false,
  tier_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(tier_ids)='array'),
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(auth_user_id,provider),
  UNIQUE(provider,provider_user_id),
  UNIQUE(provider,provider_member_id)
);

CREATE TABLE IF NOT EXISTS provider_oauth_states (
  state_hash text PRIMARY KEY CHECK(state_hash ~ '^[a-f0-9]{64}$'),
  auth_user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK(provider ~ '^[a-z0-9-]{2,40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS provider_oauth_states_expiry_idx ON provider_oauth_states(expires_at);
