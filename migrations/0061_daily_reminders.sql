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
  token_hash char(64) NOT NULL,
  token_ciphertext text NOT NULL,
  revoked_at timestamptz,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_reminder_devices_live_token_uq
 ON daily_reminder_devices(token_hash) WHERE revoked_at IS NULL;
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
  push_receipt_checked_at timestamptz,
  push_receipt_result text CHECK(push_receipt_result IN ('platform_accepted','invalid_token','provider_rejected','receipt_expired')),
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

CREATE INDEX IF NOT EXISTS daily_reminder_deliveries_receipt_idx
 ON daily_reminder_deliveries(accepted_at) WHERE channel='push' AND state='accepted' AND push_receipt_checked_at IS NULL;

-- Additive replay support for development branches that already applied an
-- earlier draft of this unmerged migration. Never infer consent from history.
ALTER TABLE daily_reminder_settings ADD COLUMN IF NOT EXISTS email_destination_hash text;
ALTER TABLE daily_reminder_devices ADD COLUMN IF NOT EXISTS registration_version bigint NOT NULL DEFAULT 1;
ALTER TABLE daily_reminder_devices ADD COLUMN IF NOT EXISTS binding_secret_hash text;
ALTER TABLE daily_reminder_deliveries ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE daily_reminder_deliveries ADD COLUMN IF NOT EXISTS game_day date;
ALTER TABLE daily_reminder_deliveries ADD COLUMN IF NOT EXISTS destination_hash text;
ALTER TABLE daily_reminder_deliveries ADD COLUMN IF NOT EXISTS device_version bigint;
ALTER TABLE daily_reminder_deliveries ADD COLUMN IF NOT EXISTS device_session_hash text;
ALTER TABLE daily_reminder_deliveries ADD COLUMN IF NOT EXISTS device_token_hash text;
ALTER TABLE daily_reminder_deliveries ADD COLUMN IF NOT EXISTS request_hash text;
ALTER TABLE daily_reminder_deliveries ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE daily_reminder_deliveries ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE daily_reminder_changes ADD COLUMN IF NOT EXISTS schedule jsonb;
UPDATE daily_reminder_deliveries SET due_at=created_at WHERE due_at IS NULL;
UPDATE daily_reminder_deliveries SET game_day=(due_at AT TIME ZONE 'America/Los_Angeles')::date WHERE game_day IS NULL;
ALTER TABLE daily_reminder_deliveries ALTER COLUMN due_at SET DEFAULT now();
ALTER TABLE daily_reminder_deliveries ALTER COLUMN due_at SET NOT NULL;

-- The queue may contain successive edited schedules, but dispatch admission is
-- independent of schedule_version. Both the account's local date and the real
-- Pacific Daily identity are consumed by the same durable delivery claim.
CREATE TABLE IF NOT EXISTS daily_reminder_dispatch_claims (
  delivery_id uuid PRIMARY KEY REFERENCES daily_reminder_deliveries(id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK(channel IN ('email','push')),
  installation_id uuid,
  local_day date NOT NULL,
  game_day date NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT(auth_user_id,channel,installation_id,local_day),
  UNIQUE NULLS NOT DISTINCT(auth_user_id,channel,installation_id,game_day)
);
CREATE TABLE IF NOT EXISTS daily_reminder_email_suppressions (
  auth_user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  destination_hash text NOT NULL CHECK(destination_hash ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK(reason IN ('bounce','complaint')),
  first_event_at timestamptz NOT NULL,
  last_event_at timestamptz NOT NULL,
  PRIMARY KEY(auth_user_id,destination_hash)
);
CREATE TABLE IF NOT EXISTS daily_reminder_provider_events (
  event_id text PRIMARY KEY CHECK(length(event_id) BETWEEN 1 AND 200),
  provider_id text NOT NULL CHECK(length(provider_id) BETWEEN 1 AND 200),
  delivery_hint uuid,
  auth_user_id uuid REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  destination_hash text,
  event_type text NOT NULL CHECK(event_type IN ('email.sent','email.delivered','email.bounced','email.complained')),
  event_at timestamptz NOT NULL,
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','applied','ignored')),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS daily_reminder_provider_events_pending_idx ON daily_reminder_provider_events(created_at) WHERE state='pending';
CREATE INDEX IF NOT EXISTS daily_reminder_provider_events_delivery_idx ON daily_reminder_provider_events(delivery_hint);
CREATE INDEX IF NOT EXISTS daily_reminder_deliveries_queue_idx ON daily_reminder_deliveries(due_at) WHERE state IN ('queued','retry');
CREATE TABLE IF NOT EXISTS daily_reminder_rate_limits (
  channel text NOT NULL CHECK(channel IN ('email','push')),
  period text NOT NULL CHECK(period IN ('second','minute')),
  bucket timestamptz NOT NULL,
  used integer NOT NULL CHECK(used BETWEEN 0 AND 120),
  PRIMARY KEY(channel,period,bucket)
);

-- Serialize with the existing deletion tombstone using its established lock,
-- then take fresh snapshots inside VOLATILE functions. A pre-wait caller CTE
-- snapshot is not sufficient to enforce the deletion race boundary.
CREATE OR REPLACE FUNCTION pack1_reminder_save_settings(
  p_auth uuid,p_frequency text,p_weekdays integer[],p_time text,p_zone text,
  p_channel text,p_enabled boolean,p_next timestamptz,p_destination_hash text,p_email text
) RETURNS SETOF daily_reminder_settings LANGUAGE plpgsql VOLATILE AS $pack1$
DECLARE old daily_reminder_settings%ROWTYPE; saved daily_reminder_settings%ROWTYPE;
  schedule_changed boolean; channel_changed boolean; audit_action text;
BEGIN
  IF NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN; END IF;
  PERFORM 1 FROM neon_auth."user" WHERE id=p_auth FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_channel NOT IN ('email','push') OR p_enabled IS NULL OR p_frequency NOT IN ('daily','weekly','custom')
    OR cardinality(p_weekdays) NOT BETWEEN 1 AND 7 OR array_position(p_weekdays,NULL) IS NOT NULL
    OR NOT p_weekdays <@ ARRAY[0,1,2,3,4,5,6] OR cardinality(p_weekdays)<>(SELECT count(DISTINCT x) FROM unnest(p_weekdays) x)
    OR (p_frequency='weekly' AND cardinality(p_weekdays)<>1)
    OR p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_zone)
    THEN RAISE EXCEPTION 'REMINDER_INVALID_SCHEDULE'; END IF;
  IF p_enabled AND p_channel='email' THEN
    IF p_destination_hash IS NULL OR p_destination_hash !~ '^[a-f0-9]{64}$'
      OR NOT EXISTS(SELECT 1 FROM neon_auth."user" WHERE id=p_auth AND "emailVerified" IS TRUE
        AND lower(btrim(email))=lower(btrim(p_email))) THEN RAISE EXCEPTION 'REMINDER_EMAIL_UNVERIFIED'; END IF;
    IF EXISTS(SELECT 1 FROM daily_reminder_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_destination_hash)
      OR EXISTS(SELECT 1 FROM daily_reminder_settings WHERE auth_user_id=p_auth AND suppressed_email_hash::text=p_destination_hash)
      THEN RAISE EXCEPTION 'REMINDER_EMAIL_SUPPRESSED'; END IF;
  END IF;
  IF p_enabled AND p_channel='push' AND NOT EXISTS(
    SELECT 1 FROM daily_reminder_devices d JOIN account_sessions a ON a.session_hash=d.session_hash AND a.auth_user_id=d.auth_user_id
    WHERE d.auth_user_id=p_auth AND d.revoked_at IS NULL AND a.revoked_at IS NULL AND a.expires_at>clock_timestamp()
  ) THEN RAISE EXCEPTION 'REMINDER_DEVICE_REQUIRED'; END IF;
  SELECT * INTO old FROM daily_reminder_settings WHERE auth_user_id=p_auth FOR UPDATE;
  schedule_changed:=old.auth_user_id IS NULL OR (old.frequency,old.weekdays,old.local_time,old.time_zone)
    IS DISTINCT FROM (p_frequency,p_weekdays,p_time,p_zone);
  channel_changed:=old.auth_user_id IS NULL OR CASE WHEN p_channel='email'
    THEN old.email_enabled IS DISTINCT FROM p_enabled OR (p_enabled AND old.email_destination_hash IS DISTINCT FROM p_destination_hash)
    ELSE old.push_enabled IS DISTINCT FROM p_enabled END;
  INSERT INTO daily_reminder_settings(auth_user_id,frequency,weekdays,local_time,time_zone,
    email_enabled,push_enabled,email_consented_at,push_consented_at,email_destination_hash,next_due_at)
  VALUES(p_auth,p_frequency,p_weekdays,p_time,p_zone,p_channel='email' AND p_enabled,p_channel='push' AND p_enabled,
    CASE WHEN p_channel='email' AND p_enabled THEN clock_timestamp() END,
    CASE WHEN p_channel='push' AND p_enabled THEN clock_timestamp() END,
    CASE WHEN p_channel='email' AND p_enabled THEN p_destination_hash END,CASE WHEN p_enabled THEN p_next END)
  ON CONFLICT(auth_user_id) DO UPDATE SET
    frequency=p_frequency,weekdays=p_weekdays,local_time=p_time,time_zone=p_zone,
    email_enabled=CASE WHEN p_channel='email' THEN p_enabled ELSE daily_reminder_settings.email_enabled END,
    push_enabled=CASE WHEN p_channel='push' THEN p_enabled ELSE daily_reminder_settings.push_enabled END,
    email_destination_hash=CASE WHEN p_channel='email' AND p_enabled THEN p_destination_hash ELSE daily_reminder_settings.email_destination_hash END,
    email_consented_at=CASE WHEN p_channel='email' AND p_enabled AND channel_changed THEN clock_timestamp() ELSE daily_reminder_settings.email_consented_at END,
    push_consented_at=CASE WHEN p_channel='push' AND p_enabled AND channel_changed THEN clock_timestamp() ELSE daily_reminder_settings.push_consented_at END,
    schedule_version=daily_reminder_settings.schedule_version+CASE WHEN schedule_changed THEN 1 ELSE 0 END,
    next_due_at=CASE WHEN schedule_changed OR (p_enabled AND channel_changed) THEN p_next ELSE daily_reminder_settings.next_due_at END,
    updated_at=CASE WHEN schedule_changed OR channel_changed THEN clock_timestamp() ELSE daily_reminder_settings.updated_at END
  RETURNING * INTO saved;
  IF p_channel='push' AND NOT p_enabled THEN
    -- An account-wide opt-out must revoke sleeping devices too. Re-enabling
    -- one installation later must not reactivate their old registrations.
    UPDATE daily_reminder_devices SET revoked_at=clock_timestamp(),token_ciphertext='',
      registration_version=registration_version+1,updated_at=clock_timestamp()
      WHERE auth_user_id=p_auth AND revoked_at IS NULL;
  END IF;
  IF NOT saved.email_enabled AND NOT saved.push_enabled THEN
    UPDATE daily_reminder_settings SET next_due_at=NULL WHERE auth_user_id=p_auth RETURNING * INTO saved;
  END IF;
  IF schedule_changed THEN
    INSERT INTO daily_reminder_changes(auth_user_id,channel,action,schedule)
    VALUES(p_auth,'schedule','edit',jsonb_build_object('frequency',p_frequency,'weekdays',p_weekdays,'localTime',p_time,'timeZone',p_zone));
  END IF;
  IF channel_changed THEN
    audit_action:=CASE WHEN p_enabled THEN 'enable' ELSE 'disable' END;
    INSERT INTO daily_reminder_changes(auth_user_id,channel,action) VALUES(p_auth,p_channel,audit_action);
  END IF;
  UPDATE daily_reminder_deliveries SET state='suppressed',failure_reason='settings_changed',updated_at=clock_timestamp()
    WHERE auth_user_id=p_auth AND state IN ('queued','retry') AND (schedule_changed OR (channel=p_channel AND channel_changed));
  RETURN NEXT saved;
END;
$pack1$;

CREATE OR REPLACE FUNCTION pack1_reminder_unsubscribe(p_auth uuid,p_nonce uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $pack1$
DECLARE changed boolean;
BEGIN
  -- Valid links remain a harmless success after account deletion, and never
  -- recreate preferences or audit rows for a deleted account.
  IF NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN true; END IF;
  UPDATE daily_reminder_settings SET email_enabled=false,
    next_due_at=CASE WHEN push_enabled THEN next_due_at ELSE NULL END,updated_at=clock_timestamp()
    WHERE auth_user_id=p_auth AND unsubscribe_nonce=p_nonce AND email_enabled RETURNING true INTO changed;
  IF changed THEN
    INSERT INTO daily_reminder_changes(auth_user_id,channel,action) VALUES(p_auth,'email','unsubscribe');
    UPDATE daily_reminder_deliveries SET state='suppressed',failure_reason='unsubscribed',updated_at=clock_timestamp()
      WHERE auth_user_id=p_auth AND channel='email' AND state IN ('queued','retry');
  END IF;
  RETURN COALESCE(changed,false);
END;
$pack1$;

CREATE OR REPLACE FUNCTION pack1_reminder_enqueue(
  p_auth uuid,p_version bigint,p_due timestamptz,p_next timestamptz,p_local_day date,p_email boolean,p_push boolean
) RETURNS SETOF uuid LANGUAGE plpgsql VOLATILE AS $pack1$
DECLARE saved daily_reminder_settings%ROWTYPE;
BEGIN
  IF NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN; END IF;
  SELECT * INTO saved FROM daily_reminder_settings WHERE auth_user_id=p_auth FOR UPDATE;
  IF NOT FOUND OR saved.schedule_version<>p_version OR saved.next_due_at IS DISTINCT FROM p_due OR p_due>clock_timestamp() THEN RETURN; END IF;
  UPDATE daily_reminder_settings SET next_due_at=CASE WHEN email_enabled OR push_enabled THEN p_next ELSE NULL END WHERE auth_user_id=p_auth;
  -- Advance directly into the future after an outage. Do not make rows for
  -- expired occurrences, and never fill one day at a time after a long gap.
  IF p_due<clock_timestamp()-interval '20 minutes' THEN RETURN; END IF;
  RETURN QUERY WITH targets AS (
    SELECT 'email'::text channel,NULL::uuid installation_id,NULL::bigint version,NULL::text session_hash,NULL::text token_hash
      WHERE p_email AND saved.email_enabled
    UNION ALL
    SELECT 'push',d.installation_id,d.registration_version,d.session_hash,d.token_hash::text
    FROM daily_reminder_devices d JOIN account_sessions a ON a.session_hash=d.session_hash AND a.auth_user_id=p_auth
    WHERE p_push AND saved.push_enabled AND d.auth_user_id=p_auth AND d.revoked_at IS NULL AND a.revoked_at IS NULL AND a.expires_at>clock_timestamp()
  ) INSERT INTO daily_reminder_deliveries(auth_user_id,channel,installation_id,local_day,schedule_version,due_at,game_day,
      device_version,device_session_hash,device_token_hash)
    SELECT p_auth,t.channel,t.installation_id,p_local_day,p_version,p_due,(p_due AT TIME ZONE 'America/Los_Angeles')::date,
      t.version,t.session_hash,t.token_hash FROM targets t ON CONFLICT DO NOTHING RETURNING id;
END;
$pack1$;

CREATE OR REPLACE FUNCTION pack1_reminder_register_device(
  p_installation uuid,p_auth uuid,p_session text,p_platform text,p_token_hash text,p_ciphertext text,
  p_candidate_secret text,p_proof text,p_expected_version bigint,p_explicit boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $pack1$
DECLARE old daily_reminder_devices%ROWTYPE; saved daily_reminder_devices%ROWTYPE; new_secret boolean:=false;
BEGIN
  IF NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN jsonb_build_object('error','ACCOUNT_DELETING'); END IF;
  PERFORM 1 FROM account_sessions WHERE session_hash=p_session AND auth_user_id=p_auth AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','SESSION_EXPIRED'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pack1-reminder-installation:'||p_installation::text,0));
  SELECT * INTO old FROM daily_reminder_devices WHERE installation_id=p_installation FOR UPDATE;
  IF old.installation_id IS NOT NULL THEN
    IF old.binding_secret_hash IS NOT NULL AND old.binding_secret_hash IS DISTINCT FROM p_proof
      THEN RETURN jsonb_build_object('error','DEVICE_PROOF_REQUIRED'); END IF;
    IF old.binding_secret_hash IS NULL AND old.auth_user_id<>p_auth
      THEN RETURN jsonb_build_object('error','DEVICE_PROOF_REQUIRED'); END IF;
    IF old.binding_secret_hash IS NOT NULL AND old.registration_version IS DISTINCT FROM p_expected_version
      AND NOT (p_explicit AND old.revoked_at IS NOT NULL)
      THEN RETURN jsonb_build_object('error','DEVICE_VERSION_CHANGED'); END IF;
    IF old.auth_user_id<>p_auth AND old.revoked_at IS NULL AND EXISTS(
      SELECT 1 FROM account_sessions WHERE session_hash=old.session_hash AND revoked_at IS NULL AND expires_at>clock_timestamp()
    ) THEN RETURN jsonb_build_object('error','DEVICE_STILL_ATTACHED'); END IF;
  END IF;
  -- Possession of an installation UUID alone never permits token reassignment.
  IF EXISTS(SELECT 1 FROM daily_reminder_devices WHERE token_hash=p_token_hash AND revoked_at IS NULL
      AND installation_id<>p_installation AND auth_user_id<>p_auth)
    THEN RETURN jsonb_build_object('error','DEVICE_STILL_ATTACHED'); END IF;
  IF (SELECT count(*) FROM daily_reminder_devices WHERE auth_user_id=p_auth AND revoked_at IS NULL
      AND installation_id<>p_installation AND token_hash<>p_token_hash)>=5
    THEN RETURN jsonb_build_object('error','DEVICE_LIMIT'); END IF;
  UPDATE daily_reminder_devices SET revoked_at=clock_timestamp(),token_ciphertext='',registration_version=registration_version+1,updated_at=clock_timestamp()
    WHERE auth_user_id=p_auth AND token_hash=p_token_hash AND installation_id<>p_installation AND revoked_at IS NULL;
  new_secret:=old.installation_id IS NULL OR old.binding_secret_hash IS NULL;
  INSERT INTO daily_reminder_devices(installation_id,auth_user_id,session_hash,platform,token_hash,token_ciphertext,binding_secret_hash)
    VALUES(p_installation,p_auth,p_session,p_platform,p_token_hash,p_ciphertext,p_candidate_secret)
  ON CONFLICT(installation_id) DO UPDATE SET
    auth_user_id=p_auth,session_hash=p_session,platform=p_platform,token_hash=p_token_hash,token_ciphertext=p_ciphertext,
    binding_secret_hash=COALESCE(daily_reminder_devices.binding_secret_hash,p_candidate_secret),
    registration_version=daily_reminder_devices.registration_version+CASE WHEN
      daily_reminder_devices.revoked_at IS NOT NULL OR daily_reminder_devices.auth_user_id<>p_auth
      OR daily_reminder_devices.session_hash<>p_session OR daily_reminder_devices.token_hash<>p_token_hash THEN 1 ELSE 0 END,
    revoked_at=NULL,updated_at=clock_timestamp()
  RETURNING * INTO saved;
  RETURN jsonb_build_object('ok',true,'registrationVersion',saved.registration_version,'secretCreated',new_secret);
END;
$pack1$;

CREATE OR REPLACE FUNCTION pack1_reminder_unregister_device(p_auth uuid,p_installation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $pack1$
DECLARE v bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_auth::text,0));
  UPDATE daily_reminder_devices SET revoked_at=COALESCE(revoked_at,clock_timestamp()),token_ciphertext='',
    registration_version=registration_version+CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END,updated_at=clock_timestamp()
    WHERE auth_user_id=p_auth AND installation_id=p_installation RETURNING registration_version INTO v;
  RETURN jsonb_build_object('ok',true,'registrationVersion',v);
END;
$pack1$;

CREATE OR REPLACE FUNCTION pack1_reminder_claim(
  p_delivery uuid,p_email text,p_destination_hash text,p_request_hash text,p_game_day date,
  p_email_active boolean,p_push_active boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $pack1$
DECLARE auth uuid; d daily_reminder_deliveries%ROWTYPE; s daily_reminder_settings%ROWTYPE;
  now_at timestamptz; rejection text; second_limit integer; minute_limit integer;
BEGIN
  SELECT auth_user_id INTO auth FROM daily_reminder_deliveries WHERE id=p_delivery;
  IF NOT FOUND THEN RETURN jsonb_build_object('result','missing'); END IF;
  IF NOT pack1_identity_attachment_allowed(auth) THEN
    UPDATE daily_reminder_deliveries SET state='suppressed',failure_reason='account_deleting',updated_at=clock_timestamp()
      WHERE id=p_delivery AND state IN ('queued','retry');
    RETURN jsonb_build_object('result','suppressed');
  END IF;
  PERFORM 1 FROM neon_auth."user" WHERE id=auth FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result','missing'); END IF;
  SELECT * INTO d FROM daily_reminder_deliveries WHERE id=p_delivery FOR UPDATE;
  SELECT * INTO s FROM daily_reminder_settings WHERE auth_user_id=auth;
  now_at:=clock_timestamp();
  IF d.state NOT IN ('queued','retry') OR (d.next_retry_at IS NOT NULL AND d.next_retry_at>now_at)
    THEN RETURN jsonb_build_object('result','not_claimed'); END IF;
  IF s.auth_user_id IS NULL OR s.schedule_version<>d.schedule_version THEN rejection:='settings_changed';
  ELSIF d.due_at<now_at-interval '20 minutes' OR d.due_at>now_at
    OR d.game_day IS DISTINCT FROM p_game_day OR p_game_day<>(now_at AT TIME ZONE 'America/Los_Angeles')::date
    THEN rejection:='expired';
  ELSIF d.attempts>=3 THEN rejection:='retry_exhausted';
  ELSIF d.channel='email' THEN
    IF NOT p_email_active THEN RETURN jsonb_build_object('result','inactive'); END IF;
    IF NOT s.email_enabled OR s.email_destination_hash IS DISTINCT FROM p_destination_hash
      OR p_destination_hash IS NULL OR p_destination_hash !~ '^[a-f0-9]{64}$'
      OR (d.destination_hash IS NOT NULL AND d.destination_hash<>p_destination_hash)
      OR s.suppressed_email_hash::text=p_destination_hash
      OR EXISTS(SELECT 1 FROM daily_reminder_email_suppressions WHERE auth_user_id=auth AND destination_hash=p_destination_hash)
      OR NOT EXISTS(SELECT 1 FROM neon_auth."user" WHERE id=auth AND "emailVerified" IS TRUE AND lower(btrim(email))=lower(btrim(p_email)))
      THEN rejection:='email_ineligible'; END IF;
  ELSE
    IF NOT p_push_active THEN RETURN jsonb_build_object('result','inactive'); END IF;
    IF NOT s.push_enabled OR NOT EXISTS(
      SELECT 1 FROM daily_reminder_devices v JOIN account_sessions a ON a.session_hash=v.session_hash AND a.auth_user_id=auth
      WHERE v.installation_id=d.installation_id AND v.auth_user_id=auth AND v.revoked_at IS NULL
        AND v.registration_version=d.device_version AND v.session_hash=d.device_session_hash AND v.token_hash::text=d.device_token_hash
        AND a.revoked_at IS NULL AND a.expires_at>now_at
    ) THEN rejection:='device_ineligible'; END IF;
  END IF;
  IF rejection IS NULL AND (
    SELECT count(DISTINCT score.set_id)=3 FROM scores score JOIN account_links link ON link.player_id=score.player_id
    WHERE link.auth_user_id=auth AND score.challenge_date=p_game_day AND score.mode='draft_run'
      AND score.set_id IN ('mixed','powered-cube','latest')
  ) THEN rejection:='all_dailies_completed'; END IF;
  IF rejection IS NULL AND EXISTS(
    SELECT 1 FROM daily_reminder_dispatch_claims c WHERE c.auth_user_id=auth AND c.channel=d.channel
      AND c.installation_id IS NOT DISTINCT FROM d.installation_id AND c.delivery_id<>d.id
      AND (c.local_day=d.local_day OR c.game_day=d.game_day)
  ) THEN rejection:='already_claimed_today'; END IF;
  IF rejection IS NULL AND d.request_hash IS NOT NULL AND d.request_hash<>p_request_hash THEN rejection:='payload_changed'; END IF;
  IF rejection IS NOT NULL THEN
    UPDATE daily_reminder_deliveries SET state='suppressed',failure_reason=rejection,updated_at=now_at WHERE id=d.id;
    RETURN jsonb_build_object('result','suppressed');
  END IF;
  -- Database-backed limits apply across concurrent workers, not per process.
  -- The worker spaces its own requests too, leaving provider capacity for auth.
  PERFORM pg_advisory_xact_lock(hashtextextended('pack1-reminder-provider:'||d.channel,0));
  now_at:=clock_timestamp();
  IF p_game_day<>(now_at AT TIME ZONE 'America/Los_Angeles')::date OR d.due_at<now_at-interval '20 minutes' THEN
    UPDATE daily_reminder_deliveries SET state='suppressed',failure_reason='expired',updated_at=now_at WHERE id=d.id;
    RETURN jsonb_build_object('result','suppressed');
  END IF;
  second_limit:=CASE WHEN d.channel='email' THEN 2 ELSE 20 END;
  minute_limit:=CASE WHEN d.channel='email' THEN 60 ELSE 120 END;
  IF EXISTS(SELECT 1 FROM daily_reminder_rate_limits r WHERE r.channel=d.channel AND
      ((r.period='second' AND r.bucket=date_trunc('second',now_at) AND r.used>=second_limit)
       OR (r.period='minute' AND r.bucket=date_trunc('minute',now_at) AND r.used>=minute_limit)))
    THEN RETURN jsonb_build_object('result','rate_limited'); END IF;
  INSERT INTO daily_reminder_dispatch_claims(delivery_id,auth_user_id,channel,installation_id,local_day,game_day)
    VALUES(d.id,auth,d.channel,d.installation_id,d.local_day,d.game_day) ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM daily_reminder_dispatch_claims WHERE delivery_id=d.id)
    THEN RETURN jsonb_build_object('result','not_claimed'); END IF;
  INSERT INTO daily_reminder_rate_limits(channel,period,bucket,used)
    VALUES(d.channel,'second',date_trunc('second',now_at),1),(d.channel,'minute',date_trunc('minute',now_at),1)
    ON CONFLICT(channel,period,bucket) DO UPDATE SET used=daily_reminder_rate_limits.used+1;
  UPDATE daily_reminder_deliveries SET state='sending',attempts=attempts+1,
    started_at=COALESCE(started_at,now_at),last_attempt_at=now_at,updated_at=now_at,
    destination_hash=CASE WHEN channel='email' THEN p_destination_hash ELSE destination_hash END,request_hash=p_request_hash
    WHERE id=d.id RETURNING * INTO d;
  RETURN jsonb_build_object('result','claimed','attempts',d.attempts);
END;
$pack1$;

CREATE OR REPLACE FUNCTION pack1_reminder_apply_event(p_event_id text)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $pack1$
DECLARE e daily_reminder_provider_events%ROWTYPE; d daily_reminder_deliveries%ROWTYPE; owner uuid;
  reason text; changed boolean;
BEGIN
  SELECT * INTO e FROM daily_reminder_provider_events WHERE event_id=p_event_id;
  IF NOT FOUND OR e.state<>'pending' THEN RETURN true; END IF;
  IF e.delivery_hint IS NOT NULL THEN
    SELECT * INTO d FROM daily_reminder_deliveries WHERE id=e.delivery_hint AND channel='email';
    IF NOT FOUND THEN
      -- A message from this path carries its precommitted delivery ID. Missing
      -- records are retired/deleted, not a reason to recreate account data.
      DELETE FROM daily_reminder_provider_events WHERE event_id=p_event_id;
      RETURN true;
    END IF;
  ELSE
    SELECT * INTO d FROM daily_reminder_deliveries WHERE provider_id=e.provider_id AND channel='email';
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;
  owner:=d.auth_user_id;
  IF NOT pack1_identity_attachment_allowed(owner) THEN
    DELETE FROM daily_reminder_provider_events WHERE event_id=p_event_id;
    RETURN true;
  END IF;
  SELECT * INTO e FROM daily_reminder_provider_events WHERE event_id=p_event_id FOR UPDATE;
  IF NOT FOUND OR e.state<>'pending' THEN RETURN true; END IF;
  SELECT * INTO d FROM daily_reminder_deliveries WHERE id=d.id FOR UPDATE;
  IF NOT FOUND THEN DELETE FROM daily_reminder_provider_events WHERE event_id=p_event_id; RETURN true; END IF;
  IF d.destination_hash IS NULL OR d.started_at IS NULL THEN RETURN false; END IF;
  IF (d.provider_id IS NOT NULL AND d.provider_id<>e.provider_id)
    OR EXISTS(SELECT 1 FROM daily_reminder_deliveries WHERE provider_id=e.provider_id AND id<>d.id)
    OR (e.destination_hash IS NOT NULL AND e.destination_hash<>d.destination_hash)
    OR e.event_at<d.started_at-interval '5 minutes' THEN
    UPDATE daily_reminder_provider_events SET state='ignored',auth_user_id=owner,processed_at=clock_timestamp() WHERE event_id=p_event_id;
    RETURN true;
  END IF;
  UPDATE daily_reminder_deliveries SET provider_id=COALESCE(provider_id,e.provider_id),
    accepted_at=LEAST(COALESCE(accepted_at,e.event_at),e.event_at),
    updated_at=clock_timestamp() WHERE id=d.id;
  IF e.event_type IN ('email.bounced','email.complained') THEN
    reason:=CASE WHEN e.event_type='email.complained' THEN 'complaint' ELSE 'bounce' END;
    UPDATE daily_reminder_deliveries SET state='failed',
      failure_reason=CASE WHEN failure_reason='complaint' THEN 'complaint' ELSE reason END,
      updated_at=clock_timestamp() WHERE id=d.id;
    INSERT INTO daily_reminder_email_suppressions(auth_user_id,destination_hash,reason,first_event_at,last_event_at)
      VALUES(owner,d.destination_hash,reason,e.event_at,e.event_at)
      ON CONFLICT(auth_user_id,destination_hash) DO UPDATE SET
        reason=CASE WHEN daily_reminder_email_suppressions.reason='complaint' THEN 'complaint' ELSE EXCLUDED.reason END,
        first_event_at=LEAST(daily_reminder_email_suppressions.first_event_at,EXCLUDED.first_event_at),
        last_event_at=GREATEST(daily_reminder_email_suppressions.last_event_at,EXCLUDED.last_event_at);
    -- An old destination's event never disables consent for a new address.
    UPDATE daily_reminder_settings SET email_enabled=false,
      next_due_at=CASE WHEN push_enabled THEN next_due_at ELSE NULL END,updated_at=clock_timestamp()
      WHERE auth_user_id=owner AND email_destination_hash=d.destination_hash AND email_enabled RETURNING true INTO changed;
    IF changed THEN
      INSERT INTO daily_reminder_changes(auth_user_id,channel,action) VALUES(owner,'email',reason);
    END IF;
    UPDATE daily_reminder_deliveries SET state='suppressed',failure_reason=reason,updated_at=clock_timestamp()
      WHERE auth_user_id=owner AND channel='email' AND state IN ('queued','retry')
        AND (destination_hash=d.destination_hash OR (destination_hash IS NULL AND EXISTS(
          SELECT 1 FROM daily_reminder_settings WHERE auth_user_id=owner AND email_destination_hash=d.destination_hash)));
  ELSIF e.event_type='email.delivered' THEN
    UPDATE daily_reminder_deliveries SET
      state=CASE WHEN failure_reason IN ('bounce','complaint') OR state IN ('failed','suppressed') THEN state ELSE 'delivered' END,
      delivered_at=LEAST(COALESCE(delivered_at,e.event_at),e.event_at),updated_at=clock_timestamp()
      WHERE id=d.id RETURNING * INTO d;
    IF d.state='delivered' THEN
      UPDATE daily_reminder_settings SET last_email_delivered_at=GREATEST(last_email_delivered_at,d.delivered_at)
        WHERE auth_user_id=owner AND email_destination_hash=d.destination_hash;
    END IF;
  ELSE
    UPDATE daily_reminder_deliveries SET state=CASE WHEN state IN ('sending','uncertain','retry') THEN 'accepted' ELSE state END,
      updated_at=clock_timestamp() WHERE id=d.id;
  END IF;
  UPDATE daily_reminder_settings settings SET last_email_delivered_at=(
    SELECT max(delivered_at) FROM daily_reminder_deliveries sent WHERE sent.auth_user_id=owner
      AND sent.channel='email' AND sent.state='delivered' AND sent.destination_hash=settings.email_destination_hash
  ) WHERE settings.auth_user_id=owner;
  UPDATE daily_reminder_provider_events SET state='applied',auth_user_id=owner,delivery_hint=d.id,processed_at=clock_timestamp()
    WHERE event_id=p_event_id;
  RETURN true;
END;
$pack1$;

CREATE OR REPLACE FUNCTION pack1_reminder_provider_accepted(p_delivery uuid,p_provider_id text)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $pack1$
DECLARE d daily_reminder_deliveries%ROWTYPE;
BEGIN
  SELECT * INTO d FROM daily_reminder_deliveries WHERE id=p_delivery;
  IF NOT FOUND OR NOT pack1_identity_attachment_allowed(d.auth_user_id) THEN RETURN false; END IF;
  SELECT * INTO d FROM daily_reminder_deliveries WHERE id=p_delivery FOR UPDATE;
  IF NOT FOUND OR (d.provider_id IS NOT NULL AND d.provider_id<>p_provider_id) THEN RETURN false; END IF;
  UPDATE daily_reminder_deliveries SET provider_id=COALESCE(provider_id,p_provider_id),
    state=CASE WHEN state IN ('sending','uncertain','retry') THEN 'accepted' ELSE state END,
    accepted_at=COALESCE(accepted_at,clock_timestamp()),updated_at=clock_timestamp() WHERE id=p_delivery;
  IF d.channel='push' THEN
    UPDATE daily_reminder_settings SET last_push_accepted_at=GREATEST(last_push_accepted_at,clock_timestamp()) WHERE auth_user_id=d.auth_user_id;
  END IF;
  RETURN true;
END;
$pack1$;

CREATE OR REPLACE FUNCTION pack1_reminder_revoke_session(p_auth uuid,p_session text)
RETURNS integer LANGUAGE plpgsql VOLATILE AS $pack1$
DECLARE total integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_auth::text,0));
  UPDATE daily_reminder_devices SET revoked_at=clock_timestamp(),token_ciphertext='',
    registration_version=registration_version+1,updated_at=clock_timestamp()
    WHERE auth_user_id=p_auth AND session_hash=p_session AND revoked_at IS NULL;
  GET DIAGNOSTICS total=ROW_COUNT;
  RETURN total;
END;
$pack1$;

-- Reminder state is never a browser-facing RPC surface.
REVOKE ALL ON daily_reminder_settings,daily_reminder_changes,daily_reminder_devices,daily_reminder_deliveries,
  daily_reminder_dispatch_claims,daily_reminder_email_suppressions,daily_reminder_provider_events,daily_reminder_rate_limits FROM PUBLIC;
REVOKE ALL ON FUNCTION pack1_reminder_save_settings(uuid,text,integer[],text,text,text,boolean,timestamptz,text,text),
  pack1_reminder_unsubscribe(uuid,uuid),pack1_reminder_enqueue(uuid,bigint,timestamptz,timestamptz,date,boolean,boolean),
  pack1_reminder_register_device(uuid,uuid,text,text,text,text,text,text,bigint,boolean),pack1_reminder_unregister_device(uuid,uuid),
  pack1_reminder_claim(uuid,text,text,text,date,boolean,boolean),pack1_reminder_apply_event(text),
  pack1_reminder_provider_accepted(uuid,text),pack1_reminder_revoke_session(uuid,text) FROM PUBLIC;
