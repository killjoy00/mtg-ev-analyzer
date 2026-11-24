-- Private operational receipts for the Monday Patreon recap. Do not expose
-- these tables via a public API, GitHub artifact, or the aggregate desktop feed.
-- No scheduler is enabled by this migration. Publication remains opt-in.
CREATE TABLE IF NOT EXISTS patreon_weekly_runs (
 week_end date PRIMARY KEY CHECK(extract(isodow from week_end)=7),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 150),
 state text NOT NULL CHECK(state IN ('claimed','handoff','queued','verified','review')),
 image_sha256 text NOT NULL CHECK(image_sha256 ~ '^[a-f0-9]{64}$'),
 image_width integer NOT NULL CHECK(image_width BETWEEN 100 AND 4000),
 image_height integer NOT NULL CHECK(image_height BETWEEN 100 AND 30000),
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 admitted_at timestamptz,
 public_url text CHECK(public_url ~ '^https://www[.]patreon[.]com/posts/[0-9]+$'),
 published_at timestamptz,
 verified_at timestamptz,
 last_status text NOT NULL DEFAULT 'claimed'
);
CREATE TABLE IF NOT EXISTS patreon_weekly_pending_names (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 week_end date NOT NULL REFERENCES patreon_weekly_runs(week_end) ON DELETE CASCADE,
 auth_user_id uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
 name_to_remove text NOT NULL CHECK(length(name_to_remove) BETWEEN 1 AND 100),
 deletion_requested_at timestamptz,
 UNIQUE(week_end,auth_user_id)
);
CREATE INDEX IF NOT EXISTS patreon_weekly_pending_owner_idx
 ON patreon_weekly_pending_names(auth_user_id) WHERE auth_user_id IS NOT NULL;
REVOKE ALL ON patreon_weekly_runs,patreon_weekly_pending_names FROM PUBLIC;

-- Capture pending external-publication evidence at deletion commitment.
-- It is impossible to recall a request already handed to a publisher. Keep
-- only the exact name and deadline needed to remove it, without account ID.
CREATE OR REPLACE FUNCTION pack1_patreon_weekly_on_deletion()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
 UPDATE patreon_weekly_pending_names SET auth_user_id=NULL,
  deletion_requested_at=least(coalesce(deletion_requested_at,NEW.created_at),NEW.created_at)
 WHERE auth_user_id=NEW.auth_user_id;
 RETURN NEW;
END $body$;
DROP TRIGGER IF EXISTS pack1_patreon_weekly_on_deletion ON account_deletion_operations;
CREATE TRIGGER pack1_patreon_weekly_on_deletion AFTER INSERT ON account_deletion_operations
 FOR EACH ROW EXECUTE FUNCTION pack1_patreon_weekly_on_deletion();

-- Final admission and receipt transition in one transaction. Acquire the
-- normal per-account deletion/consent locks in stable order before checking.
-- Names are stored only when a submission might subsequently leave the host.
CREATE OR REPLACE FUNCTION pack1_patreon_weekly_admit(p_week date,p_placements jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $body$
DECLARE rec record; expected_title text; current_state text;
BEGIN
 IF jsonb_typeof(p_placements) IS DISTINCT FROM 'array' OR jsonb_array_length(p_placements)>2000 THEN
  RAISE EXCEPTION 'WEEKLY_PLACEMENTS_INVALID';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM results_launch WHERE singleton AND launch_at+interval '14 days'<=clock_timestamp())
  OR clock_timestamp()<'2026-11-30T15:33:00Z'::timestamptz
  OR extract(isodow from clock_timestamp() AT TIME ZONE 'America/Chicago')<>1
  OR extract(hour from clock_timestamp() AT TIME ZONE 'America/Chicago')<12
  OR p_week<>(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date-1 THEN
  RETURN false;
 END IF;
 -- Reconcile duplicate placements by account, but reject conflicting names.
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_placements) AS x(auth_id uuid,name text)
   GROUP BY auth_id HAVING auth_id IS NULL OR count(DISTINCT name)<>1 OR bool_or(name IS NULL OR length(name) NOT BETWEEN 1 AND 100)) THEN
  RAISE EXCEPTION 'WEEKLY_PLACEMENTS_INVALID';
 END IF;
 FOR rec IN SELECT DISTINCT auth_id,name FROM jsonb_to_recordset(p_placements) AS x(auth_id uuid,name text) ORDER BY auth_id LOOP
  IF NOT pack1_identity_attachment_allowed(rec.auth_id)
   OR pack1_results_publishable_name(rec.auth_id) IS DISTINCT FROM rec.name
   OR rec.name='Anonymous player' THEN RETURN false; END IF;
 END LOOP;
 -- Lock the receipt AFTER the account locks; deletion capture never waits
 -- on a receipt while another transaction waits on the same account lock.
 SELECT state INTO current_state FROM patreon_weekly_runs WHERE week_end=p_week FOR UPDATE;
 IF current_state IS DISTINCT FROM 'claimed' THEN RETURN false; END IF;
 INSERT INTO patreon_weekly_pending_names(week_end,auth_user_id,name_to_remove)
 SELECT DISTINCT p_week,auth_id,name FROM jsonb_to_recordset(p_placements) AS x(auth_id uuid,name text);
 UPDATE patreon_weekly_runs SET state='handoff',admitted_at=clock_timestamp(),last_status='admitted' WHERE week_end=p_week;
 RETURN true;
END $body$;

-- Called only after the private runner independently verifies the public post.
-- Reuse the established publication helper for each still-eligible name. If a
-- name changed or consent/deletion changed after admission, record the original
-- name and real public URL in the existing private removal queue instead.
CREATE OR REPLACE FUNCTION pack1_patreon_weekly_finish(p_week date,p_link text,p_at timestamptz)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $body$
DECLARE rec record; run_state text; original_url text; original_at timestamptz;
 publication uuid; requested timestamptz; why text; eligible boolean;
BEGIN
 IF p_link IS NULL OR p_link !~ '^https://www[.]patreon[.]com/posts/[0-9]+$'
   OR p_at IS NULL OR p_at>clock_timestamp()
   OR NOT EXISTS(SELECT 1 FROM results_launch WHERE singleton AND launch_at+interval '14 days'<=p_at)
   OR p_at<'2026-11-30T15:33:00Z'::timestamptz THEN RAISE EXCEPTION 'WEEKLY_PUBLICATION_INVALID'; END IF;
 -- Lock all still-attached accounts first. Re-read rows after the locks:
 -- a deletion that committed while waiting may have cleared an attachment.
 FOR rec IN SELECT DISTINCT auth_user_id FROM patreon_weekly_pending_names
   WHERE week_end=p_week AND auth_user_id IS NOT NULL ORDER BY auth_user_id LOOP
  PERFORM pack1_identity_attachment_allowed(rec.auth_user_id);
 END LOOP;
 SELECT state,public_url,published_at INTO run_state,original_url,original_at
  FROM patreon_weekly_runs WHERE week_end=p_week FOR UPDATE;
 IF run_state='verified' THEN RETURN original_url=p_link AND original_at=p_at; END IF;
 IF run_state IS NULL OR run_state NOT IN ('handoff','queued','review')
  OR NOT EXISTS(SELECT 1 FROM patreon_weekly_runs WHERE week_end=p_week AND admitted_at IS NOT NULL AND p_at>=admitted_at) THEN
  RETURN false;
 END IF;
 FOR rec IN SELECT * FROM patreon_weekly_pending_names WHERE week_end=p_week ORDER BY id FOR UPDATE LOOP
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
 DELETE FROM patreon_weekly_pending_names WHERE week_end=p_week;
 UPDATE patreon_weekly_runs SET state='verified',public_url=p_link,published_at=p_at,
  verified_at=clock_timestamp(),last_status='verified' WHERE week_end=p_week;
 RETURN true;
END $body$;

REVOKE ALL ON FUNCTION pack1_patreon_weekly_admit(date,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION pack1_patreon_weekly_finish(date,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION pack1_patreon_weekly_on_deletion() FROM PUBLIC;
