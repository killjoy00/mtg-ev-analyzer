-- Conversion cohorts count player identities, not verified unique humans.
-- These legacy views do not exclude QA or restrict to primary game modes.
-- Recent cohorts have had less time to finish, return, or claim an account.
SELECT *,round(started::numeric/nullif(visitors,0),3) visitor_to_start,
  round(completed_first::numeric/nullif(visitors,0),3) visitor_to_result,
  round(played_second::numeric/nullif(completed_first,0),3) result_to_second_game,
  round(claimed_after_result::numeric/nullif(completed_first,0),3) result_to_claim,
  round(published_after_claim::numeric/nullif(claimed_accounts,0),3) claim_to_public_profile
FROM analytics_retention_cohorts ORDER BY cohort_day DESC;

-- SUPERSEDED: analytics_daily_next_day_retention is retained for schema
-- compatibility only. It reads ranked scores, excludes guests, and is not the
-- launch retention KPI. The admin measurements endpoint now derives first-Daily
-- next-day, 7-day, and 3-in-7 metrics from completed draft_run_sessions.
SELECT *,round(returned_next_day::numeric/nullif(completed_players,0),3) next_day_return_rate
FROM analytics_daily_next_day_retention ORDER BY day DESC;

-- Diagnostic event coverage; do not interpret these counts as unique people.
SELECT (created_at AT TIME ZONE 'America/Los_Angeles')::date AS day,event_name,
  event_props->>'mode' mode,count(*) events,count(DISTINCT player_id) players
FROM analytics_events WHERE created_at>now()-interval '30 days'
GROUP BY day,event_name,event_props->>'mode' ORDER BY day DESC,event_name;
