-- Patreon purchase-to-activation funnel. Read-only; safe to run against production.
-- Browser events are UX-stage markers only. The authoritative numerator is the
-- server-written elite_activated transition emitted when Patreon premium grants
-- move from revoked/not-present to active.
--
-- A browser visit id is written as event_props.session_id by retention-events.mjs
-- and survives the Pack One -> Patreon -> Pack One round trip in the same tab.
-- Conversion/abandonment uses a 24-hour maturity window so an hourly provider
-- reconciliation can land without a fresh journey being mislabeled abandoned.
WITH browser_journey AS (
  SELECT
    event_props->>'session_id' AS session_id,
    (array_agg(player_id ORDER BY created_at DESC)
      FILTER (WHERE player_id IS NOT NULL))[1] AS player_id,
    min(created_at) FILTER (WHERE event_name='elite_upgrade_handoff') AS handoff_at,
    min(created_at) FILTER (WHERE event_name='patreon_activation_started') AS activation_started_at,
    min(created_at) FILTER (WHERE event_name='patreon_activation_oauth_started') AS oauth_started_at,
    min(created_at) FILTER (WHERE event_name='patreon_activation_succeeded') AS browser_success_at
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
), journey AS (
  SELECT
    browser_journey.*,
    authoritative.activated_at
  FROM browser_journey
  LEFT JOIN LATERAL (
    SELECT ae.created_at AS activated_at
    FROM analytics_events ae
    WHERE ae.event_name='elite_activated'
      AND ae.player_id=browser_journey.player_id
      AND ae.created_at >= coalesce(browser_journey.handoff_at,browser_journey.activation_started_at)
      AND ae.created_at < coalesce(browser_journey.handoff_at,browser_journey.activation_started_at)+interval '24 hours'
    ORDER BY ae.created_at
    LIMIT 1
  ) authoritative ON browser_journey.player_id IS NOT NULL
)
SELECT
  count(*) FILTER (WHERE handoff_at IS NOT NULL) AS patreon_handoff_sessions,
  count(*) FILTER (
    WHERE handoff_at IS NOT NULL
      AND activation_started_at >= handoff_at
  ) AS handoff_sessions_reaching_activation,
  count(*) FILTER (
    WHERE handoff_at IS NOT NULL
      AND handoff_at <= now()-interval '24 hours'
  ) AS mature_handoff_sessions,
  count(*) FILTER (
    WHERE handoff_at IS NOT NULL
      AND handoff_at <= now()-interval '24 hours'
      AND activated_at >= handoff_at
  ) AS authoritatively_activated_handoff_sessions,
  round(
    count(*) FILTER (
      WHERE handoff_at IS NOT NULL
        AND handoff_at <= now()-interval '24 hours'
        AND activated_at >= handoff_at
    )::numeric
    / nullif(count(*) FILTER (
      WHERE handoff_at IS NOT NULL
        AND handoff_at <= now()-interval '24 hours'
    ),0),
    3
  ) AS handoff_to_authoritative_activation_rate,
  count(*) FILTER (WHERE activation_started_at IS NOT NULL) AS activation_sessions,
  count(*) FILTER (
    WHERE activation_started_at IS NOT NULL
      AND oauth_started_at >= activation_started_at
  ) AS activation_sessions_reaching_oauth,
  count(*) FILTER (
    WHERE activation_started_at IS NOT NULL
      AND browser_success_at >= activation_started_at
  ) AS browser_success_sessions,
  count(*) FILTER (
    WHERE activation_started_at IS NOT NULL
      AND activation_started_at <= now()-interval '24 hours'
  ) AS mature_activation_sessions,
  count(*) FILTER (
    WHERE activation_started_at IS NOT NULL
      AND activation_started_at <= now()-interval '24 hours'
      AND activated_at >= activation_started_at
  ) AS authoritatively_activated_sessions,
  count(*) FILTER (
    WHERE activation_started_at IS NOT NULL
      AND activation_started_at <= now()-interval '24 hours'
      AND activated_at IS NULL
  ) AS abandoned_activation_sessions,
  count(*) FILTER (
    WHERE activation_started_at IS NOT NULL
      AND browser_success_at >= activation_started_at
      AND activated_at IS NULL
  ) AS browser_success_without_authoritative_activation,
  round(
    count(*) FILTER (
      WHERE activation_started_at IS NOT NULL
        AND activation_started_at <= now()-interval '24 hours'
        AND activated_at >= activation_started_at
    )::numeric
    / nullif(count(*) FILTER (
      WHERE activation_started_at IS NOT NULL
        AND activation_started_at <= now()-interval '24 hours'
    ),0),
    3
  ) AS activation_success_rate
FROM journey;
