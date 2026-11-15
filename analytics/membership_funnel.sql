-- Read-only, aggregate-only membership measurement. Do not publish production output.
-- UX markers are not purchases. 'checkout_started' means provider handoff/request,
-- and 'verification_succeeded' can also be a restore. Keep them separate.
-- Legacy elite_upgrade_handoff only means an internal /patreon/ navigation.
-- Exclude staff and any player known to have run QA, across the full history.
WITH excluded AS (
  SELECT player_id FROM draft_run_sessions WHERE measurement_qa
  UNION SELECT l.player_id FROM account_links l JOIN pack1_admins a USING(auth_user_id)
), stages AS (
  SELECT event_name, coalesce(event_props->>'context','unknown') AS platform,
    coalesce(event_props->>'source','unknown') AS source,
    coalesce(event_props->>'type','unspecified') AS tier,
    count(*) AS events,
    count(DISTINCT event_props->>'session_id') AS visits,
    count(DISTINCT player_id) AS players
  FROM analytics_events
  WHERE created_at >= now()-interval '30 days'
    AND event_name IN ('membership_offer_viewed','membership_purchase_clicked',
      'membership_checkout_started','membership_connection_started',
      'membership_connection_succeeded','membership_restore_started',
      'membership_verification_succeeded','membership_purchase_cancelled','membership_purchase_failed')
    AND NOT EXISTS(SELECT 1 FROM excluded x WHERE x.player_id=analytics_events.player_id)
  GROUP BY 1,2,3,4
)
SELECT * FROM stages ORDER BY platform,source,tier,event_name;

-- Server-authoritative activations, independently of browser/native success copy.
-- Patreon records grant transitions (including reactivation), not payment receipts.
-- Apple created_at is first server observation of a subscription chain, which may
-- arrive through restoration; never label it a new purchase. Sandbox is separate.
-- Only mature 24-hour cohorts; usage is the first premium practice within 24 hours
-- after that activation/observation, excluding Dailies and shared challenges.
WITH excluded AS (
  SELECT player_id FROM draft_run_sessions WHERE measurement_qa
  UNION SELECT l.player_id FROM account_links l JOIN pack1_admins a USING(auth_user_id)
), verified AS (
  SELECT player_id,created_at,'patreon' AS source,'Production' AS environment
  FROM analytics_events WHERE event_name='elite_activated'
  UNION ALL
  SELECT l.player_id,a.created_at,'apple',a.environment
  FROM apple_subscription_entitlements a JOIN account_links l USING(auth_user_id)
), cohort AS (
  SELECT v.*, EXISTS (
    SELECT 1 FROM draft_run_sessions s WHERE s.player_id=v.player_id
      AND s.created_at>=v.created_at AND s.created_at<v.created_at+interval '24 hours'
      AND s.day IS NULL AND s.challenge_id IS NULL AND NOT s.measurement_qa
      AND (s.environment='powered-cube' OR jsonb_array_length(s.custom_set_ids)>0)
  ) AS used_premium
  FROM verified v WHERE v.created_at>=now()-interval '30 days'
    AND v.created_at<=now()-interval '24 hours'
    AND NOT EXISTS(SELECT 1 FROM excluded x WHERE x.player_id=v.player_id)
)
SELECT source,environment,count(*) AS mature_verified_observations,
  count(*) FILTER(WHERE used_premium) AS used_premium_within_24h
FROM cohort GROUP BY source,environment ORDER BY source,environment;
