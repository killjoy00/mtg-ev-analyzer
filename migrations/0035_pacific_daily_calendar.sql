-- Pack One's product/Daily day now follows America/Los_Angeles.
-- These are views over raw timestamps and challenge dates, so no stored
-- aggregate rebuild is required. Historical rows remain unchanged; querying
-- the views re-buckets timestamp-based cohorts under the Pacific calendar.
CREATE OR REPLACE VIEW analytics_retention_cohorts AS
SELECT (first_visit_at AT TIME ZONE 'America/Los_Angeles')::date cohort_day,
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
  WHERE challenge_date<(now() AT TIME ZONE 'America/Los_Angeles')::date
)
SELECT challenge_date AS day,count(*) completed_players,
  count(*) FILTER(WHERE EXISTS(
    SELECT 1 FROM analytics_events e WHERE e.player_id=c.player_id AND e.event_name='page_view'
      AND e.created_at>=((c.challenge_date+1)::timestamp AT TIME ZONE 'America/Los_Angeles')
      AND e.created_at<((c.challenge_date+2)::timestamp AT TIME ZONE 'America/Los_Angeles')
  )) returned_next_day,
  challenge_date+1<(now() AT TIME ZONE 'America/Los_Angeles')::date observation_complete
FROM completed c GROUP BY challenge_date;
