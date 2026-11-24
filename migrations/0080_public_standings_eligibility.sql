-- Public leaderboard republication does not require each older account to view the notice.
-- Preserve the original global fourteen-day cutoff in pack1_results_record_publication,
-- explicit publication exclusions, hidden identity, username ownership and deletion checks.
-- Existing notice presentation and all email consent functions are intentionally unchanged.
CREATE OR REPLACE FUNCTION pack1_results_publishable_name(p_auth uuid)
RETURNS text LANGUAGE sql STABLE AS $body$
 SELECT coalesce((SELECT p.display_name FROM neon_auth."user" u
  JOIN account_links a ON a.auth_user_id=u.id JOIN players p ON p.id=a.player_id
  CROSS JOIN results_launch launch LEFT JOIN results_preferences pref ON pref.auth_user_id=u.id
  WHERE u.id=p_auth AND launch.singleton AND launch.launch_at<=now()
   AND p.username_owned=true AND p.public_identity_hidden_at IS NULL
   AND NOT coalesce(pref.exclude_publications,false)
   AND NOT EXISTS(SELECT 1 FROM account_deletion_operations WHERE auth_user_id=u.id)
  LIMIT 1),'Anonymous player')
$body$;
