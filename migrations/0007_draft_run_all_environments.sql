-- Separate expansion and Powered Cube ten-decision schedules and identities.
ALTER TABLE draft_run_sessions ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'mixed' CHECK(environment IN ('mixed','powered-cube'));
-- statement
ALTER TABLE draft_run_schedules ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'mixed' CHECK(environment IN ('mixed','powered-cube'));
-- statement
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='draft_run_schedules'::regclass AND contype='p' AND array_length(conkey,1)=1) THEN
    ALTER TABLE draft_run_schedules DROP CONSTRAINT draft_run_schedules_pkey;
    ALTER TABLE draft_run_schedules ADD PRIMARY KEY(day,environment);
  END IF;
END $$;
-- statement
DROP INDEX IF EXISTS draft_run_daily_attempt_idx;
-- statement
CREATE UNIQUE INDEX draft_run_daily_attempt_idx ON draft_run_sessions(player_id,day,environment) WHERE day IS NOT NULL;
-- statement
-- Older public archives use the existing independently selected Diamond/Mythic
-- cohort rather than a win-rate bucket. Keep that evidence explicit and required.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='draft_run_verified_puzzles'::regclass
    AND contype='c' AND (pg_get_constraintdef(oid) LIKE '%player_win_rate_bucket%' OR
       pg_get_constraintdef(oid) LIKE '%pick_number >=%' OR pg_get_constraintdef(oid) LIKE '%pick_number <=%')
  LOOP
    EXECUTE format('ALTER TABLE draft_run_verified_puzzles DROP CONSTRAINT %I',c.conname);
  END LOOP;
  ALTER TABLE draft_run_verified_puzzles ADD CONSTRAINT draft_run_pick_position CHECK (
    (set_id='powered-cube' AND pick_number BETWEEN 2 AND 12) OR
    (set_id<>'powered-cube' AND pick_number BETWEEN 1 AND 11));
  ALTER TABLE draft_run_verified_puzzles ADD CONSTRAINT draft_run_evidence_required CHECK (
    ((payload->>'event_match_wins')::int=7 AND
     (payload->>'player_games_lower_bound')::int>=100 AND
     (((payload->>'player_win_rate_bucket')::numeric BETWEEN .6 AND 1) OR
      (set_id IN ('stx','mid','vow') AND payload->>'skill_evidence'='earliest_game_arena_rank' AND
       payload->>'player_rank_tier' IN ('diamond','mythic'))) AND
     jsonb_array_length(payload->'prior_picks')=pick_number-1 AND
     jsonb_array_length(payload->'candidates')=candidate_count) IS TRUE);
END $$;
-- statement
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
