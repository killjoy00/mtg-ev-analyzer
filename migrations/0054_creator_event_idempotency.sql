-- Creator challenge open/acquisition idempotency.
--
-- Rollout must stay safe for workers and account merges that started before
-- this migration committed. Do not use a player-scoped unique index here:
-- an already-running pre-0054 merge would otherwise resume into a 23505.
--
-- Instead, the database serializes creator-event inserts/identity moves with
-- advisory locks and dedupes player-id updates after the statement completes.
-- That makes old workers and the pre-0054 merge body compatible with the new
-- invariant throughout a rolling deploy.
BEGIN;
SET LOCAL lock_timeout='10s';

LOCK TABLE analytics_events IN SHARE ROW EXCLUSIVE MODE;

DROP INDEX IF EXISTS analytics_creator_challenge_event_uq;
DROP INDEX IF EXISTS analytics_creator_challenge_dedup_lookup_idx;
DROP TRIGGER IF EXISTS creator_challenge_event_insert_guard ON analytics_events;
DROP TRIGGER IF EXISTS creator_challenge_event_update_guard ON analytics_events;
DROP TRIGGER IF EXISTS creator_challenge_event_update_dedupe ON analytics_events;
DROP FUNCTION IF EXISTS pack1_lock_creator_challenge_events(uuid,uuid);
DROP FUNCTION IF EXISTS pack1_creator_event_insert_guard();

CREATE OR REPLACE FUNCTION pack1_creator_event_player_lock(target_player uuid)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
STRICT
AS $creator_event_player_lock$
  SELECT hashtextextended('pack1:creator-event-player:'||target_player::text,0);
$creator_event_player_lock$;

CREATE OR REPLACE FUNCTION pack1_creator_event_write_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $creator_event_write_guard$
DECLARE
  challenge_id text;
BEGIN
  challenge_id := NEW.event_props->>'creator_challenge_id';
  IF NEW.player_id IS NULL
     OR NEW.event_name NOT IN ('creator_challenge_open','acquisition_touch')
     OR challenge_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Inserts and player-id moves for one identity share the same lock. An old
  -- worker that does not know about 0054 therefore serializes with a merge as
  -- soon as PostgreSQL reaches this trigger.
  PERFORM pg_advisory_xact_lock(pack1_creator_event_player_lock(NEW.player_id));

  IF TG_OP='INSERT' AND EXISTS (
    SELECT 1
    FROM analytics_events existing
    WHERE existing.player_id=NEW.player_id
      AND existing.event_name=NEW.event_name
      AND existing.event_props->>'creator_challenge_id'=challenge_id
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$creator_event_write_guard$;

CREATE OR REPLACE FUNCTION pack1_creator_event_update_dedupe()
RETURNS trigger
LANGUAGE plpgsql
AS $creator_event_update_dedupe$
BEGIN
  -- Run once after the whole UPDATE statement so an old merge can move every
  -- source row first. Then collapse only keys touched by that statement,
  -- preserving the earliest full event row and its acquisition properties.
  WITH touched AS (
    SELECT DISTINCT player_id,event_name,event_props->>'creator_challenge_id' challenge_id
    FROM creator_event_updates
    WHERE player_id IS NOT NULL
      AND event_name IN ('creator_challenge_open','acquisition_touch')
      AND event_props ? 'creator_challenge_id'
  ), ranked AS (
    SELECT e.id,
      row_number() OVER (
        PARTITION BY e.player_id,e.event_name,(e.event_props->>'creator_challenge_id')
        ORDER BY e.created_at,e.id
      ) duplicate_number
    FROM analytics_events e
    JOIN touched t
      ON t.player_id=e.player_id
     AND t.event_name=e.event_name
     AND t.challenge_id=e.event_props->>'creator_challenge_id'
  )
  DELETE FROM analytics_events event
  USING ranked
  WHERE event.id=ranked.id
    AND ranked.duplicate_number>1;

  RETURN NULL;
END;
$creator_event_update_dedupe$;

CREATE TRIGGER creator_challenge_event_insert_guard
BEFORE INSERT ON analytics_events
FOR EACH ROW EXECUTE FUNCTION pack1_creator_event_write_guard();

CREATE TRIGGER creator_challenge_event_update_guard
BEFORE UPDATE OF player_id,event_name,event_props ON analytics_events
FOR EACH ROW EXECUTE FUNCTION pack1_creator_event_write_guard();

CREATE TRIGGER creator_challenge_event_update_dedupe
AFTER UPDATE ON analytics_events
REFERENCING NEW TABLE AS creator_event_updates
FOR EACH STATEMENT EXECUTE FUNCTION pack1_creator_event_update_dedupe();

WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY player_id,event_name,(event_props->>'creator_challenge_id')
      ORDER BY created_at,id
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

CREATE INDEX IF NOT EXISTS analytics_creator_challenge_event_lookup_idx
  ON analytics_events(player_id,event_name,(event_props->>'creator_challenge_id'),created_at,id)
  WHERE player_id IS NOT NULL
    AND event_name IN ('creator_challenge_open','acquisition_touch')
    AND event_props ? 'creator_challenge_id';

CREATE INDEX IF NOT EXISTS analytics_creator_challenge_funnel_idx
  ON analytics_events((event_props->>'creator_challenge_id'),event_name,player_id)
  WHERE event_name IN ('creator_challenge_open','creator_challenge_started')
    AND event_props ? 'creator_challenge_id';

CREATE OR REPLACE FUNCTION merge_pack1_player(source_player uuid, target_player uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  adopt_name text;
  source_creator_lock bigint;
  target_creator_lock bigint;
BEGIN
  IF source_player IS NULL OR target_player IS NULL OR source_player = target_player THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM players WHERE id = source_player) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM players WHERE id = target_player) THEN
    RAISE EXCEPTION 'Target Pack One player does not exist';
  END IF;
  IF EXISTS (SELECT 1 FROM account_links WHERE player_id = source_player) THEN
    RAISE EXCEPTION 'Refusing to merge an already-linked Pack One player';
  END IF;

  UPDATE players SET username_owned = false WHERE id = source_player AND username_owned;

  SELECT source.display_name INTO adopt_name
  FROM players source, players target
  WHERE source.id = source_player
    AND target.id = target_player
    AND pack1_username_key(target.display_name) = 'pack player'
    AND pack1_username_key(source.display_name) <> 'pack player'
    AND NOT EXISTS (
      SELECT 1 FROM players other
      WHERE other.id <> target_player
        AND other.username_owned
        AND pack1_username_key(other.display_name) = pack1_username_key(source.display_name)
    );

  -- The merge may carry a free guest nickname onto the account player, but it
  -- stays unowned here; the application reserves it right after sign-in only
  -- when it passes the prohibited-name filter and is not moderated.

  -- Preserve the established account profile key. Only adopt optional profile
  -- choices (and a free non-default display name) when the target has none.
  UPDATE players AS target
  SET favorite_set_id = COALESCE(target.favorite_set_id, source.favorite_set_id),
      showcase_achievement = COALESCE(target.showcase_achievement, source.showcase_achievement),
      updated_at = now()
  FROM players AS source
  WHERE target.id = target_player AND source.id = source_player;

  IF adopt_name IS NOT NULL THEN
    BEGIN
      UPDATE players
      SET display_name = adopt_name, username_owned = false, updated_at = now()
      WHERE id = target_player;
    EXCEPTION WHEN unique_violation THEN
      -- Another identity claimed this username between the check and the write.
      -- The legitimate owner keeps it; this player keeps the placeholder.
      NULL;
    END;
  END IF;

  INSERT INTO game_results(
    player_id, played_at, set_id, mode, score, grade, seed, is_daily,
    challenge_id, opponent_name, opponent_score, outcome, client_result_id
  )
  SELECT
    target_player, played_at, set_id, mode, score, grade, seed, is_daily,
    challenge_id, opponent_name, opponent_score, outcome, client_result_id
  FROM game_results
  WHERE player_id = source_player
  ON CONFLICT (player_id, client_result_id) DO NOTHING;
  -- Preserve per-environment Draft Run progress before replacing result IDs.
  INSERT INTO game_result_environments(game_result_id,set_id,score)
  SELECT target.id,e.set_id,e.score
  FROM game_results source
  JOIN game_result_environments e ON e.game_result_id=source.id
  JOIN game_results target ON target.player_id=target_player AND target.client_result_id=source.client_result_id
  WHERE source.player_id=source_player
  ON CONFLICT DO NOTHING;
  DELETE FROM game_results WHERE player_id = source_player;

  -- Daily scoring is first-attempt-only. If both identities already have the
  -- same Daily key, retain the established account's authoritative attempt.
  INSERT INTO scores(
    player_id, challenge_date, set_id, mode, score, grade, top1, top2, top3,
    selections_json, details_json, is_featured, created_at
  )
  SELECT
    target_player, challenge_date, set_id, mode, score, grade, top1, top2, top3,
    selections_json, details_json, is_featured, created_at
  FROM scores
  WHERE player_id = source_player
    AND NOT (mode='draft_run' AND EXISTS (
      SELECT 1 FROM draft_run_sessions target
      WHERE target.player_id=target_player AND target.day=scores.challenge_date AND target.environment=scores.set_id
    ))
  ON CONFLICT (player_id, challenge_date, set_id, mode) DO NOTHING;
  DELETE FROM scores WHERE player_id = source_player;

  -- Preserve the target account's first Daily attempt. A conflicting guest
  -- run remains accessible as practice, with its original date recorded.
  UPDATE draft_run_sessions source
  SET merged_daily_date=source.day,day=NULL
  WHERE source.player_id=source_player AND source.day IS NOT NULL
    AND EXISTS(SELECT 1 FROM draft_run_sessions target WHERE target.player_id=target_player AND target.day=source.day AND target.environment=source.environment);
  UPDATE draft_run_sessions SET player_id=target_player WHERE player_id=source_player;
  INSERT INTO player_achievements(player_id,achievement_id,earned_at)
  SELECT target_player,achievement_id,earned_at FROM player_achievements WHERE player_id=source_player
  ON CONFLICT(player_id,achievement_id) DO UPDATE SET earned_at=least(player_achievements.earned_at,EXCLUDED.earned_at);
  DELETE FROM player_achievements WHERE player_id=source_player;

  UPDATE share_challenges SET player_id = target_player WHERE player_id = source_player;

  -- Creator open/acquisition telemetry is one event per merged person,
  -- challenge and event name. Take the same player-level advisory locks used
  -- by the insert guard so no creator-event writer can race this identity move.
  source_creator_lock := pack1_creator_event_player_lock(source_player);
  target_creator_lock := pack1_creator_event_player_lock(target_player);
  PERFORM pg_advisory_xact_lock(LEAST(source_creator_lock,target_creator_lock));
  IF source_creator_lock <> target_creator_lock THEN
    PERFORM pg_advisory_xact_lock(GREATEST(source_creator_lock,target_creator_lock));
  END IF;

  -- Preserve the earliest attribution/open across the two identities, then
  -- move the surviving source telemetry. This prevents the unique invariant
  -- below from turning a legitimate guest-to-account merge into error 23505.
  WITH creator_funnel_ranked AS (
    SELECT id,
      row_number() OVER (
        PARTITION BY event_name,(event_props->>'creator_challenge_id')
        ORDER BY created_at,id
      ) AS duplicate_number
    FROM analytics_events
    WHERE player_id IN (source_player,target_player)
      AND event_name IN ('creator_challenge_open','acquisition_touch')
      AND event_props ? 'creator_challenge_id'
  )
  DELETE FROM analytics_events event
  USING creator_funnel_ranked ranked
  WHERE event.id=ranked.id
    AND ranked.duplicate_number>1;

  UPDATE analytics_events SET player_id = target_player WHERE player_id = source_player;

  INSERT INTO player_identity_merges(source_player_id, target_player_id, reason)
  VALUES (source_player, target_player, 'account_sign_in');

  DELETE FROM players WHERE id = source_player;
END;
$$;

COMMIT;
