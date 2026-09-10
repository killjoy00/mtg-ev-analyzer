-- Additive reporting views. Identity merges keep the player key continuous.
CREATE OR REPLACE VIEW analytics_player_career_funnel AS
WITH visits AS (
  SELECT player_id,min(created_at) FILTER(WHERE event_name='page_view') first_visit_at,
    min(created_at) FILTER(WHERE event_name IN('game_start','game_started','daily_started','cube_started')) first_start_at,
    min(created_at) FILTER(WHERE event_name='public_profile_enabled') public_enabled_at
  FROM analytics_events WHERE player_id IS NOT NULL GROUP BY player_id
), ordered_games AS (
  SELECT player_id,played_at,row_number() OVER(PARTITION BY player_id ORDER BY played_at,id) ordinal
  FROM game_results
), games AS (
  SELECT player_id,min(played_at) FILTER(WHERE ordinal=1) first_result_at,
    min(played_at) FILTER(WHERE ordinal=2) second_result_at,count(*) games
  FROM ordered_games GROUP BY player_id
)
SELECT v.player_id,v.first_visit_at,v.first_start_at,g.first_result_at,g.second_result_at,
  a.claimed_at,v.public_enabled_at,coalesce(g.games,0) games
FROM visits v LEFT JOIN games g USING(player_id) LEFT JOIN account_links a USING(player_id);
-- statement
CREATE OR REPLACE VIEW analytics_retention_cohorts AS
SELECT (first_visit_at AT TIME ZONE 'America/New_York')::date cohort_day,
  count(*) visitors,
  count(*) FILTER(WHERE first_start_at>=first_visit_at) started,
  count(*) FILTER(WHERE first_result_at>=first_visit_at) completed_first,
  count(*) FILTER(WHERE first_result_at>=first_visit_at AND second_result_at>=first_result_at) played_second,
  count(*) FILTER(WHERE first_result_at>=first_visit_at AND claimed_at>=first_result_at) claimed_after_result,
  count(*) FILTER(WHERE claimed_at>=first_visit_at AND public_enabled_at>=claimed_at) published_after_claim,
  count(*) FILTER(WHERE claimed_at>=first_visit_at) claimed_accounts
FROM analytics_player_career_funnel WHERE first_visit_at IS NOT NULL
GROUP BY cohort_day;
-- statement
CREATE OR REPLACE VIEW analytics_daily_next_day_retention AS
WITH completed AS (
  SELECT DISTINCT player_id,challenge_date FROM scores
  WHERE challenge_date<(now() AT TIME ZONE 'America/New_York')::date
)
SELECT challenge_date AS day,count(*) completed_players,
  count(*) FILTER(WHERE EXISTS(
    SELECT 1 FROM analytics_events e WHERE e.player_id=c.player_id AND e.event_name='page_view'
      AND e.created_at>=((c.challenge_date+1)::timestamp AT TIME ZONE 'America/New_York')
      AND e.created_at<((c.challenge_date+2)::timestamp AT TIME ZONE 'America/New_York')
  )) returned_next_day,
  challenge_date+1<(now() AT TIME ZONE 'America/New_York')::date observation_complete
FROM completed c GROUP BY challenge_date;
