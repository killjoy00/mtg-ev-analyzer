-- Make creator challenge open/acquisition events idempotent under concurrent reads.
-- The application already treats one event per player/challenge/event name as
-- the invariant. Remove any historical race duplicates before enforcing it.

WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY player_id,event_name,(event_props->>'creator_challenge_id')
      ORDER BY id
    ) AS duplicate_number
  FROM analytics_events
  WHERE player_id IS NOT NULL
    AND event_name IN ('creator_challenge_open','acquisition_touch')
    AND event_props ? 'creator_challenge_id'
)
DELETE FROM analytics_events event
USING ranked
WHERE event.id=ranked.id
  AND ranked.duplicate_number>1;

CREATE UNIQUE INDEX IF NOT EXISTS analytics_creator_challenge_event_uq
  ON analytics_events(player_id,event_name,(event_props->>'creator_challenge_id'))
  WHERE player_id IS NOT NULL
    AND event_name IN ('creator_challenge_open','acquisition_touch')
    AND event_props ? 'creator_challenge_id';
