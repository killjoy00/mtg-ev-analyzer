-- Private operational records. Never export rows to the public repository.
CREATE TABLE IF NOT EXISTS results_launch (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 launch_at timestamptz
);
INSERT INTO results_launch(singleton) VALUES(true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS results_preferences (
 auth_user_id uuid PRIMARY KEY REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
 email_state text NOT NULL DEFAULT 'unanswered' CHECK(email_state IN ('unanswered','on','off')),
 destination_hash text CHECK(destination_hash ~ '^[a-f0-9]{64}$'),
 changed_at timestamptz, source text CHECK(source IN ('prompt','notice','settings','unsubscribe link','email change')),
 prompt_shown_at timestamptz, notice_shown_at timestamptz,
 prompt_answer text CHECK(prompt_answer IN ('on','off')),
 notice_outcome text CHECK(notice_outcome IN ('turned on','dismissed')),
 reconsent boolean NOT NULL DEFAULT false,
 exclude_publications boolean NOT NULL DEFAULT false,
 do_not_contact_at timestamptz,
 unsubscribe_nonce uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE
);
CREATE TABLE IF NOT EXISTS results_email_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 auth_user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
 state text NOT NULL CHECK(state IN ('unanswered','on','off')),
 source text NOT NULL, destination_hash text, changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS results_email_suppressions (
 auth_user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
 destination_hash text NOT NULL CHECK(destination_hash ~ '^[a-f0-9]{64}$'),
 reason text NOT NULL CHECK(reason IN ('bounce','complaint')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(auth_user_id,destination_hash)
);
CREATE TABLE IF NOT EXISTS results_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 auth_user_id uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
 channel text NOT NULL CHECK(length(channel) BETWEEN 1 AND 80),
 link text NOT NULL CHECK(length(link) BETWEEN 1 AND 2000),
 published_at timestamptz NOT NULL,
 name_to_remove text NOT NULL CHECK(length(name_to_remove) BETWEEN 1 AND 100),
 UNIQUE(auth_user_id,channel,link)
);
CREATE TABLE IF NOT EXISTS results_removal_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 publication_id uuid NOT NULL UNIQUE REFERENCES results_publications(id) ON DELETE CASCADE,
 requested_at timestamptz NOT NULL DEFAULT now(), due_at timestamptz NOT NULL,
 reason text NOT NULL CHECK(reason IN ('deletion','request'))
);
CREATE INDEX IF NOT EXISTS results_publications_owner_idx ON results_publications(auth_user_id);
CREATE INDEX IF NOT EXISTS results_removal_due_idx ON results_removal_tasks(due_at);
CREATE TABLE IF NOT EXISTS results_email_admissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 auth_user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
 destination_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

-- All writes serialize with the existing irreversible deletion tombstone.
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
 IF p_action<>'unsubscribe' AND prefs.email_state='on' AND prefs.destination_hash IS DISTINCT FROM p_hash THEN
   UPDATE results_preferences SET email_state='unanswered',destination_hash=p_hash,
    changed_at=now(),source='email change',prompt_shown_at=NULL,prompt_answer=NULL,reconsent=true WHERE auth_user_id=p_auth;
   INSERT INTO results_email_changes(auth_user_id,state,source,destination_hash) VALUES(p_auth,'unanswered','email change',p_hash);
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
 INSERT INTO results_email_changes(auth_user_id,state,source,destination_hash)
  SELECT p_auth,target,origin,destination_hash FROM results_preferences WHERE auth_user_id=p_auth;
 RETURN jsonb_build_object('ok',true);
END $body$;

-- Capture the minimum removal evidence at deletion COMMIT, before cleanup can
-- erase identity. A retry cannot move an existing deadline into the future.
CREATE OR REPLACE FUNCTION pack1_results_queue_removals(p_auth uuid,p_reason text,p_at timestamptz)
RETURNS void LANGUAGE plpgsql VOLATILE AS $body$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_auth::text,0));
 INSERT INTO results_removal_tasks(publication_id,requested_at,due_at,reason)
  SELECT id,p_at,p_at+interval '28 days',p_reason FROM results_publications WHERE auth_user_id=p_auth
  ON CONFLICT(publication_id) DO UPDATE SET due_at=least(results_removal_tasks.due_at,excluded.due_at);
 IF p_reason='deletion' THEN
   UPDATE results_publications SET auth_user_id=NULL WHERE auth_user_id=p_auth;
   DELETE FROM results_email_changes WHERE auth_user_id=p_auth;
   DELETE FROM results_email_admissions WHERE auth_user_id=p_auth;
   DELETE FROM results_email_suppressions WHERE auth_user_id=p_auth;
   DELETE FROM results_preferences WHERE auth_user_id=p_auth;
 END IF;
END $body$;
CREATE OR REPLACE FUNCTION pack1_results_on_deletion() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
 PERFORM pack1_results_queue_removals(NEW.auth_user_id,'deletion',NEW.created_at);
 RETURN NEW;
END $body$;
DROP TRIGGER IF EXISTS pack1_results_on_deletion ON account_deletion_operations;
CREATE TRIGGER pack1_results_on_deletion AFTER INSERT ON account_deletion_operations
 FOR EACH ROW EXECUTE FUNCTION pack1_results_on_deletion();

CREATE OR REPLACE FUNCTION pack1_results_admit(p_auth uuid,p_hash text,p_email text)
RETURNS uuid LANGUAGE plpgsql VOLATILE AS $body$
DECLARE admitted uuid;
BEGIN
 IF NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN NULL; END IF;
 PERFORM 1 FROM neon_auth."user" WHERE id=p_auth AND "emailVerified" IS TRUE
  AND lower(btrim(email))=lower(btrim(p_email)) FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM results_launch WHERE singleton AND launch_at<=now()) THEN RETURN NULL; END IF;
 PERFORM 1 FROM results_preferences WHERE auth_user_id=p_auth AND email_state='on' AND destination_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM results_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_hash)
  OR EXISTS(SELECT 1 FROM daily_reminder_email_suppressions WHERE auth_user_id=p_auth AND destination_hash=p_hash) THEN RETURN NULL; END IF;
 INSERT INTO results_email_admissions(auth_user_id,destination_hash) VALUES(p_auth,p_hash) RETURNING id INTO admitted;
 RETURN admitted;
END $body$;

CREATE OR REPLACE FUNCTION pack1_results_suppress(p_admission uuid,p_hash text,p_reason text)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $body$
DECLARE owner uuid;
BEGIN
 SELECT auth_user_id INTO owner FROM results_email_admissions WHERE id=p_admission;
 IF NOT FOUND OR NOT pack1_identity_attachment_allowed(owner) THEN RETURN false; END IF;
 INSERT INTO results_email_suppressions(auth_user_id,destination_hash,reason)
  SELECT auth_user_id,destination_hash,p_reason FROM results_email_admissions
  WHERE id=p_admission AND destination_hash=p_hash
  ON CONFLICT(auth_user_id,destination_hash) DO UPDATE SET reason=
   CASE WHEN excluded.reason='complaint' THEN 'complaint' ELSE results_email_suppressions.reason END;
 RETURN FOUND;
END $body$;

CREATE OR REPLACE FUNCTION pack1_results_publishable_name(p_auth uuid)
RETURNS text LANGUAGE sql STABLE AS $body$
 SELECT coalesce((SELECT p.display_name FROM neon_auth."user" u
  JOIN account_links a ON a.auth_user_id=u.id JOIN players p ON p.id=a.player_id
  CROSS JOIN results_launch launch LEFT JOIN results_preferences pref ON pref.auth_user_id=u.id
  WHERE u.id=p_auth AND launch.singleton AND launch.launch_at<=now()
   AND p.username_owned=true AND p.public_identity_hidden_at IS NULL
   AND NOT coalesce(pref.exclude_publications,false)
   AND (u."createdAt">=launch.launch_at OR pref.notice_shown_at IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM account_deletion_operations WHERE auth_user_id=u.id)
  LIMIT 1),'Anonymous player')
$body$;

CREATE OR REPLACE FUNCTION pack1_results_record_publication(p_auth uuid,p_channel text,p_link text,p_at timestamptz)
RETURNS uuid LANGUAGE plpgsql VOLATILE AS $body$
DECLARE display text; publication uuid;
BEGIN
 IF NOT pack1_identity_attachment_allowed(p_auth) THEN RETURN NULL; END IF;
 -- Global fourteen-day notice period, in addition to per-account notice.
 IF NOT EXISTS(SELECT 1 FROM results_launch WHERE singleton AND launch_at+interval '14 days'<=now() AND p_at>=launch_at+interval '14 days') OR p_at>now() THEN
   RAISE EXCEPTION 'RESULTS_NOTICE_PERIOD';
 END IF;
 display:=pack1_results_publishable_name(p_auth);
 IF display='Anonymous player' THEN RETURN NULL; END IF;
 INSERT INTO results_publications(auth_user_id,channel,link,published_at,name_to_remove)
 VALUES(p_auth,p_channel,p_link,p_at,display) ON CONFLICT(auth_user_id,channel,link) DO UPDATE
  SET name_to_remove=excluded.name_to_remove RETURNING id INTO publication;
 RETURN publication;
END $body$;
