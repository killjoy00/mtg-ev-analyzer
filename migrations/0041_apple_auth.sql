-- First-party Sign in with Apple identity and revocable token storage.
-- Apple subjects remain provider-stable identifiers; refresh tokens are encrypted
-- in application code before reaching Postgres.
CREATE TABLE IF NOT EXISTS apple_auth_identities (
  apple_subject text PRIMARY KEY CHECK(length(apple_subject) BETWEEN 1 AND 255),
  auth_user_id uuid NOT NULL UNIQUE REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  email text NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
  first_name text,
  last_name text,
  synthetic_password boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE apple_auth_identities
  ADD COLUMN IF NOT EXISTS last_name text;

CREATE TABLE IF NOT EXISTS apple_auth_tokens (
  apple_subject text NOT NULL REFERENCES apple_auth_identities(apple_subject) ON DELETE CASCADE,
  client_id text NOT NULL CHECK(client_id IN ('pro.packone.app','pro.packone.web')),
  refresh_token_ciphertext text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY(apple_subject,client_id)
);

CREATE INDEX IF NOT EXISTS apple_auth_tokens_active_idx
  ON apple_auth_tokens(apple_subject,client_id)
  WHERE revoked_at IS NULL;

ALTER TABLE mobile_oauth_handoffs
  ADD COLUMN IF NOT EXISTS flow_kind text NOT NULL DEFAULT 'mobile';

DO $$ BEGIN
  ALTER TABLE mobile_oauth_handoffs
    ADD CONSTRAINT mobile_oauth_handoffs_flow_kind_check
    CHECK(flow_kind IN ('mobile','web'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
