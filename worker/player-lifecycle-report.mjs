// Read-only account report. Deliberately starts from registered accounts, not
// every guest Daily. Completed Daily dates and exclusions match Habits.
export const PLAYER_LIFECYCLE_SQL=`WITH registered AS MATERIALIZED (
 SELECT u.id,(u."createdAt" AT TIME ZONE 'America/Los_Angeles')::date signup_day
 FROM neon_auth."user" u
 WHERE NOT EXISTS (SELECT 1 FROM pack1_admins a WHERE a.auth_user_id=u.id)
   AND NOT EXISTS (SELECT 1 FROM account_deletion_operations d WHERE d.auth_user_id=u.id)
   AND NOT EXISTS (
     SELECT 1 FROM account_links a JOIN players p ON p.id=a.player_id
     WHERE a.auth_user_id=u.id
       AND coalesce(p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)',false)
   )
), completed_days AS MATERIALIZED (
 SELECT a.auth_user_id,s.day FROM registered r
 JOIN account_links a ON a.auth_user_id=r.id
 JOIN draft_run_sessions s ON s.player_id=a.player_id
 JOIN players p ON p.id=s.player_id
 WHERE s.day IS NOT NULL AND NOT s.measurement_qa
   AND jsonb_array_length(s.answers)=jsonb_array_length(s.puzzle_ids)
   AND NOT coalesce(p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)',false)
 GROUP BY a.auth_user_id,s.day
), people AS (
 SELECT r.id,r.signup_day,min(d.day) first_day,count(d.day)::int play_days,
   bool_or(d.day>r.signup_day) played_after_signup,
   bool_or(d.day>r.signup_day AND d.day<=r.signup_day+7) returned_7,
   bool_or(d.day>r.signup_day AND d.day<=r.signup_day+14) returned_14,
   bool_or(d.day>r.signup_day AND d.day<=r.signup_day+30) returned_30
 FROM registered r LEFT JOIN completed_days d ON d.auth_user_id=r.id
 GROUP BY r.id,r.signup_day
), today AS (
 SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date current_day
)
SELECT count(*)::int registered_accounts,
 count(*) FILTER (WHERE first_day IS NULL)::int never_daily,
 count(*) FILTER (WHERE play_days=1)::int one_play_day,
 count(*) FILTER (WHERE play_days>1)::int returned_another_day,
 count(*) FILTER (WHERE first_day<=signup_day)::int signed_up_after_play,
 count(*) FILTER (WHERE first_day<=signup_day AND NOT coalesce(played_after_signup,false))::int never_after_signup,
 count(*) FILTER (WHERE first_day<=signup_day AND signup_day+7<today.current_day)::int eligible_7,
 count(*) FILTER (WHERE first_day<=signup_day AND signup_day+7<today.current_day
   AND NOT coalesce(returned_7,false))::int no_return_7,
 count(*) FILTER (WHERE first_day<=signup_day AND signup_day+7<today.current_day
   AND coalesce(returned_7,false))::int returned_7,
 count(*) FILTER (WHERE first_day<=signup_day AND signup_day+14<today.current_day)::int eligible_14,
 count(*) FILTER (WHERE first_day<=signup_day AND signup_day+14<today.current_day
   AND NOT coalesce(returned_14,false))::int no_return_14,
 count(*) FILTER (WHERE first_day<=signup_day AND signup_day+14<today.current_day
   AND coalesce(returned_14,false))::int returned_14,
 count(*) FILTER (WHERE first_day<=signup_day AND signup_day+30<today.current_day)::int eligible_30,
 count(*) FILTER (WHERE first_day<=signup_day AND signup_day+30<today.current_day
   AND NOT coalesce(returned_30,false))::int no_return_30,
 count(*) FILTER (WHERE first_day<=signup_day AND signup_day+30<today.current_day
   AND coalesce(returned_30,false))::int returned_30
FROM people CROSS JOIN today`;

export async function playerLifecycleReport(query){
 const row=(await query(PLAYER_LIFECYCLE_SQL)).rows[0]||{};
 const counts=Object.fromEntries(Object.entries(row).map(([key,value])=>[key,Number(value)]));
 if(Object.values(counts).some(value=>!Number.isFinite(value)))
  throw Error('Account report could not be completed.');
 return {generated_at:new Date().toISOString(),counts,
  definition:'Registered non-admin accounts; completed Pacific Daily dates; merged guest play included; deleted and QA accounts excluded'};
}
