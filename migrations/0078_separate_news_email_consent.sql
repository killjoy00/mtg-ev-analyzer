-- Keep the two signup choices independent. Previous explicit "Results and news"
-- opt-ins/opt-outs apply to both; unanswered accounts remain unanswered.
-- The backend/schema gate replays migrations. Replaying may never rewrite
-- choices made after the first migration, even when old weekly consent is on.
DO $migration$
DECLARE already_split boolean;
BEGIN
 SELECT EXISTS(SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='results_preferences' AND column_name='news_email_state')
  INTO already_split;
 ALTER TABLE results_preferences ADD COLUMN IF NOT EXISTS news_email_state text NOT NULL DEFAULT 'unanswered'
  CHECK(news_email_state IN ('unanswered','on','off'));
 ALTER TABLE results_preferences ADD COLUMN IF NOT EXISTS news_changed_at timestamptz;
 IF NOT already_split THEN
  UPDATE results_preferences SET news_email_state=email_state, news_changed_at=changed_at
   WHERE email_state IN ('on','off');
 END IF;
END $migration$;

-- Every account choice remains bound to the currently verified address.
CREATE OR REPLACE FUNCTION pack1_results_update(p_auth uuid,p_action text,p_hash text,p_email text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $body$
DECLARE prefs results_preferences%ROWTYPE; launch timestamptz; created timestamptz;
 target text; origin text; presentation text;
BEGIN
 IF NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN jsonb_build_object('error','ACCOUNT_DELETING'); END IF;
 SELECT "createdAt" INTO created FROM neon_auth."user" WHERE id=p_auth FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','ACCOUNT_DELETING'); END IF;
 IF p_action<>'unsubscribe' AND NOT EXISTS(SELECT 1 FROM neon_auth."user" WHERE id=p_auth AND lower(btrim(email))=lower(btrim(p_email))) THEN
   RETURN jsonb_build_object('error','ADDRESS_CHANGED');
 END IF;
 SELECT launch_at INTO launch FROM results_launch WHERE singleton;
 INSERT INTO results_preferences(auth_user_id) VALUES(p_auth) ON CONFLICT DO NOTHING;
 SELECT * INTO prefs FROM results_preferences WHERE auth_user_id=p_auth FOR UPDATE;
 -- Even an unverified replacement address invalidates the previous opt-in.
 IF p_action<>'unsubscribe' AND (prefs.email_state='on' OR prefs.news_email_state='on') AND prefs.destination_hash IS DISTINCT FROM p_hash THEN
   UPDATE results_preferences SET email_state=CASE WHEN email_state='on' THEN 'unanswered' ELSE email_state END,
    news_email_state=CASE WHEN news_email_state='on' THEN 'unanswered' ELSE news_email_state END,
    destination_hash=p_hash,changed_at=now(),news_changed_at=now(),source='email change',
    prompt_shown_at=NULL,prompt_answer=NULL,reconsent=true WHERE auth_user_id=p_auth;
   INSERT INTO results_email_changes(auth_user_id,state,source,destination_hash)
    SELECT p_auth,email_state,'email change',destination_hash FROM results_preferences WHERE auth_user_id=p_auth;
   SELECT * INTO prefs FROM results_preferences WHERE auth_user_id=p_auth;
 END IF;
 IF p_action='sync' THEN RETURN to_jsonb(prefs); END IF;
 IF p_action='unsubscribe' THEN target:='off'; origin:='unsubscribe link';
 ELSE
   IF launch IS NULL OR launch>now() THEN RETURN jsonb_build_object('error','NOT_LAUNCHED'); END IF;
   IF p_action='present' THEN
     IF prefs.reconsent OR created>=launch THEN
       IF prefs.email_state='unanswered' AND prefs.prompt_shown_at IS NULL THEN
         UPDATE results_preferences SET prompt_shown_at=now() WHERE auth_user_id=p_auth;
         presentation:='prompt';
       END IF;
     ELSIF prefs.notice_shown_at IS NULL THEN
       UPDATE results_preferences SET notice_shown_at=now() WHERE auth_user_id=p_auth;
       presentation:='notice';
     END IF;
     RETURN jsonb_build_object('presentation',presentation);
   ELSIF p_action IN ('prompt:on','prompt:off') THEN
     IF prefs.prompt_shown_at IS NULL OR prefs.email_state<>'unanswered' OR NOT (prefs.reconsent OR created>=launch) THEN
       RETURN jsonb_build_object('error','ALREADY_ANSWERED');
     END IF;
     target:=split_part(p_action,':',2); origin:='prompt';
   ELSIF p_action IN ('notice:on','notice:dismiss') THEN
     IF created>=launch OR prefs.notice_shown_at IS NULL OR prefs.notice_outcome IS NOT NULL THEN
       RETURN jsonb_build_object('error','ALREADY_ANSWERED');
     END IF;
     target:=CASE WHEN p_action='notice:on' THEN 'on' ELSE 'off' END; origin:='notice';
     UPDATE results_preferences SET notice_outcome=CASE WHEN target='on' THEN 'turned on' ELSE 'dismissed' END WHERE auth_user_id=p_auth;
   ELSIF p_action IN ('settings:on','settings:off') THEN target:=split_part(p_action,':',2); origin:='settings';
   ELSIF p_action IN ('exclude:on','exclude:off') THEN
     UPDATE results_preferences SET exclude_publications=(p_action='exclude:on') WHERE auth_user_id=p_auth;
     RETURN jsonb_build_object('ok',true);
   ELSE RETURN jsonb_build_object('error','INVALID_ACTION'); END IF;
 END IF;
 IF target='on' THEN
   IF p_hash IS NULL OR NOT EXISTS(SELECT 1 FROM neon_auth."user" WHERE id=p_auth AND "emailVerified" IS TRUE AND lower(btrim(email))=lower(btrim(p_email))) THEN
     RAISE EXCEPTION 'RESULTS_EMAIL_UNVERIFIED';
   END IF;
   IF EXISTS(SELECT 1 FROM results_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_hash)
      OR EXISTS(SELECT 1 FROM daily_reminder_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_hash) THEN
     RAISE EXCEPTION 'RESULTS_EMAIL_SUPPRESSED';
   END IF;
 END IF;
 UPDATE results_preferences SET email_state=target,destination_hash=CASE WHEN target='on' THEN p_hash ELSE destination_hash END,
  changed_at=now(),source=origin,reconsent=false,
  prompt_answer=CASE WHEN origin='prompt' THEN target ELSE prompt_answer END,
  notice_outcome=CASE WHEN origin='settings' AND notice_shown_at IS NOT NULL AND notice_outcome IS NULL
   THEN CASE WHEN target='on' THEN 'turned on' ELSE 'dismissed' END ELSE notice_outcome END WHERE auth_user_id=p_auth;
 -- The pre-split home invitation and legacy notice described BOTH streams. Preserve
 -- the meaning of those explicit choices without changing newer weekly-only settings.
 IF origin IN ('prompt','notice') OR p_action='unsubscribe' THEN
   UPDATE results_preferences SET news_email_state=target,news_changed_at=now() WHERE auth_user_id=p_auth;
 END IF;
 INSERT INTO results_email_changes(auth_user_id,state,source,destination_hash)
  SELECT p_auth,target,origin,destination_hash FROM results_preferences WHERE auth_user_id=p_auth;
 RETURN jsonb_build_object('ok',true);
END $body$;


CREATE OR REPLACE FUNCTION pack1_results_signup_choices(p_auth uuid,p_news text,p_weekly boolean,p_hash text,p_email text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $body$
DECLARE current_email text; verified boolean; weekly_state text;
BEGIN
 IF p_news NOT IN ('on','off') OR p_weekly IS NULL THEN RETURN jsonb_build_object('error','INVALID_ACTION'); END IF;
 IF NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN jsonb_build_object('error','ACCOUNT_DELETING'); END IF;
 IF NOT EXISTS(SELECT 1 FROM results_launch WHERE singleton AND launch_at<=now()) THEN RETURN jsonb_build_object('error','NOT_LAUNCHED'); END IF;
 SELECT email,"emailVerified" INTO current_email,verified FROM neon_auth."user" WHERE id=p_auth FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','ACCOUNT_DELETING'); END IF;
 IF lower(btrim(current_email)) IS DISTINCT FROM lower(btrim(p_email)) THEN RETURN jsonb_build_object('error','ADDRESS_CHANGED'); END IF;
 weekly_state:=CASE WHEN p_weekly THEN 'on' ELSE 'off' END;
 IF p_news='on' OR p_weekly THEN
   IF NOT verified OR p_hash IS NULL THEN RAISE EXCEPTION 'RESULTS_EMAIL_UNVERIFIED'; END IF;
   IF EXISTS(SELECT 1 FROM results_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_hash)
   OR EXISTS(SELECT 1 FROM daily_reminder_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_hash)
   THEN RAISE EXCEPTION 'RESULTS_EMAIL_SUPPRESSED'; END IF;
 END IF;
 INSERT INTO results_preferences(auth_user_id) VALUES(p_auth) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM results_preferences WHERE auth_user_id=p_auth FOR UPDATE;
 UPDATE results_preferences SET
   email_state=weekly_state,news_email_state=p_news,
   destination_hash=CASE WHEN p_news='on' OR p_weekly THEN p_hash ELSE destination_hash END,
   changed_at=now(),news_changed_at=now(),source='prompt',
   prompt_shown_at=coalesce(prompt_shown_at,now()),prompt_answer=weekly_state,reconsent=false
 WHERE auth_user_id=p_auth;
 INSERT INTO results_email_changes(auth_user_id,state,source,destination_hash)
 SELECT p_auth,weekly_state,'prompt',destination_hash FROM results_preferences WHERE auth_user_id=p_auth;
 RETURN jsonb_build_object('ok',true);
END $body$;

CREATE OR REPLACE FUNCTION pack1_results_set_news(p_auth uuid,p_target text,p_hash text,p_email text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $body$
DECLARE current_email text; verified boolean;
BEGIN
 IF p_target NOT IN ('on','off') THEN RETURN jsonb_build_object('error','INVALID_ACTION'); END IF;
 IF NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN jsonb_build_object('error','ACCOUNT_DELETING'); END IF;
 IF NOT EXISTS(SELECT 1 FROM results_launch WHERE singleton AND launch_at<=now()) THEN RETURN jsonb_build_object('error','NOT_LAUNCHED'); END IF;
 SELECT email,"emailVerified" INTO current_email,verified FROM neon_auth."user" WHERE id=p_auth FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','ACCOUNT_DELETING'); END IF;
 IF lower(btrim(current_email)) IS DISTINCT FROM lower(btrim(p_email)) THEN RETURN jsonb_build_object('error','ADDRESS_CHANGED'); END IF;
 IF p_target='on' THEN
   IF NOT verified OR p_hash IS NULL THEN RAISE EXCEPTION 'RESULTS_EMAIL_UNVERIFIED'; END IF;
   IF EXISTS(SELECT 1 FROM results_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_hash)
   OR EXISTS(SELECT 1 FROM daily_reminder_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_hash)
   THEN RAISE EXCEPTION 'RESULTS_EMAIL_SUPPRESSED'; END IF;
 END IF;
 INSERT INTO results_preferences(auth_user_id) VALUES(p_auth) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM results_preferences WHERE auth_user_id=p_auth FOR UPDATE;
 UPDATE results_preferences SET news_email_state=p_target,news_changed_at=now(),
   destination_hash=CASE WHEN p_target='on' THEN p_hash ELSE destination_hash END
 WHERE auth_user_id=p_auth;
 RETURN jsonb_build_object('ok',true);
END $body$;

CREATE OR REPLACE FUNCTION pack1_results_unsubscribe_all(p_auth uuid)
RETURNS void LANGUAGE plpgsql VOLATILE AS $body$
BEGIN
 PERFORM pack1_results_update(p_auth,'unsubscribe',NULL,NULL);
 UPDATE results_preferences SET news_email_state='off',news_changed_at=now() WHERE auth_user_id=p_auth;
END $body$;

CREATE OR REPLACE FUNCTION pack1_results_admit_news(p_auth uuid,p_hash text,p_email text)
RETURNS uuid LANGUAGE plpgsql VOLATILE AS $body$
DECLARE admitted uuid;
BEGIN
 IF NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN NULL; END IF;
 PERFORM 1 FROM neon_auth."user" WHERE id=p_auth AND "emailVerified" IS TRUE
  AND lower(btrim(email))=lower(btrim(p_email)) FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM results_launch WHERE singleton AND launch_at<=now()) THEN RETURN NULL; END IF;
 PERFORM 1 FROM results_preferences WHERE auth_user_id=p_auth AND news_email_state='on'
  AND destination_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM results_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_hash)
  OR EXISTS(SELECT 1 FROM daily_reminder_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_hash) THEN RETURN NULL; END IF;
 INSERT INTO results_email_admissions(auth_user_id,destination_hash) VALUES(p_auth,p_hash) RETURNING id INTO admitted;
 RETURN admitted;
END $body$;

-- The existing sender checks the appropriate topic before and immediately
-- before every provider handoff. A news-only subscriber cannot receive digests.
CREATE OR REPLACE FUNCTION pack1_results_claim_delivery(p_campaign uuid,p_auth uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE AS $body$
DECLARE delivery uuid;
BEGIN
 IF NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN NULL; END IF;
 PERFORM 1 FROM results_email_campaigns WHERE id=p_campaign AND state='approved'
  AND approved_at<=now() AND expires_at>now() FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO results_email_deliveries(campaign_id,auth_user_id)
 SELECT p_campaign,p_auth FROM results_preferences p JOIN neon_auth."user" u ON u.id=p.auth_user_id
 JOIN results_email_campaigns c ON c.id=p_campaign
 WHERE p.auth_user_id=p_auth AND ((c.kind='news' AND p.news_email_state='on' AND p.news_changed_at<=c.approved_at)
   OR (c.kind<>'news' AND p.email_state='on' AND p.changed_at<=c.approved_at))
  AND (c.target_auth_user_id IS NULL OR c.target_auth_user_id=p_auth)
  AND u."emailVerified" IS TRUE AND u."createdAt"<=c.approved_at
 ON CONFLICT(campaign_id,auth_user_id) DO NOTHING RETURNING id INTO delivery;
 RETURN delivery;
END $body$;


CREATE OR REPLACE FUNCTION pack1_results_admit_delivery(p_delivery uuid,p_auth uuid,p_hash text,p_email text,p_config text)
RETURNS uuid LANGUAGE plpgsql VOLATILE AS $body$
DECLARE admission uuid; campaign uuid; campaign_kind text;
BEGIN
 IF p_config IS NULL OR p_config !~ '^[a-f0-9]{64}$' OR NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN NULL; END IF;
 SELECT campaign_id INTO campaign FROM results_email_deliveries
  WHERE id=p_delivery AND auth_user_id=p_auth AND state='preparing' FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT c.kind INTO campaign_kind FROM results_email_campaigns c JOIN results_preferences p ON p.auth_user_id=p_auth
  WHERE c.id=campaign AND c.state='approved' AND c.approved_at<=now() AND c.expires_at>now()
   AND (c.target_auth_user_id IS NULL OR c.target_auth_user_id=p_auth)
   AND ((c.kind='news' AND p.news_email_state='on' AND p.news_changed_at<=c.approved_at)
      OR (c.kind<>'news' AND p.email_state='on' AND p.changed_at<=c.approved_at)) FOR SHARE OF c;
 IF NOT FOUND THEN RETURN NULL; END IF;
 admission:=CASE WHEN campaign_kind='news' THEN pack1_results_admit_news(p_auth,p_hash,p_email)
  ELSE pack1_results_admit(p_auth,p_hash,p_email) END;
 IF admission IS NULL THEN RETURN NULL; END IF;
 UPDATE results_email_deliveries SET admission_id=admission,config_hash=p_config,state='sending',updated_at=now() WHERE id=p_delivery;
 RETURN admission;
END $body$;


REVOKE ALL ON FUNCTION pack1_results_signup_choices(uuid,text,boolean,text,text),
 pack1_results_set_news(uuid,text,text,text),pack1_results_unsubscribe_all(uuid),
 pack1_results_admit_news(uuid,text,text),pack1_results_claim_delivery(uuid,uuid),
 pack1_results_admit_delivery(uuid,uuid,text,text,text) FROM PUBLIC;
