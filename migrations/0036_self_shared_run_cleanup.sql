-- Remove legacy self-challenge artifacts created when a player reopened their
-- own stored Draft Run / Powered Cube share. A share is an invitation to
-- another player; the creator's original session/result remains authoritative.
CREATE TEMP TABLE pack1_self_shared_run_cleanup AS
SELECT replay.id session_id,replay.player_id,replay.challenge_id
FROM draft_run_sessions replay
JOIN draft_run_shares sh ON sh.id=replay.challenge_id
JOIN draft_run_sessions owner ON owner.id=sh.session_id
WHERE replay.id<>owner.id
  AND replay.player_id=owner.player_id;
-- statement
DELETE FROM analytics_events e
USING pack1_self_shared_run_cleanup bad
WHERE e.player_id=bad.player_id
  AND e.event_props->>'run_id'=bad.session_id::text;
-- statement
DELETE FROM game_results g
USING pack1_self_shared_run_cleanup bad
WHERE g.player_id=bad.player_id
  AND g.client_result_id='draft-run:'||bad.session_id::text;
-- statement
DELETE FROM draft_run_sessions s
USING pack1_self_shared_run_cleanup bad
WHERE s.id=bad.session_id
  AND s.player_id=bad.player_id;
-- statement
-- A bad replay could have crossed an achievement threshold. Keep legitimately
-- earned rows, but remove affected game/challenge achievements whose current
-- source data no longer satisfies the product rule after cleanup.
DELETE FROM player_achievements pa
USING (SELECT DISTINCT player_id FROM pack1_self_shared_run_cleanup) affected
WHERE pa.player_id=affected.player_id
  AND (
    (pa.achievement_id='first' AND NOT EXISTS (
      SELECT 1 FROM game_results g WHERE g.player_id=affected.player_id
    ))
    OR (pa.achievement_id='ten_games' AND (
      SELECT count(*) FROM game_results g WHERE g.player_id=affected.player_id
    )<10)
    OR (pa.achievement_id='fifty_games' AND (
      SELECT count(*) FROM game_results g WHERE g.player_id=affected.player_id
    )<50)
    OR (pa.achievement_id='hundred_games' AND (
      SELECT count(*) FROM game_results g WHERE g.player_id=affected.player_id
    )<100)
    OR (pa.achievement_id='first_run' AND (
      SELECT count(*) FROM game_results g
      WHERE g.player_id=affected.player_id AND g.mode='draft_run' AND g.set_id<>'powered-cube'
    )<1)
    OR (pa.achievement_id='ten_runs' AND (
      SELECT count(*) FROM game_results g
      WHERE g.player_id=affected.player_id AND g.mode='draft_run' AND g.set_id<>'powered-cube'
    )<10)
    OR (pa.achievement_id='run_specialist' AND NOT EXISTS (
      SELECT 1 FROM game_results g
      WHERE g.player_id=affected.player_id AND g.mode='draft_run' AND g.set_id<>'powered-cube'
      GROUP BY g.player_id HAVING count(*)>=20 AND avg(g.score)>=80
    ))
    OR (pa.achievement_id='set_specialist' AND NOT EXISTS (
      SELECT 1
      FROM (
        SELECT e.set_id,e.score
        FROM game_results g
        JOIN game_result_environments e ON e.game_result_id=g.id
        WHERE g.player_id=affected.player_id
        UNION ALL
        SELECT g.set_id,g.score
        FROM game_results g
        WHERE g.player_id=affected.player_id AND g.mode<>'draft_run'
      ) environment_results
      GROUP BY set_id HAVING count(*)>=5 AND avg(score)>=85
    ))
    OR (pa.achievement_id='perfect' AND COALESCE((
      SELECT max(g.score) FROM game_results g WHERE g.player_id=affected.player_id
    ),0)<100)
    OR (pa.achievement_id='cube_first' AND (
      SELECT count(*)
      FROM game_results g
      JOIN game_result_environments e ON e.game_result_id=g.id
      WHERE g.player_id=affected.player_id AND e.set_id='powered-cube'
    )<1)
    OR (pa.achievement_id='cube_ten' AND (
      SELECT count(*)
      FROM game_results g
      JOIN game_result_environments e ON e.game_result_id=g.id
      WHERE g.player_id=affected.player_id AND e.set_id='powered-cube'
    )<10)
    OR (pa.achievement_id='challenge5' AND (
      SELECT count(*) FROM game_results g
      WHERE g.player_id=affected.player_id AND g.outcome='win'
    )<5)
    OR (pa.achievement_id='challenge25' AND (
      SELECT count(*) FROM game_results g
      WHERE g.player_id=affected.player_id AND g.outcome='win'
    )<25)
  );
-- statement
UPDATE players p
SET showcase_achievement=NULL,updated_at=now()
WHERE p.id IN (SELECT DISTINCT player_id FROM pack1_self_shared_run_cleanup)
  AND p.showcase_achievement IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM player_achievements pa
    WHERE pa.player_id=p.id AND pa.achievement_id=p.showcase_achievement
  );
-- statement
DELETE FROM analytics_events e
USING (SELECT DISTINCT player_id FROM pack1_self_shared_run_cleanup) affected
WHERE e.player_id=affected.player_id
  AND e.event_name='achievement_unlocked'
  AND e.event_props ? 'achievement'
  AND NOT EXISTS (
    SELECT 1 FROM player_achievements pa
    WHERE pa.player_id=e.player_id
      AND pa.achievement_id=e.event_props->>'achievement'
  );
-- statement
DROP TABLE pack1_self_shared_run_cleanup;
