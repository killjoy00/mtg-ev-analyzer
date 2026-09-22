-- Case-insensitive uniqueness for owned Pack One usernames.
--
-- `players.display_name` carries two different things. For an account-linked
-- player it is a public username that appears on the Daily leaderboard and on a
-- public profile. For an anonymous browser it is a local nickname that the
-- client replays from localStorage on every `/v1/player/session` call, and the
-- QA harnesses deliberately reuse a handful of those nicknames across many
-- guest rows. Making every custom name unique would therefore fail to build and
-- would break guest session creation, so ownership is explicit: `username_owned`
-- marks the rows whose name is a real claimed identity, and only those compete.
--
-- Public identity surfaces are already account-gated, so an unowned nickname
-- never reaches another player: the leaderboard requires an `account_links` row,
-- the ranked Daily name comes from the linked identity, and a public profile
-- requires `profile_public`, which only a linked account can set.

-- Shared normalization key. `lower()` alone would let " Ryan" and "Ryan" split
-- into two usernames, so whitespace is collapsed here too and the application
-- mirror (worker/username.mjs `usernameKey`) applies the same rule. IMMUTABLE is
-- required for the expression index below.
CREATE OR REPLACE FUNCTION pack1_username_key(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $pack1$
  SELECT lower(btrim(regexp_replace(value, '\s+', ' ', 'g')))
$pack1$;

ALTER TABLE players ADD COLUMN IF NOT EXISTS username_owned boolean NOT NULL DEFAULT false;

-- Backfill: an account-linked player already owns the name it is using. The
-- generic placeholder is never owned, and any collision here would be a real
-- pre-existing duplicate, so the index build below is the verification step
-- rather than a silent rename.
UPDATE players p
SET username_owned = true
WHERE NOT p.username_owned
  AND pack1_username_key(p.display_name) <> pack1_username_key('Pack Player')
  AND EXISTS (SELECT 1 FROM account_links a WHERE a.player_id = p.id);

-- The database is the source of truth for username uniqueness. The placeholder
-- is excluded on the normalized key so every casing of it stays shareable by
-- the anonymous and never-customized players that hold it.
CREATE UNIQUE INDEX IF NOT EXISTS players_username_uq
  ON players (pack1_username_key(display_name))
  WHERE username_owned AND pack1_username_key(display_name) <> 'pack player';

-- Extend the transactional identity merge. Two behaviors are new. The source
-- releases its reservation first, because the source row is only deleted at the
-- end of this merge and would otherwise collide with the target adopting the
-- same name. And adoption is now conditional: a name somebody else owns is left
-- alone instead of being reassigned, so account linking and guest-to-account
-- migration never steal an established username or fail on the constraint.
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
      SET display_name = adopt_name, username_owned = true, updated_at = now()
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
  UPDATE analytics_events SET player_id = target_player WHERE player_id = source_player;

  INSERT INTO player_identity_merges(source_player_id, target_player_id, reason)
  VALUES (source_player, target_player, 'account_sign_in');

  DELETE FROM players WHERE id = source_player;
END;
$$;
