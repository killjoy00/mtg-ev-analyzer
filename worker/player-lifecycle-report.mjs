// Owner/admin-only aggregate, read-only. Never returns account or player IDs.
// Uses the same completed Daily and identity rules as the existing Habits report.
// An account linked after guest play inherits that guest's earlier Daily days.
export const PLAYER_LIFECYCLE_SQL=`WITH eligible_daily_sessions AS MATERIALIZED (
  SELECT coalesce(a.auth_user_id::text,'guest:'||s.player_id::text) person_id,s.day
  FROM draft_run_sessions s
  JOIN players p ON p.id=s.player_id
  LEFT JOIN account_links a ON a.player_id=s.player_id
  WHERE s.day IS NOT NULL
    AND NOT s.measurement_qa
    AND jsonb_array_length(s.answers)=jsonb_array_length(s.puzzle_ids)
    AND NOT coalesce(p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)',false)
    AND NOT EXISTS (
      SELECT 1 FROM account_links admin_link
      JOIN pack1_admins admin ON admin.auth_user_id=admin_link.auth_user_id
      WHERE admin_link.player_id=s.player_id
    )
), completed_days AS MATERIALIZED (
  SELECT person_id,day FROM eligible_daily_sessions GROUP BY person_id,day
), first_daily AS MATERIALIZED (
  SELECT person_id,min(day) first_day,count(*)::int lifetime_play_days
  FROM completed_days GROUP BY person_id
), daily_flags AS MATERIALIZED (
  SELECT f.person_id,f.first_day,f.lifetime_play_days,
    bool_or(d.day BETWEEN f.first_day+1 AND f.first_day+7) returned_in_7,
    bool_or(d.day BETWEEN f.first_day+1 AND f.first_day+30) returned_in_30
  FROM first_daily f JOIN completed_days d USING(person_id)
  GROUP BY f.person_id,f.first_day,f.lifetime_play_days
), registered AS MATERIALIZED (
  SELECT u.id FROM neon_auth."user" u
  WHERE NOT EXISTS(SELECT 1 FROM pack1_admins admin WHERE admin.auth_user_id=u.id)
    AND NOT EXISTS(SELECT 1 FROM account_deletion_operations deletion WHERE deletion.auth_user_id=u.id)
    AND NOT EXISTS (
      SELECT 1 FROM account_links link JOIN players p ON p.id=link.player_id
      WHERE link.auth_user_id=u.id
        AND coalesce(p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)',false)
    )
), today AS (
  SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date current_day
), all_time AS (
  SELECT
    (SELECT count(*)::int FROM registered) registered_accounts,
    (SELECT count(*)::int FROM registered r WHERE NOT EXISTS
      (SELECT 1 FROM first_daily f WHERE f.person_id=r.id::text)) registered_without_daily,
    (SELECT count(*)::int FROM daily_flags) daily_people,
    (SELECT count(*)::int FROM daily_flags WHERE lifetime_play_days=1) one_play_day,
    (SELECT count(*)::int FROM daily_flags WHERE lifetime_play_days>1) returned_later
), cohort AS (
  SELECT count(*)::int first_daily_people,
    count(*) FILTER(WHERE f.first_day+7<today.current_day)::int seven_day_eligible,
    count(*) FILTER(WHERE f.first_day+7<today.current_day AND NOT f.returned_in_7)::int seven_day_one_day_only,
    count(*) FILTER(WHERE f.first_day+7<today.current_day AND f.returned_in_7)::int seven_day_returned,
    count(*) FILTER(WHERE f.first_day+30<today.current_day)::int thirty_day_eligible,
    count(*) FILTER(WHERE f.first_day+30<today.current_day AND NOT f.returned_in_30)::int thirty_day_one_day_only,
    count(*) FILTER(WHERE f.first_day+30<today.current_day AND f.returned_in_30)::int thirty_day_returned
  FROM daily_flags f CROSS JOIN today
  WHERE f.first_day BETWEEN $1::date AND $2::date
)
SELECT to_jsonb(a) all_time,to_jsonb(c) cohort,today.current_day::text pacific_day
FROM all_time a CROSS JOIN cohort c CROSS JOIN today`;

const date=/^\d{4}-\d{2}-\d{2}$/;
const fail=message=>{throw Object.assign(Error(message),{status:400})};
const numeric=row=>Object.fromEntries(Object.entries(row||{}).map(([k,v])=>[k,Number(v||0)]));

export async function playerLifecycleReport(query,from,to){
 if(!date.test(from||'')||!date.test(to||''))fail('Use valid YYYY-MM-DD dates.');
 const start=Date.parse(from+'T00:00:00Z'),end=Date.parse(to+'T00:00:00Z');
 if(!Number.isFinite(start)||!Number.isFinite(end)||new Date(start).toISOString().slice(0,10)!==from||
    new Date(end).toISOString().slice(0,10)!==to||start>end||end-start>30*86400000)
  fail('Choose a period of at most 31 days.');
 const row=(await query(PLAYER_LIFECYCLE_SQL,[from,to])).rows[0]||{};
 const parse=value=>typeof value==='string'?JSON.parse(value):value;
 const allTime=numeric(parse(row.all_time));
 const cohort=numeric(parse(row.cohort));
 return {generated_at:new Date().toISOString(),pacific_day:row.pacific_day||null,
  from,to,all_time:allTime,cohort,
  scope:'Completed Daily calendar days; linked accounts combine guest identities; test and admin play excluded'};
}
