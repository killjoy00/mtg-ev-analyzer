-- Pack One viral-loop funnel. Read-only; safe to run against production.
WITH daily AS (
  SELECT
    created_at::date AS day,
    count(*) FILTER (WHERE event_name='page_view') AS page_views,
    count(*) FILTER (WHERE event_name='game_start') AS game_starts,
    count(*) FILTER (WHERE event_name='game_reveal') AS game_reveals,
    count(*) FILTER (WHERE event_name='share_click') AS share_clicks,
    count(*) FILTER (WHERE event_name='share_completed') AS share_completions,
    count(*) FILTER (WHERE event_name='challenge_open') AS challenge_opens,
    count(*) FILTER (WHERE event_name='challenge_start') AS challenge_starts,
    count(*) FILTER (WHERE event_name='challenge_complete') AS challenge_completions,
    count(*) FILTER (WHERE event_name='share_completed' AND event_props->>'method' LIKE 'native%') AS native_shares,
    count(*) FILTER (WHERE event_name='share_completed' AND event_props->>'method' LIKE 'copy%') AS copied_shares,
    count(DISTINCT event_props->>'seed') FILTER (WHERE event_name='share_completed' AND event_props ? 'seed') AS shared_seeds,
    count(DISTINCT player_id) FILTER (WHERE player_id IS NOT NULL) AS identified_players
  FROM analytics_events
  GROUP BY created_at::date
)
SELECT *,
  round(share_completions::numeric / NULLIF(game_reveals,0), 3) AS shares_per_reveal,
  round(challenge_opens::numeric / NULLIF(share_completions,0), 3) AS opens_per_share,
  round(challenge_starts::numeric / NULLIF(challenge_opens,0), 3) AS challenge_start_rate,
  round(challenge_completions::numeric / NULLIF(challenge_starts,0), 3) AS challenge_completion_rate,
  round(challenge_completions::numeric / NULLIF(game_reveals,0), 3) AS viral_completion_rate
FROM daily
ORDER BY day DESC;
