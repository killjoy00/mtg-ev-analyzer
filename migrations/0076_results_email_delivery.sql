-- Private delivery bookkeeping; never export recipient rows or email envelopes.
CREATE TABLE IF NOT EXISTS results_email_runtime (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), started_at timestamptz NOT NULL DEFAULT now(),
 config_hash text NOT NULL CHECK(config_hash ~ '^[a-f0-9]{64}$'), verified_at timestamptz
);
CREATE TABLE IF NOT EXISTS results_email_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_key text NOT NULL UNIQUE,
 kind text NOT NULL CHECK(kind IN ('week','season','news')),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved','cancelled')),
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 160),
 body text NOT NULL DEFAULT '' CHECK(length(body)<=10000),
 target_auth_user_id uuid REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
 start_date date, end_date date, created_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz, expires_at timestamptz,
 CHECK((kind='news' AND start_date IS NULL AND end_date IS NULL) OR
       (kind<>'news' AND start_date IS NOT NULL AND end_date>=start_date)),
 CHECK(state<>'approved' OR (approved_at IS NOT NULL AND expires_at>approved_at))
);
CREATE TABLE IF NOT EXISTS results_email_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 campaign_id uuid NOT NULL REFERENCES results_email_campaigns(id) ON DELETE CASCADE,
 auth_user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
 admission_id uuid REFERENCES results_email_admissions(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'preparing' CHECK(state IN
  ('preparing','sending','accepted','delivered','failed','uncertain','skipped','bounced','complained')),
 provider_id text CHECK(length(provider_id)<=200), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(campaign_id,auth_user_id)
);
CREATE INDEX IF NOT EXISTS results_email_campaign_due_idx ON results_email_campaigns(approved_at,id) WHERE state='approved';
CREATE INDEX IF NOT EXISTS results_email_delivery_owner_idx ON results_email_deliveries(auth_user_id);
CREATE INDEX IF NOT EXISTS results_email_delivery_admission_idx ON results_email_deliveries(admission_id);

-- Claim once across concurrent invocations. A crash/ambiguous send is never
-- automatically replayed, including beyond the provider's idempotency window.
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
 WHERE p.auth_user_id=p_auth AND p.email_state='on' AND p.changed_at<=c.approved_at
  AND (c.target_auth_user_id IS NULL OR c.target_auth_user_id=p_auth)
  AND u."emailVerified" IS TRUE AND u."createdAt"<=c.approved_at
 ON CONFLICT(campaign_id,auth_user_id) DO NOTHING RETURNING id INTO delivery;
 RETURN delivery;
END $body$;

-- Called ONLY by prepareResultsEmail immediately before the provider handoff.
-- Re-check cancellation, consent, current destination and the deletion lock.
CREATE OR REPLACE FUNCTION pack1_results_admit_delivery(p_delivery uuid,p_auth uuid,p_hash text,p_email text)
RETURNS uuid LANGUAGE plpgsql VOLATILE AS $body$
DECLARE admission uuid; campaign uuid;
BEGIN
 IF NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN NULL; END IF;
 SELECT campaign_id INTO campaign FROM results_email_deliveries
  WHERE id=p_delivery AND auth_user_id=p_auth AND state='preparing' FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM 1 FROM results_email_campaigns c JOIN results_preferences p ON p.auth_user_id=p_auth
  WHERE c.id=campaign AND c.state='approved' AND c.approved_at<=now() AND c.expires_at>now()
   AND p.changed_at<=c.approved_at FOR SHARE OF c;
 IF NOT FOUND THEN RETURN NULL; END IF;
 admission:=pack1_results_admit(p_auth,p_hash,p_email);
 IF admission IS NULL THEN RETURN NULL; END IF;
 UPDATE results_email_deliveries SET admission_id=admission,state='sending',updated_at=now() WHERE id=p_delivery;
 RETURN admission;
END $body$;

CREATE OR REPLACE FUNCTION pack1_results_delivery_event(p_admission uuid,p_hash text,p_event text,p_provider text,p_config text)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $body$
DECLARE owner uuid;
BEGIN
 SELECT auth_user_id INTO owner FROM results_email_admissions WHERE id=p_admission AND destination_hash=p_hash;
 IF NOT FOUND OR NOT pack1_identity_attachment_allowed(owner) THEN RETURN false; END IF;
 IF p_event IN ('email.bounced','email.complained') THEN
  PERFORM pack1_results_suppress(p_admission,p_hash,CASE WHEN p_event='email.complained' THEN 'complaint' ELSE 'bounce' END);
 END IF;
 UPDATE results_email_deliveries SET
  state=CASE WHEN state='complained' OR p_event='email.complained' THEN 'complained'
   WHEN state='bounced' OR p_event='email.bounced' THEN 'bounced'
   WHEN state='delivered' OR p_event='email.delivered' THEN 'delivered' ELSE 'accepted' END,
  provider_id=coalesce(provider_id,p_provider),updated_at=now()
 WHERE admission_id=p_admission AND p_event IN ('email.sent','email.delivered','email.bounced','email.complained');
 IF p_event='email.delivered' THEN
  UPDATE results_email_runtime SET verified_at=coalesce(verified_at,now())
   WHERE singleton AND config_hash=p_config AND EXISTS(
    SELECT 1 FROM results_email_deliveries d JOIN results_email_campaigns c ON c.id=d.campaign_id
    WHERE d.admission_id=p_admission AND d.state='delivered' AND c.target_auth_user_id=owner AND c.campaign_key LIKE 'check:%');
 END IF;
 RETURN FOUND;
END $body$;

-- Account-deletion commitment already deletes admissions. Their cascade must
-- remove even preparing/skipped ledger rows before later identity cleanup.
CREATE OR REPLACE FUNCTION pack1_results_delete_delivery_rows()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
 DELETE FROM results_email_deliveries WHERE auth_user_id=OLD.auth_user_id;
 RETURN OLD;
END $body$;
DROP TRIGGER IF EXISTS results_preferences_delete_deliveries ON results_preferences;
CREATE TRIGGER results_preferences_delete_deliveries BEFORE DELETE ON results_preferences
 FOR EACH ROW EXECUTE FUNCTION pack1_results_delete_delivery_rows();

REVOKE ALL ON results_email_runtime,results_email_campaigns,results_email_deliveries FROM PUBLIC;
REVOKE ALL ON FUNCTION pack1_results_claim_delivery(uuid,uuid),
 pack1_results_admit_delivery(uuid,uuid,text,text),pack1_results_delivery_event(uuid,text,text,text,text),
 pack1_results_delete_delivery_rows() FROM PUBLIC;
