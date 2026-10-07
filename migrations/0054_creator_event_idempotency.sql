-- Make creator challenge open/acquisition events idempotent under concurrent
-- reads without breaking guest-to-account identity merges.
--
-- The table lock intentionally spans cleanup and index creation. Existing
-- workers can continue writing until the lock is acquired; once acquired, no
-- writer can recreate a duplicate before the unique index is visible at COMMIT.
BEGIN;

LOCK TABLE analytics_events IN SHARE ROW EXCLUSIVE MODE;

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

CREATE UNIQUE INDEX IF NOT EXISTS analytics_creator_challenge_event_uq
  ON analytics_events(player_id,event_name,(event_props->>'creator_challenge_id'))
  WHERE player_id IS NOT NULL
    AND event_name IN ('creator_challenge_open','acquisition_touch')
    AND event_props ? 'creator_challenge_id';

CREATE OR REPLACE FUNCTION merge_pack1_player(source_player uuid, target_player uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  adopt_name text;
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
  -- Creator funnel identity is per merged person. The partial unique index below
  -- enforces one open/acquisition event per player/challenge/event, so collapse
  -- overlapping guest/account rows before moving the source identity. Locking
  -- the analytics table closes the concurrent-insert window and preserves the
  -- earliest attribution row deterministically.
  LOCK TABLE analytics_events IN SHARE ROW EXCLUSIVE MODE;
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
