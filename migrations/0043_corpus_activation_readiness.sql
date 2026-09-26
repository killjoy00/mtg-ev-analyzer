-- Derived publication readiness only. No puzzle, Daily, session or score rewrite.
-- Activation + audit + outbox commit together; the expensive build is separate.
CREATE TABLE IF NOT EXISTS draft_run_readiness_keys (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 corpus_version text NOT NULL,
 difficulty_version text NOT NULL,
 serving_policy_version text NOT NULL,
 cache_schema text NOT NULL,
 UNIQUE(corpus_version,difficulty_version,serving_policy_version,cache_schema)
);
CREATE TABLE IF NOT EXISTS draft_run_readiness_jobs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 key_id bigint NOT NULL REFERENCES draft_run_readiness_keys(id) ON DELETE CASCADE,
 revision bigint NOT NULL,
 intent jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','warming','verifying','retry_wait','ready','failed','superseded')),
 attempts integer NOT NULL DEFAULT 0,
 lease_token uuid,
 lease_expires_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 cache_snapshot_id bigint,
 worker_release text,
 evidence jsonb,
 last_error jsonb,
 retry_count integer NOT NULL DEFAULT 0,
 last_retry_identity jsonb,
 UNIQUE(key_id,revision)
);
CREATE INDEX IF NOT EXISTS draft_run_readiness_pending_idx
 ON draft_run_readiness_jobs(next_attempt_at) WHERE state IN ('queued','retry_wait','warming','verifying');
ALTER TABLE corpus_status_events ADD COLUMN IF NOT EXISTS readiness_revision bigint;
ALTER TABLE corpus_status_events ADD COLUMN IF NOT EXISTS activation_xid xid8;
ALTER TABLE corpus_status_events ALTER COLUMN activation_xid SET DEFAULT pg_current_xact_id();
CREATE INDEX IF NOT EXISTS corpus_status_events_activation_xid_idx
 ON corpus_status_events(activation_xid) WHERE readiness_revision IS NULL;

CREATE OR REPLACE FUNCTION pack1_readiness_intent(p_parent text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
  'environments',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.set_id) FROM (
   SELECT p.set_id,p.status,p.active_snapshot_id,p.regular_run,p.release_date,p.set_name,
    p.source_event_type,s.schema_version,s.corpus_version snapshot_corpus_version
   FROM draft_run_environment_policy p
   JOIN corpus_set_versions v ON v.set_id=p.set_id AND v.corpus_version=p_parent
   LEFT JOIN corpus_source_snapshots s ON s.source_snapshot_id=p.active_snapshot_id
  ) e),'[]'::jsonb),
  'components',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.set_id,c.component_version) FROM (
   SELECT set_id,component_version,status FROM corpus_components WHERE parent_version=p_parent
  ) c),'[]'::jsonb)
 );
$$;

CREATE OR REPLACE FUNCTION pack1_enqueue_readiness(p_revision bigint)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO draft_run_readiness_jobs(key_id,revision,intent)
 SELECT k.id,p_revision,pack1_readiness_intent(k.corpus_version) FROM draft_run_readiness_keys k
 ON CONFLICT(key_id,revision) DO NOTHING;
 UPDATE draft_run_readiness_jobs SET state='superseded',lease_token=NULL,lease_expires_at=NULL,
  updated_at=clock_timestamp(),finished_at=coalesce(finished_at,clock_timestamp())
 WHERE revision<p_revision AND state<>'superseded';
 -- Keep the latest 128 terminal records per cache key; never prune active work.
 DELETE FROM draft_run_readiness_jobs j WHERE j.state IN ('ready','superseded')
 AND j.id IN (SELECT old.id FROM draft_run_readiness_jobs old WHERE old.key_id=j.key_id
  AND old.state IN ('ready','superseded') ORDER BY old.revision DESC OFFSET 128);
END;
$$;

CREATE OR REPLACE FUNCTION pack1_queue_readiness_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Deferred until transaction end: capture the final active source/component
 -- state, not an intermediate CTE/trigger view during activation.
 PERFORM pack1_enqueue_readiness(NEW.revision);
 UPDATE corpus_status_events SET readiness_revision=NEW.revision
 WHERE activation_xid=pg_current_xact_id() AND readiness_revision IS NULL;
 RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS serving_readiness_outbox ON draft_run_serving_revision;
CREATE CONSTRAINT TRIGGER serving_readiness_outbox
 AFTER INSERT OR UPDATE ON draft_run_serving_revision DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION pack1_queue_readiness_change();

CREATE OR REPLACE FUNCTION pack1_register_readiness_key(p_parent text,p_difficulty text,p_policy text,p_schema text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE rev bigint; key_id bigint;
BEGIN
 -- All readiness writers take revision before job locks, matching invalidation.
 SELECT revision INTO rev FROM draft_run_serving_revision WHERE singleton FOR SHARE;
 IF p_schema<>'serving-cache-v1' OR p_difficulty<>'support-ratio-v1' OR p_policy<>'trophy-implied-score-20-v1' THEN
  RAISE EXCEPTION 'Unsupported readiness cache key';
 END IF;
 INSERT INTO draft_run_readiness_keys(corpus_version,difficulty_version,serving_policy_version,cache_schema)
 VALUES(p_parent,p_difficulty,p_policy,p_schema) ON CONFLICT DO NOTHING;
 SELECT id INTO key_id FROM draft_run_readiness_keys WHERE corpus_version=p_parent
  AND difficulty_version=p_difficulty AND serving_policy_version=p_policy AND cache_schema=p_schema;
 PERFORM pack1_enqueue_readiness(rev);
 RETURN key_id;
END;
$$;

CREATE OR REPLACE FUNCTION pack1_claim_readiness(p_key bigint,p_release text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE rev bigint; j draft_run_readiness_jobs%ROWTYPE;
BEGIN
 SELECT revision INTO rev FROM draft_run_serving_revision WHERE singleton FOR SHARE;
 SELECT * INTO j FROM draft_run_readiness_jobs WHERE key_id=p_key AND revision=rev FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF j.state='ready' AND NOT EXISTS(SELECT 1 FROM draft_run_serving_snapshots WHERE id=j.cache_snapshot_id AND revision=rev) THEN
  UPDATE draft_run_readiness_jobs SET state='queued',attempts=0,evidence=NULL,cache_snapshot_id=NULL,
   next_attempt_at=clock_timestamp(),finished_at=NULL WHERE id=j.id RETURNING * INTO j;
 END IF;
 IF NOT ((j.state IN ('queued','retry_wait') AND j.next_attempt_at<=clock_timestamp())
  OR (j.state IN ('warming','verifying') AND j.lease_expires_at<=clock_timestamp())) THEN RETURN NULL; END IF;
 IF j.attempts>=4 THEN
  UPDATE draft_run_readiness_jobs SET state='failed',lease_token=NULL,lease_expires_at=NULL,
   last_error='{"code":"attempt_limit","message":"Repeated interruption or transient failure. Inspect the operation and retry readiness."}',
   updated_at=clock_timestamp(),finished_at=clock_timestamp() WHERE id=j.id;
  RETURN NULL;
 END IF;
 UPDATE draft_run_readiness_jobs SET state='warming',attempts=attempts+1,lease_token=gen_random_uuid(),
  lease_expires_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp(),worker_release=p_release,
  evidence=NULL,cache_snapshot_id=NULL,finished_at=NULL
 WHERE id=j.id RETURNING * INTO j;
 RETURN to_jsonb(j)||jsonb_build_object('id',j.id::text,'revision',j.revision::text,'key_id',j.key_id::text);
END;
$$;

CREATE OR REPLACE FUNCTION pack1_readiness_verifying(p_id bigint,p_token uuid,p_snapshot bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE rev bigint; affected integer;
BEGIN
 SELECT revision INTO rev FROM draft_run_serving_revision WHERE singleton FOR SHARE;
 UPDATE draft_run_readiness_jobs SET state='verifying',cache_snapshot_id=p_snapshot,
  lease_expires_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp()
 WHERE id=p_id AND revision=rev AND lease_token=p_token AND state='warming' AND lease_expires_at>clock_timestamp();
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected=1;
END;
$$;

CREATE OR REPLACE FUNCTION pack1_complete_readiness(p_id bigint,p_token uuid,p_snapshot bigint,p_evidence jsonb)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE rev bigint; j draft_run_readiness_jobs%ROWTYPE; k draft_run_readiness_keys%ROWTYPE;
BEGIN
 -- The revision lock is held ONLY for this short completion transaction. A
 -- publication cannot commit between validation and writing ready.
 SELECT revision INTO rev FROM draft_run_serving_revision WHERE singleton FOR SHARE;
 SELECT * INTO j FROM draft_run_readiness_jobs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.state<>'verifying' OR j.lease_token IS DISTINCT FROM p_token
  OR j.lease_expires_at<=clock_timestamp() OR j.revision<>rev THEN RETURN false; END IF;
 SELECT * INTO k FROM draft_run_readiness_keys WHERE id=j.key_id;
 IF j.intent IS DISTINCT FROM pack1_readiness_intent(k.corpus_version) THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM draft_run_serving_snapshots s WHERE s.id=p_snapshot AND s.revision=rev
  AND s.corpus_version=k.corpus_version AND s.difficulty_version=k.difficulty_version
  AND s.serving_policy_version=k.serving_policy_version AND s.cache_schema=k.cache_schema) THEN RETURN false; END IF;
 IF p_evidence->>'revision' IS DISTINCT FROM rev::text
  OR p_evidence->>'day' IS DISTINCT FROM (clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date::text
  OR p_evidence->'inventory'->>'verified' IS DISTINCT FROM 'true'
  OR jsonb_typeof(p_evidence->'samples') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 UPDATE draft_run_readiness_jobs SET state='ready',evidence=p_evidence,cache_snapshot_id=p_snapshot,
  lease_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=clock_timestamp(),finished_at=clock_timestamp()
 WHERE id=j.id;
 RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION pack1_fail_readiness(p_id bigint,p_token uuid,p_retryable boolean,p_error jsonb)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE rev bigint; j draft_run_readiness_jobs%ROWTYPE;
BEGIN
 SELECT revision INTO rev FROM draft_run_serving_revision WHERE singleton FOR SHARE;
 SELECT * INTO j FROM draft_run_readiness_jobs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.lease_token IS DISTINCT FROM p_token OR j.state NOT IN ('warming','verifying') THEN RETURN false; END IF;
 UPDATE draft_run_readiness_jobs SET state=CASE WHEN revision<>rev THEN 'superseded'
  WHEN p_retryable AND attempts<4 THEN 'retry_wait' ELSE 'failed' END,
  lease_token=NULL,lease_expires_at=NULL,last_error=p_error,updated_at=clock_timestamp(),
  next_attempt_at=clock_timestamp()+make_interval(secs=>least(600,30*(2^greatest(0,attempts-1)))::integer),
  finished_at=CASE WHEN revision<>rev OR NOT p_retryable OR attempts>=4 THEN clock_timestamp() ELSE NULL END
 WHERE id=j.id;
 RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION pack1_retry_readiness(p_id bigint,p_identity jsonb)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE rev bigint; affected integer;
BEGIN
 SELECT revision INTO rev FROM draft_run_serving_revision WHERE singleton FOR SHARE;
 UPDATE draft_run_readiness_jobs SET state='queued',attempts=0,lease_token=NULL,lease_expires_at=NULL,
  next_attempt_at=clock_timestamp(),updated_at=clock_timestamp(),finished_at=NULL,
  retry_count=retry_count+1,last_retry_identity=p_identity
 WHERE id=p_id AND revision=rev AND (state IN ('failed','retry_wait')
  OR (state IN ('warming','verifying') AND lease_expires_at<=clock_timestamp()));
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected=1;
END;
$$;

-- Preserve the reviewed builder verbatim, including its atomic publication,
-- advisory lock, revision validation, two-generation retention and predicates.
-- Safe to replay after 0039/0041: never copy our gate over the actual builder.
DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('pack1_serving_snapshot(text,text,text)'::regprocedure) INTO definition;
 IF position('pack1_readiness_gate' IN definition)=0 THEN
  EXECUTE replace(definition,'pack1_serving_snapshot(', 'pack1_build_serving_snapshot(');
 END IF;
END;
$$;
CREATE OR REPLACE FUNCTION pack1_serving_snapshot(p_parent_version text,p_difficulty text,p_policy_version text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE k bigint; rev bigint;
BEGIN
 -- pack1_readiness_gate: registered release keys never let a player become the
 -- builder, or expose an unverified generation. Unregistered legacy/test keys
 -- retain the old primitive until the guarded release explicitly registers them.
 SELECT id INTO k FROM draft_run_readiness_keys WHERE corpus_version=p_parent_version
  AND difficulty_version=p_difficulty AND serving_policy_version=p_policy_version AND cache_schema='serving-cache-v1';
 IF k IS NOT NULL THEN
  SELECT revision INTO rev FROM draft_run_serving_revision WHERE singleton;
  IF NOT EXISTS(SELECT 1 FROM draft_run_readiness_jobs j JOIN draft_run_serving_snapshots s ON s.id=j.cache_snapshot_id
   WHERE j.key_id=k AND j.revision=rev AND j.state='ready' AND s.revision=rev
    AND s.corpus_version=p_parent_version AND s.difficulty_version=p_difficulty
    AND s.serving_policy_version=p_policy_version AND s.cache_schema='serving-cache-v1') THEN RETURN NULL; END IF;
 END IF;
 RETURN pack1_build_serving_snapshot(p_parent_version,p_difficulty,p_policy_version);
END;
$$;
