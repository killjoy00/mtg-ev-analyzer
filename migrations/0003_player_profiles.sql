-- Player identity, public-profile metadata, and history support.
-- This migration is additive; public profiles are opt-in.

ALTER TABLE players ADD COLUMN IF NOT EXISTS profile_key text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS profile_public boolean NOT NULL DEFAULT false;
ALTER TABLE players ADD COLUMN IF NOT EXISTS favorite_set_id text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS showcase_achievement text;

UPDATE players
SET profile_key = substr(md5(id::text || ':pack1-profile-v1'), 1, 16)
WHERE profile_key IS NULL OR profile_key = '';

ALTER TABLE players
  ALTER COLUMN profile_key SET DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 16),
  ALTER COLUMN profile_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS players_profile_key_uq ON players(profile_key);
CREATE INDEX IF NOT EXISTS players_public_profile_idx
  ON players(profile_key)
  WHERE profile_public = true;
CREATE INDEX IF NOT EXISTS game_results_player_cursor_idx
  ON game_results(player_id, id DESC);

CREATE TABLE IF NOT EXISTS player_identity_merges (
  id bigserial PRIMARY KEY,
  source_player_id uuid NOT NULL,
  target_player_id uuid NOT NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT 'account_sign_in'
);
CREATE INDEX IF NOT EXISTS player_identity_merges_target_idx
  ON player_identity_merges(target_player_id, merged_at DESC);

CREATE OR REPLACE FUNCTION merge_pack1_player(source_player uuid, target_player uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
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

  -- Preserve the established account profile key. Only adopt optional profile
  -- choices (and a non-default display name) when the target does not have one.
  UPDATE players AS target
  SET display_name = CASE
        WHEN target.display_name = 'Pack Player' AND source.display_name <> 'Pack Player'
          THEN source.display_name
        ELSE target.display_name
      END,
      favorite_set_id = COALESCE(target.favorite_set_id, source.favorite_set_id),
      showcase_achievement = COALESCE(target.showcase_achievement, source.showcase_achievement),
      updated_at = now()
  FROM players AS source
  WHERE target.id = target_player AND source.id = source_player;

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
  ON CONFLICT (player_id, challenge_date, set_id, mode) DO NOTHING;
  DELETE FROM scores WHERE player_id = source_player;

  UPDATE share_challenges SET player_id = target_player WHERE player_id = source_player;
  UPDATE analytics_events SET player_id = target_player WHERE player_id = source_player;

  INSERT INTO player_identity_merges(source_player_id, target_player_id, reason)
  VALUES (source_player, target_player, 'account_sign_in');

  DELETE FROM players WHERE id = source_player;
END;
$$;
