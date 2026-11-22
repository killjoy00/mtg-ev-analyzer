-- Respect the existing owner do-not-contact flag in BOTH email streams.
-- Admission remains the final authority immediately before a provider handoff.
-- No consent is changed, no campaign is sent, and no historical rows are rewritten.

CREATE OR REPLACE FUNCTION pack1_results_admit_news(p_auth uuid,p_hash text,p_email text)
RETURNS uuid LANGUAGE plpgsql VOLATILE AS $body$
DECLARE admitted uuid;
BEGIN
 IF NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN NULL; END IF;
 PERFORM 1 FROM neon_auth."user" WHERE id=p_auth AND "emailVerified" IS TRUE
  AND lower(btrim(email))=lower(btrim(p_email)) FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM results_launch WHERE singleton AND launch_at<=now()) THEN RETURN NULL; END IF;
 PERFORM 1 FROM results_preferences WHERE auth_user_id=p_auth AND news_email_state='on'
  AND destination_hash=p_hash AND do_not_contact_at IS NULL FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM results_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_hash)
  OR EXISTS(SELECT 1 FROM daily_reminder_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_hash) THEN RETURN NULL; END IF;
 INSERT INTO results_email_admissions(auth_user_id,destination_hash) VALUES(p_auth,p_hash) RETURNING id INTO admitted;
 RETURN admitted;
END $body$;

CREATE OR REPLACE FUNCTION pack1_results_admit(p_auth uuid,p_hash text,p_email text)
RETURNS uuid LANGUAGE plpgsql VOLATILE AS $body$
DECLARE admitted uuid;
BEGIN
 IF NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN NULL; END IF;
 PERFORM 1 FROM neon_auth."user" WHERE id=p_auth AND "emailVerified" IS TRUE
  AND lower(btrim(email))=lower(btrim(p_email)) FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM results_launch WHERE singleton AND launch_at<=now()) THEN RETURN NULL; END IF;
 PERFORM 1 FROM results_preferences WHERE auth_user_id=p_auth AND email_state='on'
  AND destination_hash=p_hash AND do_not_contact_at IS NULL FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM results_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_hash)
  OR EXISTS(SELECT 1 FROM daily_reminder_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_hash) THEN RETURN NULL; END IF;
 INSERT INTO results_email_admissions(auth_user_id,destination_hash) VALUES(p_auth,p_hash) RETURNING id INTO admitted;
 RETURN admitted;
END $body$;

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
 WHERE p.auth_user_id=p_auth AND p.do_not_contact_at IS NULL
  AND ((c.kind='news' AND p.news_email_state='on' AND p.news_changed_at<=c.approved_at)
    OR (c.kind<>'news' AND p.email_state='on' AND p.changed_at<=c.approved_at))
  AND (c.target_auth_user_id IS NULL OR c.target_auth_user_id=p_auth)
  AND u."emailVerified" IS TRUE AND u."createdAt"<=c.approved_at
 ON CONFLICT(campaign_id,auth_user_id) DO NOTHING RETURNING id INTO delivery;
 RETURN delivery;
END $body$;

REVOKE ALL ON FUNCTION pack1_results_admit_news(uuid,text,text),
 pack1_results_admit(uuid,text,text),pack1_results_claim_delivery(uuid,uuid) FROM PUBLIC;
