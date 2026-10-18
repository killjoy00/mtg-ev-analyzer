-- Consent and occurrences are private account-owned data. Never create enabled rows
-- from guest or historical engagement data.
CREATE TABLE IF NOT EXISTS daily_reminder_settings (
  auth_user_id uuid PRIMARY KEY REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily','weekly','custom')),
  weekdays integer[] NOT NULL DEFAULT ARRAY[1]::integer[] CHECK (
    array_length(weekdays,1) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::integer[]),
  local_time varchar(5) NOT NULL DEFAULT '09:00' CHECK (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  time_zone text NOT NULL DEFAULT 'America/Chicago' CHECK (length(time_zone) BETWEEN 2 AND 80),
  email_enabled boolean NOT NULL DEFAULT false,
  push_enabled boolean NOT NULL DEFAULT false,
  email_consented_at timestamptz,
  push_consented_at timestamptz,
  schedule_version bigint NOT NULL DEFAULT 1,
  next_due_at timestamptz,
  unsubscribe_nonce uuid NOT NULL DEFAULT gen_random_uuid(),
  suppressed_email_hash char(64),
  suppressed_reason text CHECK (suppressed_reason IN ('bounce','complaint') OR suppressed_reason IS NULL),
  last_email_delivered_at timestamptz,
  last_push_accepted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT email_enabled OR email_consented_at IS NOT NULL),
  CHECK (NOT push_enabled OR push_consented_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS daily_reminder_settings_due_idx ON daily_reminder_settings(next_due_at)
 WHERE next_due_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS daily_reminder_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auth_user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK(channel IN ('email','push','schedule')),
  action text NOT NULL CHECK(action IN ('enable','disable','edit','bounce','complaint','unsubscribe')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_reminder_changes_owner_idx ON daily_reminder_changes(auth_user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS daily_reminder_devices (
  installation_id uuid PRIMARY KEY,
  auth_user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  session_hash text NOT NULL REFERENCES account_sessions(session_hash) ON DELETE CASCADE,
  platform text NOT NULL CHECK(platform IN ('ios','android')),
  token_hash char(64) NOT NULL UNIQUE,
  token_ciphertext text NOT NULL,
  revoked_at timestamptz,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_reminder_devices_owner_idx ON daily_reminder_devices(auth_user_id)
 WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS daily_reminder_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK(channel IN ('email','push')),
  installation_id uuid REFERENCES daily_reminder_devices(installation_id) ON DELETE CASCADE,
  local_day date NOT NULL,
  schedule_version bigint NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN (
    'queued','sending','retry','accepted','delivered','suppressed','uncertain','failed')),
  attempts smallint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  provider_id text UNIQUE,
  next_retry_at timestamptz,
  started_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_reminder_delivery_channel CHECK (
    (channel='email' AND installation_id IS NULL) OR
    (channel='push' AND installation_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (auth_user_id,channel,installation_id,local_day,schedule_version)
);
CREATE INDEX IF NOT EXISTS daily_reminder_deliveries_retry_idx
 ON daily_reminder_deliveries(next_retry_at) WHERE state='retry';
CREATE INDEX IF NOT EXISTS daily_reminder_deliveries_owner_idx
 ON daily_reminder_deliveries(auth_user_id,created_at DESC);
