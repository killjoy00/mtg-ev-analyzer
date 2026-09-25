import {accountSession} from './account-session.mjs';
import {createHash} from 'node:crypto';
import {handleCorpusAdmin} from './corpus-admin.mjs';
import {handleUserAdmin} from './user-admin.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function reportFilters(url,now=new Date()) {
  const end=url.searchParams.get('to')||now.toISOString().slice(0,10);
  const start=url.searchParams.get('from')||new Date(now.getTime()-29*86400000).toISOString().slice(0,10);
  const valid=x=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
  if(!valid(start)||!valid(end)||end<start||(Date.parse(end)-Date.parse(start))/86400000>365)fail('Choose a valid date range of at most one year.');
  const environment=url.searchParams.get('environment')||'all',type=url.searchParams.get('type')||'all',set=url.searchParams.get('set')||'all';
  const version=url.searchParams.get('version')||'all';
  const band=url.searchParams.get('difficulty')||'all',pick=url.searchParams.get('pick')||'all';
  if(!['all','mixed','powered-cube'].includes(environment)||!['all','daily','practice','challenge'].includes(type)||!/^([a-z0-9-]{2,40}|all)$/.test(set)||!/^([a-z0-9-]{1,60}|all)$/.test(version))fail('Invalid report filter.');
  if(!['all','easy','medium','hard'].includes(band)||!['all',...Array.from({length:12},(_,i)=>String(i+1))].includes(pick))fail('Invalid difficulty or pick filter.');
  return {start,end,environment,type,set,version,band,pick,params:[start,end,environment,type,set,version,band,pick]};
}
const SCOPE=`FROM draft_run_source_measurements WHERE first_seen_at >= $1::date AND first_seen_at < $2::date+interval '1 day'
  AND ($3='all' OR environment=$3) AND ($4='all' OR run_type=$4) AND ($5='all' OR set_id=$5)
  AND ($6='all' OR selection_version=$6) AND ($7='all' OR band=$7) AND ($8='all' OR pick_number::text=$8)`;
const METRICS=`count(*)::int exposures,count(DISTINCT player_id)::int players,
  count(*) FILTER(WHERE outcome='pick')::int answers,
  count(*) FILTER(WHERE trophy_match)::int trophy_matches,
  round(100.0*count(*) FILTER(WHERE trophy_match)/nullif(count(*) FILTER(WHERE outcome='pick'),0),1) trophy_match_pct,
  round(avg(score),1) average_score,round(avg(score) FILTER(WHERE NOT trophy_match),1) average_partial_credit,
  count(*) FILTER(WHERE outcome='pick' AND NOT trophy_match)::int alternatives,
  count(*) FILTER(WHERE score<25)::int partial_0_24,
  count(*) FILTER(WHERE score BETWEEN 25 AND 49)::int partial_25_49,
  count(*) FILTER(WHERE score BETWEEN 50 AND 74)::int partial_50_74,
  count(*) FILTER(WHERE score BETWEEN 75 AND 95)::int partial_75_95,
  count(*) FILTER(WHERE outcome IN ('set','pack'))::int rerolls,
  round(100.0*count(*) FILTER(WHERE outcome IN ('set','pack'))/nullif(count(*),0),1) reroll_pct,
  count(*) FILTER(WHERE likely_abandoned)::int likely_abandoned,
  count(*) FILTER(WHERE first_seen_at<now()-interval '24 hours')::int mature_exposures,
  count(*) FILTER(WHERE outcome IS NULL AND NOT likely_abandoned)::int pending,
  count(active_ms) FILTER(WHERE outcome='pick')::int timed_answers,
  round((percentile_cont(.5) WITHIN GROUP(ORDER BY active_ms) FILTER(WHERE outcome='pick'))::numeric/1000,1) median_seconds,
  round((percentile_cont(.9) WITHIN GROUP(ORDER BY active_ms) FILTER(WHERE outcome='pick'))::numeric/1000,1) p90_seconds`;
const HABIT_METRICS_SQL=`WITH eligible_daily_sessions AS (
  SELECT s.id,s.player_id,coalesce(a.auth_user_id::text,'guest:'||s.player_id::text) person_id,s.day,s.created_at
  FROM draft_run_sessions s
  JOIN players p ON p.id=s.player_id
  LEFT JOIN account_links a ON a.player_id=s.player_id
  WHERE s.day IS NOT NULL
    AND jsonb_array_length(s.answers)=jsonb_array_length(s.puzzle_ids)
    AND NOT s.measurement_qa
    AND NOT coalesce(p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)',false)
    AND NOT EXISTS (
      SELECT 1 FROM account_links admin_link JOIN pack1_admins admin ON admin.auth_user_id=admin_link.auth_user_id
      WHERE admin_link.player_id=s.player_id
    )
), completed_days AS (
  SELECT person_id,(min(player_id::text))::uuid player_id,day,min(created_at) completed_at
  FROM eligible_daily_sessions GROUP BY person_id,day
), first_daily AS (
  SELECT person_id,(min(player_id::text))::uuid player_id,min(day) first_day
  FROM completed_days GROUP BY person_id
), first_touch AS (
  SELECT DISTINCT ON (e.player_id) e.player_id,e.created_at,
    coalesce(nullif(e.event_props->>'source',''),'direct') source,
    nullif(e.event_props->>'campaign','') campaign
  FROM analytics_events e
  WHERE e.event_name='acquisition_touch' AND e.player_id IS NOT NULL
  ORDER BY e.player_id,e.created_at,e.id
), tracking_start AS (
  SELECT min(created_at) started_at FROM analytics_events WHERE event_name='acquisition_touch'
), first_activity AS (
  SELECT f.player_id,least(
    coalesce((SELECT min(s.created_at) FROM draft_run_sessions s WHERE s.player_id=f.player_id),'infinity'::timestamptz),
    coalesce((SELECT min(e.created_at) FROM analytics_events e WHERE e.player_id=f.player_id AND e.event_name<>'acquisition_touch'),'infinity'::timestamptz),
    coalesce((SELECT min(g.played_at) FROM game_results g WHERE g.player_id=f.player_id),'infinity'::timestamptz),
    coalesce((SELECT min(sc.created_at) FROM scores sc WHERE sc.player_id=f.player_id),'infinity'::timestamptz)
  ) first_activity
  FROM first_daily f
), attribution AS (
  SELECT f.person_id,f.player_id,
    CASE
      WHEN tracking.started_at IS NOT NULL AND activity.first_activity<tracking.started_at THEN 'pre_tracking'
      WHEN touch.player_id IS NOT NULL THEN touch.source
      ELSE 'direct'
    END source,
    CASE
      WHEN tracking.started_at IS NOT NULL AND activity.first_activity<tracking.started_at THEN '(none)'
      ELSE coalesce(touch.campaign,'(none)')
    END campaign
  FROM first_daily f
  LEFT JOIN first_touch touch ON touch.player_id=f.player_id
  LEFT JOIN first_activity activity ON activity.player_id=f.player_id
  CROSS JOIN tracking_start tracking
), ever_three_in_seven AS (
  SELECT DISTINCT person_id FROM (
    SELECT anchor.person_id,anchor.day
    FROM completed_days anchor
    JOIN completed_days recent ON recent.person_id=anchor.person_id AND recent.day BETWEEN anchor.day-6 AND anchor.day
    GROUP BY anchor.person_id,anchor.day HAVING count(*)>=3
  ) reached
), cohorts AS (
  SELECT f.person_id,f.first_day,a.source,a.campaign,
    EXISTS(SELECT 1 FROM completed_days d WHERE d.person_id=f.person_id AND d.day=f.first_day+1) next_day_return,
    EXISTS(SELECT 1 FROM completed_days d WHERE d.person_id=f.person_id AND d.day BETWEEN f.first_day+1 AND f.first_day+7) seven_day_return,
    (SELECT count(*) FROM completed_days d WHERE d.person_id=f.person_id AND d.day BETWEEN f.first_day AND f.first_day+6)>=3 three_in_seven,
    EXISTS(SELECT 1 FROM ever_three_in_seven e WHERE e.person_id=f.person_id) ever_three_in_seven
  FROM first_daily f JOIN attribution a USING(person_id)
  WHERE f.first_day BETWEEN $1::date AND $2::date
), today AS (
  SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date AS current_day
), cohort_summary AS (
  SELECT source,campaign,count(*)::int cohort_people,
    count(*) FILTER(WHERE first_day+1<today.current_day)::int next_day_mature,
    count(*) FILTER(WHERE first_day+1<today.current_day AND next_day_return)::int next_day_returned,
    count(*) FILTER(WHERE first_day+1>=today.current_day)::int next_day_immature,
    round(100.0*count(*) FILTER(WHERE first_day+1<today.current_day AND next_day_return)/nullif(count(*) FILTER(WHERE first_day+1<today.current_day),0),1) next_day_rate,
    count(*) FILTER(WHERE first_day+7<today.current_day)::int seven_day_mature,
    count(*) FILTER(WHERE first_day+7<today.current_day AND seven_day_return)::int seven_day_returned,
    count(*) FILTER(WHERE first_day+7>=today.current_day)::int seven_day_immature,
    round(100.0*count(*) FILTER(WHERE first_day+7<today.current_day AND seven_day_return)/nullif(count(*) FILTER(WHERE first_day+7<today.current_day),0),1) seven_day_rate,
    count(*) FILTER(WHERE first_day+6<today.current_day)::int three_in_seven_mature,
    count(*) FILTER(WHERE first_day+6<today.current_day AND three_in_seven)::int three_in_seven_reached,
    count(*) FILTER(WHERE first_day+6>=today.current_day)::int three_in_seven_immature,
    round(100.0*count(*) FILTER(WHERE first_day+6<today.current_day AND three_in_seven)/nullif(count(*) FILTER(WHERE first_day+6<today.current_day),0),1) three_in_seven_rate,
    count(*) FILTER(WHERE ever_three_in_seven)::int ever_three_in_seven_people,
    round(100.0*count(*) FILTER(WHERE ever_three_in_seven)/nullif(count(*),0),1) ever_three_in_seven_rate
  FROM cohorts CROSS JOIN today
  GROUP BY source,campaign ORDER BY source,campaign
), report_days AS (
  SELECT generate_series($1::date,$2::date,interval '1 day')::date AS date_key
), daily_health AS (
  SELECT report_days.date_key::text AS "day",
    count(health.person_id) FILTER(WHERE health.completed_days>=3)::int people
  FROM report_days
  LEFT JOIN LATERAL (
    SELECT d.person_id,count(*)::int completed_days
    FROM completed_days d
    WHERE d.day BETWEEN report_days.date_key-6 AND report_days.date_key
    GROUP BY d.person_id
  ) health ON true
  GROUP BY report_days.date_key ORDER BY report_days.date_key
)
SELECT
  coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.source,c.campaign) FROM cohort_summary c),'[]'::jsonb) cohorts,
  coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.day) FROM daily_health h),'[]'::jsonb) daily_health`;
async function account(request,query) {
  let auth;
  try {auth=await accountSession(request,query,{allowLegacy:true});}
  catch(error){fail(error.message,error.status||401);}
  return auth.user_id;
}
export async function handleAdmin(request,query,readJson) {
  const url=new URL(request.url),id=await account(request,query);
  if(url.pathname==='/v1/admin/claim'&&request.method==='POST') {
    const body=await readJson(request);
    if(!/^[a-f0-9]{64}$/.test(body.invite||''))fail('Invalid invitation.',403);
    const hash=createHash('sha256').update(body.invite).digest('hex');
    const {rows}=await query(`WITH identity_allowed AS MATERIALIZED (
      SELECT 1 WHERE pack1_identity_attachment_allowed($2::uuid)
    ), already AS (
        SELECT i.redeemed_by FROM pack1_admin_invites i JOIN pack1_admins a ON a.auth_user_id=i.redeemed_by
        WHERE i.token_hash=$1 AND i.redeemed_by=$2::uuid AND EXISTS(SELECT 1 FROM identity_allowed)
      ), claimed AS (
        UPDATE pack1_admin_invites SET redeemed_by=$2::uuid,redeemed_at=now()
        WHERE token_hash=$1 AND expires_at>now() AND redeemed_at IS NULL
          AND EXISTS(SELECT 1 FROM identity_allowed) RETURNING redeemed_by
      ), granted AS (
        INSERT INTO pack1_admins(auth_user_id) SELECT redeemed_by FROM claimed ON CONFLICT DO NOTHING
      )
      SELECT redeemed_by FROM claimed UNION SELECT redeemed_by FROM already`,[hash,id]);
    if(!rows.length)fail('This invitation expired or has already been used.',403);
    return {ok:true};
  }
  if(!(await query('SELECT 1 FROM pack1_admins WHERE auth_user_id=$1::uuid',[id])).rows.length)fail('This account does not have admin access. Use your private invitation to claim access.',403);
  if(url.pathname.startsWith('/v1/admin/users'))return handleUserAdmin(request,query,url);
  if(url.pathname.startsWith('/v1/admin/corpus'))return handleCorpusAdmin(request,query,readJson,id);
  if(request.method!=='GET')fail('Method not allowed.',405);
  const filters=reportFilters(url);
  if(url.pathname==='/v1/admin/measurements') {
    const scope=`WITH scoped AS (SELECT * ${SCOPE}), primary_data AS (SELECT * FROM scoped WHERE observed AND NOT is_qa AND first_encounter)`;
    const [coverage,summary,groups,reviews,options,shareFunnel,habitMetrics]=await Promise.all([
      query(`${scope} SELECT count(*)::int recorded,count(*) FILTER(WHERE is_qa)::int qa_excluded,
        count(*) FILTER(WHERE NOT observed AND NOT is_qa)::int unobserved_excluded,
        count(*) FILTER(WHERE observed AND NOT is_qa AND NOT first_encounter)::int repeats_excluded,
        min(first_seen_at) collection_started FROM scoped`,filters.params),
      query(`${scope} SELECT ${METRICS},count(DISTINCT session_id)::int runs,
        count(DISTINCT session_id) FILTER(WHERE run_complete)::int completed_runs FROM primary_data`,filters.params),
      query(`${scope} SELECT dimension,label,${METRICS} FROM primary_data
        CROSS JOIN LATERAL (VALUES ('difficulty',coalesce(band,'unrated')),('set',set_id),('pick',pick_number::text),
        ('round',round::text),('source_event',source_event_type),('model_disagreement',model_disagreement::text),('version',selection_version||' / '||scoring_version||' / '||difficulty_version)) dimensions(dimension,label)
        GROUP BY dimension,label ORDER BY dimension,label`,filters.params),
      query(`${scope}, chosen AS (SELECT puzzle_id,${METRICS},bool_or(model_disagreement) model_disagreement
        FROM primary_data GROUP BY puzzle_id HAVING count(*) FILTER(WHERE outcome='pick')>=5
        ORDER BY bool_or(model_disagreement) DESC,count(*) FILTER(WHERE outcome='pick') DESC LIMIT 30)
        SELECT c.*,p.set_id,p.pick_number,p.payload->>'historical_pick_id' trophy_id
        FROM chosen c JOIN draft_run_verified_puzzles p USING(puzzle_id)`,filters.params),
      query(`SELECT set_id FROM draft_run_verified_sets ORDER BY set_id`),
      query(`WITH arrivals AS (
          SELECT e.player_id,e.created_at
          FROM analytics_events e JOIN players p ON p.id=e.player_id
          WHERE e.event_name='daily_share_arrival'
            AND e.created_at >= $1::date AND e.created_at < $2::date+interval '1 day'
            AND ($3='all' OR coalesce(e.event_props->>'set','mixed')=$3)
            AND NOT coalesce(p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)',false)
        ), starts AS (
          SELECT DISTINCT e.event_props->>'run_id' run_id
          FROM analytics_events e
          JOIN draft_run_sessions s ON s.id::text=e.event_props->>'run_id'
          WHERE e.event_name='daily_started' AND e.event_props->>'source'='result_share'
            AND e.created_at >= $1::date AND e.created_at < $2::date+interval '1 day'
            AND ($3='all' OR e.event_props->>'set_id'=$3)
            AND NOT s.measurement_qa
        ), completed AS (
          SELECT DISTINCT event_props->>'run_id' run_id
          FROM analytics_events WHERE event_name='daily_completed'
        )
        SELECT (SELECT count(*) FROM arrivals)::int arrivals,
          (SELECT count(DISTINCT player_id) FROM arrivals)::int visitors,
          (SELECT count(*) FROM starts)::int starts,
          (SELECT count(*) FROM starts s WHERE EXISTS(SELECT 1 FROM completed c WHERE c.run_id=s.run_id))::int completions,
          round(100.0*(SELECT count(*) FROM starts)/nullif((SELECT count(*) FROM arrivals),0),1) start_pct,
          round(100.0*(SELECT count(*) FROM starts s WHERE EXISTS(SELECT 1 FROM completed c WHERE c.run_id=s.run_id))/nullif((SELECT count(*) FROM starts),0),1) completion_pct`,
        [filters.start,filters.end,filters.environment]),
      query(HABIT_METRICS_SQL,[filters.start,filters.end])
    ]);
    return {generated_at:new Date().toISOString(),filters:{...filters,params:undefined},coverage:coverage.rows[0],summary:summary.rows[0],share_funnel:shareFunnel.rows[0],habit_metrics:habitMetrics.rows[0]||{cohorts:[],daily_health:[]},groups:groups.rows,reviews:reviews.rows,sets:options.rows.map(r=>r.set_id),
      definitions:{primary:'First recorded encounter per player and puzzle; observed in the browser; QA excluded.',abandonment:'Unfinished run with an open viewed decision and no activity for 24 hours. A return removes this classification.',timing:'Client-reported foreground time; missing for reloads, multiple tabs, old clients, or invalid timing. This is not a trusted gameplay score.',sample:'Fewer than 30 answers is an early signal, not a calibrated difficulty estimate.',review:'Decisions with at least five first-encounter answers; model disagreement first, then sample size.',habit_person:'Habit metrics count linked accounts as one person after identity merges; guests remain one browser/player identity.',habit_completion:'A Daily day is one or more completed Mixed, Powered Cube, or Latest Set sessions on the stored Pacific Daily date. Multiple Dailies on one date count once.',habit_exclusions:'All habit metrics exclude measurement-QA sessions, QA-pattern display names, and players linked to Pack One admin accounts.',habit_maturity:'Next-day, 7-day, and 3-in-7 rates include only cohorts whose full measurement window has closed; immature cohort counts are shown separately.',habit_attribution:'First touch is the earliest acquisition event for the merged player. Earlier product activity is pre_tracking; missing post-launch attribution is direct. Campaign is (none) when absent.',habit_ever:'Ever 3-in-7 is a lifetime observed status as of report generation, not a fixed-horizon cohort rate. Daily health counts people with 3+ distinct Daily days in each trailing seven-day window.'}};
  }
  const match=url.pathname.match(/^\/v1\/admin\/decisions\/([a-f0-9]{32})$/);
  if(match) {
    const [p,choices]=await Promise.all([
      query('SELECT payload FROM draft_run_verified_puzzles WHERE puzzle_id=$1',[match[1]]),
      query(`SELECT selected_id,count(*)::int answers,round(avg(score),1) average_score ${SCOPE}
        AND observed AND NOT is_qa AND first_encounter AND outcome='pick' AND puzzle_id=$9 GROUP BY selected_id ORDER BY count(*) DESC`,[...filters.params,match[1]])
    ]);
    if(!p.rows[0])fail('Decision not found.',404);
    return {puzzle:typeof p.rows[0].payload==='string'?JSON.parse(p.rows[0].payload):p.rows[0].payload,choices:choices.rows};
  }
  fail('Not found.',404);
}
