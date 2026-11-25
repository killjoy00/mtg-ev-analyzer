-- Private season publishing state. Inactive until owner enables the reviewed
-- results template and close trigger. Guide plans and frozen drafts are
-- aggregate-only; account names are retained only in pending removal evidence.
CREATE TABLE IF NOT EXISTS patreon_season_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 results_enabled_from date
);
INSERT INTO patreon_season_config(singleton) VALUES(true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS patreon_midseason_plans (
 season_id text PRIMARY KEY REFERENCES draft_run_seasons(id),
 next_set_id text NOT NULL CHECK(next_set_id ~ '^[a-z0-9-]{1,120}$'),
 next_start date NOT NULL,
 reviewed_on date NOT NULL,
 snapshot jsonb,
 color_count integer NOT NULL DEFAULT 2 CHECK(color_count IN (2,3)),
 source_attempted_at timestamptz,
 revision text NOT NULL CHECK(revision ~ '^[a-f0-9]{64}$')
);
CREATE TABLE IF NOT EXISTS patreon_midseason_drafts (
 season_id text PRIMARY KEY REFERENCES draft_run_seasons(id),
 milestone date NOT NULL,
 plan_revision text NOT NULL CHECK(plan_revision ~ '^[a-f0-9]{64}$'),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 3999),
 article jsonb NOT NULL CHECK(jsonb_typeof(article)='object'),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved','rejected')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 approved_at timestamptz,
 CHECK((state='approved')=(approved_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS patreon_season_runs (
 post_key text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('season-results','midseason-guide')),
 season_id text NOT NULL REFERENCES draft_run_seasons(id),
 milestone date NOT NULL,
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 3999),
 state text NOT NULL CHECK(state IN ('claimed','handoff','queued','verified','review')),
 image_sha256 text NOT NULL CHECK(image_sha256 ~ '^[a-f0-9]{64}$'),
 image_width integer NOT NULL CHECK(image_width BETWEEN 100 AND 4000),
 image_height integer NOT NULL CHECK(image_height BETWEEN 100 AND 30000),
 snapshot_ticket_sha256 text NOT NULL CHECK(snapshot_ticket_sha256 ~ '^[a-f0-9]{64}$'),
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 admitted_at timestamptz,
 public_url text CHECK(public_url ~ '^https://www[.]patreon[.]com/posts/[0-9]+$'),
 published_at timestamptz,
 verified_at timestamptz,
 last_status text NOT NULL DEFAULT 'claimed',
 UNIQUE(kind,season_id),
 CHECK(post_key='pack-one-season:'||CASE kind WHEN 'season-results' THEN 'results' ELSE 'guide' END||':'||season_id)
);
CREATE TABLE IF NOT EXISTS patreon_season_pending_names (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 post_key text NOT NULL REFERENCES patreon_season_runs(post_key) ON DELETE CASCADE,
 auth_user_id uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
 name_to_remove text NOT NULL CHECK(length(name_to_remove) BETWEEN 1 AND 100),
 deletion_requested_at timestamptz,
 UNIQUE(post_key,auth_user_id)
);
CREATE INDEX IF NOT EXISTS patreon_season_pending_owner_idx ON patreon_season_pending_names(auth_user_id) WHERE auth_user_id IS NOT NULL;
REVOKE ALL ON patreon_season_config,patreon_midseason_plans,patreon_midseason_drafts,patreon_season_runs,patreon_season_pending_names FROM PUBLIC;

-- A persisted successor on today's Pacific date is required for results.
-- An already-approved aggregate guide may be sent later in its active
-- season; no expired guide, edited plan or unapproved evidence is eligible.
CREATE OR REPLACE FUNCTION pack1_patreon_season_due(p_key text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $body$
 SELECT EXISTS (
  SELECT 1 FROM patreon_season_runs r
  JOIN draft_run_seasons s ON s.id=r.season_id
  WHERE r.post_key=p_key AND (
   (r.kind='season-results'
    AND r.milestone=(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date
    AND extract(hour from clock_timestamp() AT TIME ZONE 'America/Chicago')>=12
    AND EXISTS(SELECT 1 FROM patreon_season_config c WHERE c.singleton AND c.results_enabled_from<=r.milestone)
    AND s.end_date=r.milestone-1
    AND EXISTS(SELECT 1 FROM draft_run_seasons n JOIN draft_run_season_reconciliation_state st ON st.singleton AND st.last_reconciled_day>=n.start_date
        WHERE n.start_date=r.milestone AND n.set_release_date>s.set_release_date))
   OR (r.kind='midseason-guide' AND s.end_date IS NULL
    AND EXISTS(SELECT 1 FROM patreon_midseason_drafts d JOIN patreon_midseason_plans p ON p.season_id=d.season_id AND p.revision=d.plan_revision
      WHERE d.season_id=r.season_id AND d.state='approved' AND d.approved_at<=clock_timestamp()
        AND d.evidence_sha256=r.evidence_sha256 AND d.milestone=r.milestone AND d.title=r.title AND d.body=r.body))
  )
 )
$body$;
REVOKE ALL ON FUNCTION pack1_patreon_season_due(text) FROM PUBLIC;

-- Capture pending external-publication evidence at deletion commitment.
-- It is impossible to recall a request already handed to a publisher. Keep
-- only the exact name and deadline needed to remove it, without account ID.
CREATE OR REPLACE FUNCTION pack1_patreon_season_on_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $body$
BEGIN
 UPDATE patreon_season_pending_names SET auth_user_id=NULL,
  deletion_requested_at=least(coalesce(deletion_requested_at,NEW.created_at),NEW.created_at)
 WHERE auth_user_id=NEW.auth_user_id;
 RETURN NEW;
END $body$;
DROP TRIGGER IF EXISTS pack1_patreon_season_on_deletion ON account_deletion_operations;
CREATE TRIGGER pack1_patreon_season_on_deletion AFTER INSERT ON account_deletion_operations
 FOR EACH ROW EXECUTE FUNCTION pack1_patreon_season_on_deletion();

-- Final admission and receipt transition in one transaction. Acquire the
-- normal per-account deletion/consent locks in stable order before checking.
-- Names are stored only when a submission might subsequently leave the host.
CREATE OR REPLACE FUNCTION pack1_patreon_season_admit(p_key text,p_placements jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $body$
DECLARE rec record; current_state text;
BEGIN
 IF jsonb_typeof(p_placements) IS DISTINCT FROM 'array' OR jsonb_array_length(p_placements)>2000 THEN
  RAISE EXCEPTION 'SEASON_PLACEMENTS_INVALID';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM results_launch WHERE singleton AND launch_at+interval '14 days'<=clock_timestamp())
  OR clock_timestamp()<'2026-11-30T15:33:00Z'::timestamptz
  OR NOT pack1_patreon_season_due(p_key)
  OR (jsonb_array_length(p_placements)>0 AND EXISTS(SELECT 1 FROM patreon_season_runs WHERE post_key=p_key AND kind='midseason-guide')) THEN
  RETURN false;
 END IF;
 -- Reconcile duplicate placements by account, but reject conflicting names.
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_placements) AS x(auth_id uuid,name text)
   GROUP BY auth_id HAVING auth_id IS NULL OR count(DISTINCT name)<>1 OR bool_or(name IS NULL OR length(name) NOT BETWEEN 1 AND 100)) THEN
  RAISE EXCEPTION 'SEASON_PLACEMENTS_INVALID';
 END IF;
 FOR rec IN SELECT DISTINCT auth_id,name FROM jsonb_to_recordset(p_placements) AS x(auth_id uuid,name text) ORDER BY auth_id LOOP
  IF NOT pack1_identity_attachment_allowed(rec.auth_id)
   OR pack1_results_publishable_name(rec.auth_id) IS DISTINCT FROM rec.name
   OR rec.name='Anonymous player' THEN RETURN false; END IF;
 END LOOP;
 -- Lock the receipt AFTER the account locks; deletion capture never waits
 -- on a receipt while another transaction waits on the same account lock.
 SELECT state INTO current_state FROM patreon_season_runs WHERE post_key=p_key FOR UPDATE;
 IF current_state IS DISTINCT FROM 'claimed' OR NOT pack1_patreon_season_due(p_key) THEN RETURN false; END IF;
 INSERT INTO patreon_season_pending_names(post_key,auth_user_id,name_to_remove)
 SELECT DISTINCT p_key,auth_id,name FROM jsonb_to_recordset(p_placements) AS x(auth_id uuid,name text);
 UPDATE patreon_season_runs SET state='handoff',admitted_at=clock_timestamp(),last_status='admitted' WHERE post_key=p_key;
 RETURN true;
END $body$;

-- Called only after the private runner independently verifies the public post.
-- Reuse the established publication helper for each still-eligible name. If a
-- name changed or consent/deletion changed after admission, record the original
-- name and real public URL in the existing private removal queue instead.
CREATE OR REPLACE FUNCTION pack1_patreon_season_finish(p_key text,p_link text,p_at timestamptz)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $body$
DECLARE rec record; run_state text; original_url text; original_at timestamptz;
 publication uuid; requested timestamptz; why text; eligible boolean;
BEGIN
 IF p_link IS NULL OR p_link !~ '^https://www[.]patreon[.]com/posts/[0-9]+$'
   OR p_at IS NULL OR p_at>clock_timestamp()
   OR NOT EXISTS(SELECT 1 FROM results_launch WHERE singleton AND launch_at+interval '14 days'<=p_at)
   OR p_at<'2026-11-30T15:33:00Z'::timestamptz THEN RAISE EXCEPTION 'SEASON_PUBLICATION_INVALID'; END IF;
 -- Lock all still-attached accounts first. Re-read rows after the locks:
 -- a deletion that committed while waiting may have cleared an attachment.
 FOR rec IN SELECT DISTINCT auth_user_id FROM patreon_season_pending_names
   WHERE post_key=p_key AND auth_user_id IS NOT NULL ORDER BY auth_user_id LOOP
  PERFORM pack1_identity_attachment_allowed(rec.auth_user_id);
 END LOOP;
 SELECT state,public_url,published_at INTO run_state,original_url,original_at
  FROM patreon_season_runs WHERE post_key=p_key FOR UPDATE;
 IF run_state='verified' THEN RETURN original_url=p_link AND original_at=p_at; END IF;
 IF run_state IS NULL OR run_state NOT IN ('handoff','queued','review')
  OR NOT EXISTS(SELECT 1 FROM patreon_season_runs WHERE post_key=p_key AND admitted_at IS NOT NULL AND p_at>=admitted_at) THEN
  RETURN false;
 END IF;
 FOR rec IN SELECT * FROM patreon_season_pending_names WHERE post_key=p_key ORDER BY id FOR UPDATE LOOP
  publication:=NULL;
  eligible:=false;
  IF rec.auth_user_id IS NOT NULL THEN
   eligible:=pack1_identity_attachment_allowed(rec.auth_user_id);
   IF eligible AND pack1_results_publishable_name(rec.auth_user_id)=rec.name_to_remove THEN
    publication:=pack1_results_record_publication(rec.auth_user_id,'patreon',p_link,p_at);
   END IF;
  END IF;
  IF publication IS NULL THEN
   requested:=coalesce(rec.deletion_requested_at,clock_timestamp());
   why:=CASE WHEN rec.deletion_requested_at IS NOT NULL OR NOT eligible THEN 'deletion' ELSE 'request' END;
   -- A null attachment contains only removal evidence. Do not reattach a
   -- deleting identity. A changed name must never overwrite the old evidence.
   INSERT INTO results_publications(auth_user_id,channel,link,published_at,name_to_remove)
   VALUES(NULL,'patreon',p_link,p_at,rec.name_to_remove) RETURNING id INTO publication;
   INSERT INTO results_removal_tasks(publication_id,requested_at,due_at,reason)
   VALUES(publication,requested,requested+interval '28 days',why);
  END IF;
 END LOOP;
 DELETE FROM patreon_season_pending_names WHERE post_key=p_key;
 UPDATE patreon_season_runs SET state='verified',public_url=p_link,published_at=p_at,
  verified_at=clock_timestamp(),last_status='verified' WHERE post_key=p_key;
 RETURN true;
END $body$;

REVOKE ALL ON FUNCTION pack1_patreon_season_admit(text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION pack1_patreon_season_finish(text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION pack1_patreon_season_on_deletion() FROM PUBLIC;
