-- Patreon purchase-to-activation funnel. Read-only; safe to run against production.
-- A browser visit id is written as event_props.session_id by retention-events.mjs
-- and survives the Pack One -> Patreon -> Pack One round trip in the same tab.
WITH journey AS (
  SELECT
    event_props->>'session_id' AS session_id,
    min(created_at) FILTER (WHERE event_name='elite_upgrade_handoff') AS handoff_at,
    min(created_at) FILTER (WHERE event_name='patreon_activation_started') AS activation_started_at,
    min(created_at) FILTER (WHERE event_name='patreon_activation_oauth_started') AS oauth_started_at,
    min(created_at) FILTER (WHERE event_name='patreon_activation_succeeded') AS activated_at
  FROM analytics_events
  WHERE created_at >= now()-interval '30 days'
    AND event_name IN (
      'elite_upgrade_handoff',
      'patreon_activation_started',
      'patreon_activation_oauth_started',
      'patreon_activation_succeeded'
    )
    AND coalesce(event_props->>'session_id','') <> ''
  GROUP BY event_props->>'session_id'
)
SELECT
  count(*) FILTER (WHERE handoff_at IS NOT NULL) AS patreon_handoff_sessions,
  count(*) FILTER (
    WHERE handoff_at IS NOT NULL
      AND activation_started_at >= handoff_at
  ) AS handoff_sessions_reaching_activation,
  round(
    count(*) FILTER (
      WHERE handoff_at IS NOT NULL
        AND activation_started_at >= handoff_at
    )::numeric
    / nullif(count(*) FILTER (WHERE handoff_at IS NOT NULL),0),
    3
  ) AS handoff_to_activation_rate,
  count(*) FILTER (WHERE activation_started_at IS NOT NULL) AS activation_sessions,
  count(*) FILTER (
    WHERE activation_started_at IS NOT NULL
      AND oauth_started_at >= activation_started_at
  ) AS activation_sessions_reaching_oauth,
  count(*) FILTER (
    WHERE activation_started_at IS NOT NULL
      AND activated_at >= activation_started_at
  ) AS activated_sessions,
  count(*) FILTER (
    WHERE activation_started_at IS NOT NULL
      AND (activated_at IS NULL OR activated_at < activation_started_at)
  ) AS abandoned_activation_sessions,
  round(
    count(*) FILTER (
      WHERE activation_started_at IS NOT NULL
        AND activated_at >= activation_started_at
    )::numeric
    / nullif(count(*) FILTER (WHERE activation_started_at IS NOT NULL),0),
    3
  ) AS activation_success_rate
FROM journey;
