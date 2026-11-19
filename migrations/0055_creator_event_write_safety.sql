-- Upgrade 0054 without placing a merge-hostile unique index on analytics.
-- Creator writes require fresh Read Committed snapshots. Row UPDATE triggers
-- already hold tuple locks, so they must never wait for a player advisory lock:
-- fail with a retryable, fully rolled-back statement instead of a lock cycle.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='60s';
LOCK TABLE analytics_events IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION pack1_creator_event_assert_read_committed()
RETURNS void LANGUAGE plpgsql AS $creator_isolation$
BEGIN
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'Creator analytics writes require Read Committed isolation'
      USING ERRCODE='25001';
  END IF;
END;
$creator_isolation$;

CREATE OR REPLACE FUNCTION pack1_creator_event_write_guard()
RETURNS trigger LANGUAGE plpgsql AS $creator_event_write_guard$
DECLARE
  challenge_id text;
  existing_event analytics_events%ROWTYPE;
BEGIN
  challenge_id := NEW.event_props->>'creator_challenge_id';
  IF NEW.player_id IS NULL
     OR NEW.event_name NOT IN ('creator_challenge_open','acquisition_touch')
     OR challenge_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pack1_creator_event_assert_read_committed();

  IF TG_OP='UPDATE' THEN
    IF NOT pg_try_advisory_xact_lock(pack1_creator_event_player_lock(NEW.player_id)) THEN
      RAISE EXCEPTION 'Concurrent creator analytics identity update; retry the transaction'
        USING ERRCODE='40001';
    END IF;
  ELSE
    -- Inserts do not hold an existing event tuple while waiting. Current merges
    -- acquire both player locks in sorted order before deleting/moving events.
    PERFORM pg_advisory_xact_lock(pack1_creator_event_player_lock(NEW.player_id));
    SELECT existing.* INTO existing_event
    FROM analytics_events existing
    WHERE existing.player_id=NEW.player_id
      AND existing.event_name=NEW.event_name
      AND existing.event_name IN ('creator_challenge_open','acquisition_touch')
      AND existing.event_props ? 'creator_challenge_id'
      AND existing.event_props->>'creator_challenge_id'=challenge_id
    ORDER BY existing.created_at,existing.id
    LIMIT 1;
    IF FOUND THEN
      IF (NEW.created_at,NEW.id) < (existing_event.created_at,existing_event.id) THEN
        -- Keep the entire earliest event, including its attribution and id.
        DELETE FROM analytics_events WHERE id=existing_event.id;
      ELSE
        RETURN NULL;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$creator_event_write_guard$;

-- Timestamp/id edits also participate in earliest-event deduplication.
DROP TRIGGER creator_challenge_event_update_guard ON analytics_events;
CREATE TRIGGER creator_challenge_event_update_guard
BEFORE UPDATE ON analytics_events
FOR EACH ROW EXECUTE FUNCTION pack1_creator_event_write_guard();

-- Repair duplicates admitted under an unsupported isolation mode before 0055.
WITH ranked AS (
  SELECT id,row_number() OVER (
    PARTITION BY player_id,event_name,(event_props->>'creator_challenge_id')
    ORDER BY created_at,id
  ) duplicate_number
  FROM analytics_events
  WHERE player_id IS NOT NULL
    AND event_name IN ('creator_challenge_open','acquisition_touch')
    AND event_props ? 'creator_challenge_id'
)
DELETE FROM analytics_events event USING ranked
WHERE event.id=ranked.id AND ranked.duplicate_number>1;
COMMIT;
