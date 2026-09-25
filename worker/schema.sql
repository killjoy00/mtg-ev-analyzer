CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 24),
  profile_key text NOT NULL DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 16),
  profile_public boolean NOT NULL DEFAULT false,
  username_owned boolean NOT NULL DEFAULT false,
  favorite_set_id text,
  showcase_achievement text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS players_profile_key_uq ON players(profile_key);
CREATE INDEX IF NOT EXISTS players_public_profile_idx ON players(profile_key) WHERE profile_public = true;
CREATE INDEX IF NOT EXISTS players_public_name_idx ON players(lower(display_name)) WHERE profile_public;

-- Owned usernames are unique case-insensitively; anonymous nicknames and the
-- generic placeholder are not. See migrations/0033_unique_usernames.sql for why
-- `username_owned` gates the index, and worker/username.mjs for the application
-- mirror of this key.
CREATE OR REPLACE FUNCTION pack1_username_key(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $pack1$
  SELECT lower(btrim(regexp_replace(value, '\s+', ' ', 'g')))
$pack1$;

CREATE UNIQUE INDEX IF NOT EXISTS players_username_uq
  ON players (pack1_username_key(display_name))
  WHERE username_owned AND pack1_username_key(display_name) <> 'pack player';

CREATE TABLE IF NOT EXISTS scores (
  id bigserial PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  challenge_date date NOT NULL,
  set_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('top3', 'full')),
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  grade text NOT NULL,
  top1 text,
  top2 text,
  top3 text,
  selections_json jsonb NOT NULL,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(player_id, challenge_date, set_id, mode)
);

CREATE INDEX IF NOT EXISTS scores_board_idx ON scores(challenge_date, set_id, mode, score DESC);
CREATE INDEX IF NOT EXISTS scores_featured_idx ON scores(is_featured, challenge_date, mode, score DESC);
CREATE INDEX IF NOT EXISTS scores_player_idx ON scores(player_id, challenge_date DESC);

CREATE TABLE IF NOT EXISTS share_challenges (
  id text PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  set_id text NOT NULL,
  set_name text NOT NULL,
  pack_json jsonb NOT NULL,
  historical_id text NOT NULL DEFAULT '',
  selected_json jsonb NOT NULL,
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  grade text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS share_challenges_created_idx ON share_challenges(created_at DESC);

INSERT INTO settings(key, value)
VALUES ('player_secret', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text))
ON CONFLICT (key) DO NOTHING;


CREATE TABLE IF NOT EXISTS account_recovery_rate_limits (
  limit_key text PRIMARY KEY CHECK (limit_key ~ '^[a-f0-9]{64}$'),
  attempts integer NOT NULL CHECK (attempts > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS account_recovery_rate_limits_expiry_idx ON account_recovery_rate_limits(expires_at);

CREATE TABLE IF NOT EXISTS account_credential_rate_limits (
  auth_user_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN (
    'current_password',
    'password_change_network',
    'account_delete_verify',
    'account_delete_network',
    'account_delete_init'
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


-- Issue #179C1 durable deletion/tombstone state.
CREATE TABLE IF NOT EXISTS account_deletion_operations (
  operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE,
  player_id uuid,
  state text NOT NULL CHECK (state IN ('pending','app_cleanup_complete','provider_delete_pending','provider_deleted','complete','operator_review')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  app_cleanup_completed_at timestamptz,
  provider_deleted_at timestamptz,
  completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_player_tombstone_uq
  ON account_deletion_operations(player_id) WHERE player_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_deletion_nonterminal_idx
  ON account_deletion_operations(updated_at,operation_id) WHERE state <> 'complete';

-- Short-lived proof for passwordless account deletion. Only a keyed HMAC is
-- persisted; a resend replaces the single row for the authenticated Auth UUID.
CREATE TABLE IF NOT EXISTS account_deletion_verifications (
  auth_user_id uuid PRIMARY KEY,
  code_hmac text NOT NULL CHECK (code_hmac ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS account_deletion_verifications_expiry_idx
  ON account_deletion_verifications(expires_at);

-- Identity attachment/deletion serialization must take a fresh visibility
-- snapshot after waiting on the per-Auth-user advisory lock. Keeping the lock
-- and tombstone check inside one caller statement can retain a pre-wait
-- READ COMMITTED snapshot and miss a deletion that committed while blocked.
CREATE OR REPLACE FUNCTION pack1_identity_attachment_allowed(p_auth_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
AS $pack1$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_auth_user_id::text,0));
  RETURN NOT EXISTS (
    SELECT 1
    FROM account_deletion_operations
    WHERE auth_user_id=p_auth_user_id
      AND state IN ('pending','app_cleanup_complete','provider_delete_pending','provider_deleted','complete','operator_review')
  );
END;
$pack1$;

CREATE OR REPLACE FUNCTION pack1_begin_account_deletion(p_auth_user_id uuid,p_player_id uuid DEFAULT NULL)
RETURNS SETOF account_deletion_operations
LANGUAGE plpgsql
VOLATILE
AS $pack1$
DECLARE
  resolved_player uuid;
  op account_deletion_operations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_auth_user_id::text,0));

  SELECT a.player_id INTO resolved_player
  FROM account_links a
  WHERE a.auth_user_id=p_auth_user_id
  LIMIT 1;

  INSERT INTO account_deletion_operations(auth_user_id,player_id,state)
  VALUES(p_auth_user_id,COALESCE(p_player_id,resolved_player),'pending')
  ON CONFLICT(auth_user_id) DO UPDATE SET
    updated_at=account_deletion_operations.updated_at
  RETURNING account_deletion_operations.* INTO op;

  UPDATE account_sessions
  SET revoked_at=COALESCE(revoked_at,now())
  WHERE auth_user_id=p_auth_user_id AND revoked_at IS NULL;

  RETURN NEXT op;
END;
$pack1$;



-- Short-lived native OAuth bridge; only token digests are persisted.
CREATE TABLE IF NOT EXISTS mobile_oauth_handoffs (
  flow_hash text PRIMARY KEY CHECK(flow_hash ~ '^[a-f0-9]{64}$'),
  handoff_hash text UNIQUE CHECK(handoff_hash IS NULL OR handoff_hash ~ '^[a-f0-9]{64}$'),
  guest_player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  auth_user_id uuid REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK(provider IN ('google','apple')),
  flow_kind text NOT NULL DEFAULT 'mobile' CHECK(flow_kind IN ('mobile','web')),
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
  ON mobile_oauth_handoffs(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS apple_auth_identities (
  apple_subject text PRIMARY KEY CHECK(length(apple_subject) BETWEEN 1 AND 255),
  auth_user_id uuid NOT NULL UNIQUE REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  email text NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
  first_name text,
  synthetic_password boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS apple_auth_tokens (
  apple_subject text NOT NULL REFERENCES apple_auth_identities(apple_subject) ON DELETE CASCADE,
  client_id text NOT NULL CHECK(client_id IN ('pro.packone.app','pro.packone.web')),
  refresh_token_ciphertext text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY(apple_subject,client_id)
);
CREATE INDEX IF NOT EXISTS apple_auth_tokens_active_idx
  ON apple_auth_tokens(apple_subject,client_id) WHERE revoked_at IS NULL;
