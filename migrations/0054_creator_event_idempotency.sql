-- Serialize creator challenge open/acquisition writes without imposing a
-- player-scoped uniqueness constraint that can break identity merges.
--
-- The helper takes a transaction-scoped advisory lock for one player/challenge
-- pair, then keeps the earliest copy of any pre-existing duplicate event. New
-- runtime writes call this helper before their NOT EXISTS insert.
CREATE OR REPLACE FUNCTION pack1_lock_creator_challenge_events(
  target_player uuid,
  target_challenge uuid
)
RETURNS void
LANGUAGE plpgsql
AS $creator_event_lock$
BEGIN
  IF target_player IS NULL OR target_challenge IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'pack1:creator-events:'||target_player::text||':'||target_challenge::text,
      0
    )
  );

  DELETE FROM analytics_events duplicate
  USING analytics_events keeper
  WHERE duplicate.player_id=target_player
    AND keeper.player_id=target_player
    AND duplicate.event_name=keeper.event_name
    AND duplicate.event_name IN ('creator_challenge_open','acquisition_touch')
    AND duplicate.event_props->>'creator_challenge_id'=target_challenge::text
    AND keeper.event_props->>'creator_challenge_id'=target_challenge::text
    AND (keeper.created_at,keeper.id)<(duplicate.created_at,duplicate.id);
END;
$creator_event_lock$;

CREATE INDEX IF NOT EXISTS analytics_creator_challenge_dedup_lookup_idx
  ON analytics_events(player_id,event_name,(event_props->>'creator_challenge_id'),created_at,id)
  WHERE player_id IS NOT NULL
    AND event_name IN ('creator_challenge_open','acquisition_touch')
    AND event_props ? 'creator_challenge_id';

CREATE INDEX IF NOT EXISTS analytics_creator_challenge_funnel_idx
  ON analytics_events((event_props->>'creator_challenge_id'),event_name,player_id)
  WHERE event_name IN ('creator_challenge_open','creator_challenge_started')
    AND event_props ? 'creator_challenge_id';
