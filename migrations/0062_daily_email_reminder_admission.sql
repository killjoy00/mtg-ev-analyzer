-- Once-daily email reminders. The daily job admits each account here, then sends
-- admitted rows in provider batches. One email row per account per Pacific Daily.
-- Additive: replaces nothing from 0061; push keeps its per-device claim path.
CREATE OR REPLACE FUNCTION pack1_reminder_admit_daily_email(
  p_auth uuid,p_destination_hash text,p_game_day date
) RETURNS uuid LANGUAGE plpgsql VOLATILE AS $pack1$
DECLARE s daily_reminder_settings%ROWTYPE; admitted uuid;
BEGIN
  -- Same account lock as deletion and consent writes; later statements in this
  -- VOLATILE function see anything committed while it waited.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_auth::text,0));
  IF NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN NULL; END IF;
  IF p_game_day<>(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date THEN RETURN NULL; END IF;
  SELECT * INTO s FROM daily_reminder_settings WHERE auth_user_id=p_auth;
  IF NOT FOUND OR NOT s.email_enabled OR p_destination_hash IS NULL
    OR s.email_destination_hash IS DISTINCT FROM p_destination_hash
    OR s.suppressed_email_hash::text IS NOT DISTINCT FROM p_destination_hash THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM daily_reminder_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_destination_hash)
    OR EXISTS(SELECT 1 FROM daily_reminder_deliveries WHERE auth_user_id=p_auth AND channel='email' AND game_day=p_game_day)
    THEN RETURN NULL; END IF;
  -- Completed Daily runs are the authority, ranked or not, owned the same way the
  -- Daily page finds them: by linked player or by the account itself.
  IF (SELECT count(DISTINCT r.environment) FROM draft_run_sessions r
      WHERE r.day=p_game_day AND r.environment IN ('mixed','powered-cube','latest')
        AND jsonb_array_length(r.answers)=jsonb_array_length(r.puzzle_ids)
        AND (r.daily_account_id=p_auth OR r.player_id IN (SELECT player_id FROM account_links WHERE auth_user_id=p_auth)))>=3
    THEN RETURN NULL; END IF;
  INSERT INTO daily_reminder_deliveries(auth_user_id,channel,local_day,game_day,schedule_version,state,attempts,
    started_at,last_attempt_at,due_at,destination_hash)
  VALUES(p_auth,'email',p_game_day,p_game_day,0,'sending',1,clock_timestamp(),clock_timestamp(),clock_timestamp(),
    p_destination_hash)
  ON CONFLICT DO NOTHING RETURNING id INTO admitted;
  RETURN admitted;
END;
$pack1$;

REVOKE ALL ON FUNCTION pack1_reminder_admit_daily_email(uuid,text,date) FROM PUBLIC;
