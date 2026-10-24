// Read-only, bounded admin reporting. These routes are mounted only *after*
// account-session authentication and pack1_admins authorization in handleAdmin.
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {SERVING_POLICY_VERSION} from '../serving-quality.mjs';
import {gameDateKey} from '../game-date.mjs';

const PACIFIC="America/Los_Angeles";
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const validDate=value=>datePattern.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const rows=value=>value?.rows||[];
const num=value=>Number(value)||0;
function dateRange(url,{days=30,maxDays=90}={}) {
  const today=gameDateKey(),fallback=new Date(today+'T12:00:00Z');
  fallback.setUTCDate(fallback.getUTCDate()-(days-1));
  const from=url.searchParams.get('from')||fallback.toISOString().slice(0,10),to=url.searchParams.get('to')||today;
  if(!validDate(from)||!validDate(to)||to<from||(Date.parse(to)-Date.parse(from))/86400000>=maxDays)
    throw Object.assign(Error('Choose a valid date range of up to '+maxDays+' days.'),{status:400});
  return {from,to};
}
async function timed(query,label,sql,params) {
  const start=Date.now();
  try {return await query(sql,params);}
  finally {console.info(JSON.stringify({event:'admin_query_timing',report:'dashboard',label,elapsed_ms:Date.now()-start}));}
}

// Daily observations and completed sessions are evaluated once over fourteen
// Pacific days. Weekly distinct players are DISTINCT over the whole week, not
// a sum of the daily counts (which double-counts returning people).
export const ADMIN_TRENDS_SQL=`WITH
days AS (
  SELECT generate_series($1::date-13,$1::date,interval '1 day')::date day
), dimensions AS (
  SELECT 'day'::text kind,day::text label FROM days
  UNION ALL SELECT 'week','previous'
  UNION ALL SELECT 'week','current'
), observations AS MATERIALIZED (
  SELECT (o.first_seen_at AT TIME ZONE 'America/Los_Angeles')::date day,
    s.player_id,o.outcome,o.trophy_match
  FROM draft_run_decision_observations o
  JOIN draft_run_sessions s ON s.id=o.session_id
  JOIN players p ON p.id=s.player_id
  WHERE o.first_seen_at>= (($1::date-13)::timestamp AT TIME ZONE 'America/Los_Angeles')
    AND o.first_seen_at< (($1::date+1)::timestamp AT TIME ZONE 'America/Los_Angeles')
    AND o.observed AND s.corpus_version=$2
    AND NOT s.measurement_qa
    AND NOT coalesce(p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)',false)
), observation_metrics AS (
  SELECT d.kind,d.label,count(DISTINCT o.player_id)::int observed_players,
    count(*) FILTER(WHERE outcome='pick')::int answers,
    count(*) FILTER(WHERE outcome='pick' AND trophy_match)::int trophy_matches
  FROM observations o CROSS JOIN LATERAL (VALUES
    ('day',o.day::text),
    ('week',CASE WHEN o.day>$1::date-7 THEN 'current' ELSE 'previous' END)
  ) d(kind,label)
  GROUP BY d.kind,d.label
), sessions AS MATERIALIZED (
  SELECT coalesce(s.day,(s.created_at AT TIME ZONE 'America/Los_Angeles')::date) day,
    s.player_id,(s.day IS NOT NULL) daily,
    (jsonb_array_length(s.answers)=jsonb_array_length(s.puzzle_ids)) complete
  FROM draft_run_sessions s JOIN players p ON p.id=s.player_id
  WHERE s.corpus_version=$2
    AND s.created_at>= (($1::date-15)::timestamp AT TIME ZONE 'America/Los_Angeles')
    AND s.created_at< (($1::date+1)::timestamp AT TIME ZONE 'America/Los_Angeles')
    AND NOT s.measurement_qa
    AND NOT coalesce(p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)',false)
), session_metrics AS (
  SELECT d.kind,d.label,
    count(*) FILTER(WHERE s.complete)::int completed_runs,
    count(DISTINCT s.player_id) FILTER(WHERE s.complete AND s.daily)::int daily_players,
    count(*) FILTER(WHERE s.complete AND s.daily)::int daily_completions
  FROM sessions s CROSS JOIN LATERAL (VALUES
    ('day',s.day::text),
    ('week',CASE WHEN s.day>$1::date-7 THEN 'current' ELSE 'previous' END)
  ) d(kind,label)
  WHERE s.day BETWEEN $1::date-13 AND $1::date
  GROUP BY d.kind,d.label
), accounts AS MATERIALIZED (
  SELECT ("createdAt" AT TIME ZONE 'America/Los_Angeles')::date day
  FROM neon_auth."user"
  WHERE "createdAt">= (($1::date-13)::timestamp AT TIME ZONE 'America/Los_Angeles')
    AND "createdAt"< (($1::date+1)::timestamp AT TIME ZONE 'America/Los_Angeles')
), account_metrics AS (
  SELECT d.kind,d.label,count(*)::int new_accounts
  FROM accounts a CROSS JOIN LATERAL (VALUES
    ('day',a.day::text),
    ('week',CASE WHEN a.day>$1::date-7 THEN 'current' ELSE 'previous' END)
  ) d(kind,label)
  GROUP BY d.kind,d.label
)
SELECT d.kind,d.label,coalesce(o.observed_players,0) observed_players,
  coalesce(o.answers,0) answers,coalesce(o.trophy_matches,0) trophy_matches,
  coalesce(s.completed_runs,0) completed_runs,
  coalesce(s.daily_players,0) daily_players,coalesce(s.daily_completions,0) daily_completions,
  coalesce(a.new_accounts,0) new_accounts
FROM dimensions d LEFT JOIN observation_metrics o USING(kind,label)
  LEFT JOIN session_metrics s USING(kind,label)
  LEFT JOIN account_metrics a USING(kind,label)
ORDER BY d.kind,d.label`;

export const ADMIN_HEALTH_DAILIES_SQL=`SELECT expected.environment,
  (s.day IS NOT NULL AND jsonb_array_length(s.puzzle_ids)=8) scheduled,
  CASE WHEN s.day IS NOT NULL THEN jsonb_array_length(s.puzzle_ids) ELSE 0 END picks,
  s.selection_version
FROM (VALUES('mixed'),('powered-cube'),('latest')) expected(environment)
LEFT JOIN draft_run_schedules s ON s.day=$1::date AND s.environment=expected.environment
 AND s.corpus_version=$2
ORDER BY CASE expected.environment WHEN 'mixed' THEN 1 WHEN 'powered-cube' THEN 2 ELSE 3 END`;

export const ADMIN_HEALTH_SERVING_SQL=`SELECT rv.revision::text revision,
  snapshot.id IS NOT NULL cache_current,snapshot.id::text snapshot_id,
  (SELECT max(h.checked_at) FROM corpus_health_checks h
    WHERE h.corpus_version=$1 AND h.ready AND h.checked_at>now()-interval '7 days') recent_quality_check
FROM draft_run_serving_revision rv
LEFT JOIN LATERAL (
  SELECT id FROM draft_run_serving_snapshots s
  WHERE s.corpus_version=$1 AND s.difficulty_version='support-ratio-v1'
    AND s.serving_policy_version=$2 AND s.cache_schema='serving-cache-v1'
    AND s.revision=rv.revision
  ORDER BY id DESC LIMIT 1
) snapshot ON true WHERE rv.singleton`;

export const ADMIN_HEALTH_ATTENTION_SQL=`SELECT
  (SELECT count(*)::int FROM creator_challenges WHERE status='failed'
    OR (status='retired' AND coalesce((publication_detail->>'live_verified')::boolean,false)=false)) failed_publications,
  (SELECT count(*)::int FROM draft_run_decision_reports WHERE review_status='open' AND reason='broken') urgent_reports`;

// A bounded, *advisory* watchlist. Each player/puzzle is represented once in
// the observation window; this is not the scoring model or serving policy.
export const ADMIN_QUALITY_SQL=`WITH candidate_views AS MATERIALIZED (
  SELECT o.puzzle_id,o.session_id,s.player_id,o.first_seen_at,o.revision,
    o.outcome,o.trophy_match,s.updated_at,s.answers,s.puzzle_ids,
    v.set_id,v.pick_number,r.target_support_ratio,
    row_number() OVER(PARTITION BY s.player_id,o.puzzle_id
      ORDER BY o.first_seen_at,o.session_id,o.revision) encounter
  FROM draft_run_decision_observations o
  JOIN draft_run_sessions s ON s.id=o.session_id
  JOIN players p ON p.id=s.player_id
  JOIN draft_run_verified_puzzles v ON v.puzzle_id=o.puzzle_id
  LEFT JOIN draft_run_puzzle_ratings r ON r.puzzle_id=o.puzzle_id
    AND r.difficulty_version='support-ratio-v1'
  WHERE o.first_seen_at>=now()-interval '30 days'
    AND s.corpus_version=$1 AND o.observed AND NOT s.measurement_qa
    AND NOT coalesce(p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)',false)
), decision_metrics AS (
  SELECT puzzle_id,max(set_id) set_id,max(pick_number) pick_number,
    max(round(95*target_support_ratio)::int) implied_points,
    count(*)::int views,
    count(*) FILTER(WHERE outcome='pick')::int answers,
    count(*) FILTER(WHERE outcome='pick' AND trophy_match)::int matches,
    count(*) FILTER(WHERE first_seen_at<now()-interval '24 hours')::int mature_views,
    count(*) FILTER(WHERE outcome IS NULL
      AND jsonb_array_length(answers)<jsonb_array_length(puzzle_ids)
      AND greatest(updated_at,first_seen_at)<now()-interval '24 hours')::int likely_left
  FROM candidate_views
  WHERE encounter=1
  GROUP BY puzzle_id
), reports AS (
  SELECT puzzle_id,count(DISTINCT player_id)::int reporters,
    count(*) FILTER(WHERE reason='broken')::int broken_reports
  FROM draft_run_decision_reports
  WHERE review_status='open' AND corpus_version=$1
  GROUP BY puzzle_id
), ranked AS (
  SELECT m.*,coalesce(r.reporters,0) reporters,coalesce(r.broken_reports,0) broken_reports,
    round(100.0*m.matches/nullif(m.answers,0),1) trophy_match_pct,
    round(100.0*m.likely_left/nullif(m.mature_views,0),1) likely_left_pct,
    (m.answers>=12 AND m.implied_points>=80 AND m.matches*100.0/nullif(m.answers,0)<35) unexpected_choices,
    (m.mature_views>=12 AND m.likely_left>=4 AND m.likely_left*100.0/nullif(m.mature_views,0)>=25) high_abandonment,
    (coalesce(r.reporters,0)>=2 OR coalesce(r.broken_reports,0)>=2) repeated_reports
  FROM decision_metrics m LEFT JOIN reports r USING(puzzle_id)
)
SELECT puzzle_id,set_id,pick_number,implied_points,views,answers,matches,mature_views,
  likely_left,reporters,broken_reports,trophy_match_pct,likely_left_pct,
  unexpected_choices,high_abandonment,repeated_reports
FROM ranked
WHERE unexpected_choices OR high_abandonment OR repeated_reports
ORDER BY repeated_reports DESC,broken_reports DESC,unexpected_choices DESC,
  high_abandonment DESC,answers DESC,puzzle_id
LIMIT 20`;

// Acquisition touches are client-observed arrivals (not total clicks). Daily
// starts/completions are authoritative run rows with earliest observed source
// present *before* the run. First-touch player counts are not signups.
export const ADMIN_CAMPAIGN_SQL=`WITH first_touch AS MATERIALIZED (
  SELECT DISTINCT ON (e.player_id) e.player_id,e.created_at,
    coalesce(nullif(e.event_props->>'source',''),'direct') source,
    coalesce(nullif(e.event_props->>'campaign',''),'(none)') campaign
  FROM analytics_events e
  WHERE e.event_name='acquisition_touch' AND e.player_id IS NOT NULL
  ORDER BY e.player_id,e.created_at,e.id
), arrivals AS (
  SELECT coalesce(nullif(event_props->>'source',''),'direct') source,
    coalesce(nullif(event_props->>'campaign',''),'(none)') campaign,
    count(*)::int tracked_arrivals,count(DISTINCT player_id)::int arriving_players
  FROM analytics_events
  WHERE event_name='acquisition_touch'
    AND created_at>=($1::date::timestamp AT TIME ZONE 'America/Los_Angeles')
    AND created_at<(($2::date+1)::timestamp AT TIME ZONE 'America/Los_Angeles')
  GROUP BY 1,2
), daily_runs AS (
  SELECT coalesce(t.source,'direct') source,coalesce(t.campaign,'(none)') campaign,
    count(*)::int daily_starts,
    count(*) FILTER(WHERE jsonb_array_length(s.answers)=jsonb_array_length(s.puzzle_ids))::int daily_completions
  FROM draft_run_sessions s
  JOIN players p ON p.id=s.player_id
  LEFT JOIN first_touch t ON t.player_id=s.player_id AND t.created_at<=s.created_at
  WHERE s.corpus_version=$3 AND s.day BETWEEN $1::date AND $2::date
    AND NOT s.measurement_qa
    AND NOT coalesce(p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)',false)
    AND NOT EXISTS(SELECT 1 FROM account_links l JOIN pack1_admins a ON a.auth_user_id=l.auth_user_id WHERE l.player_id=s.player_id)
  GROUP BY 1,2
), first_players AS (
  SELECT t.source,t.campaign,count(*)::int new_tracked_players
  FROM first_touch t
  WHERE t.created_at>=($1::date::timestamp AT TIME ZONE 'America/Los_Angeles')
    AND t.created_at<(($2::date+1)::timestamp AT TIME ZONE 'America/Los_Angeles')
    AND NOT EXISTS(SELECT 1 FROM draft_run_sessions old WHERE old.player_id=t.player_id AND old.created_at<t.created_at)
    AND NOT EXISTS(SELECT 1 FROM game_results old WHERE old.player_id=t.player_id AND old.played_at<t.created_at)
  GROUP BY 1,2
), keys AS (
  SELECT source,campaign FROM arrivals UNION SELECT source,campaign FROM daily_runs
  UNION SELECT source,campaign FROM first_players
)
SELECT k.source,k.campaign,coalesce(a.tracked_arrivals,0) tracked_arrivals,
  coalesce(a.arriving_players,0) arriving_players,
  coalesce(d.daily_starts,0) daily_starts,coalesce(d.daily_completions,0) daily_completions,
  coalesce(n.new_tracked_players,0) new_tracked_players
FROM keys k LEFT JOIN arrivals a USING(source,campaign)
LEFT JOIN daily_runs d USING(source,campaign)
LEFT JOIN first_players n USING(source,campaign)
ORDER BY daily_completions DESC,daily_starts DESC,tracked_arrivals DESC,k.source,k.campaign
LIMIT 80`;

export async function handleDashboardAdmin(request,query) {
  const url=new URL(request.url),path=url.pathname;
  if(request.method!=='GET')throw Object.assign(Error('Method not allowed.'),{status:405});
  if(path==='/v1/admin/overview/trends') {
    const day=gameDateKey(),data=await timed(query,'trends',ADMIN_TRENDS_SQL,[day,DRAFT_RUN_CORPUS_VERSION]);
    const found=rows(data);
    return {generated_at:new Date().toISOString(),day,corpus_version:DRAFT_RUN_CORPUS_VERSION,
      daily:found.filter(x=>x.kind==='day'),weekly:found.filter(x=>x.kind==='week')};
  }
  if(path==='/v1/admin/overview/health') {
    const day=gameDateKey();
    const [dailies,serving,attention]=await Promise.all([
      timed(query,'health_dailies',ADMIN_HEALTH_DAILIES_SQL,[day,DRAFT_RUN_CORPUS_VERSION]),
      timed(query,'health_serving',ADMIN_HEALTH_SERVING_SQL,[DRAFT_RUN_CORPUS_VERSION,SERVING_POLICY_VERSION]),
      timed(query,'health_attention',ADMIN_HEALTH_ATTENTION_SQL,[]),
    ]);
    return {generated_at:new Date().toISOString(),day,corpus_version:DRAFT_RUN_CORPUS_VERSION,
      dailies:rows(dailies),serving:rows(serving)[0]||{cache_current:false},attention:rows(attention)[0]||{}};
  }
  if(path==='/v1/admin/insights/quality-watch') {
    const data=await timed(query,'quality_watch',ADMIN_QUALITY_SQL,[DRAFT_RUN_CORPUS_VERSION]);
    return {generated_at:new Date().toISOString(),corpus_version:DRAFT_RUN_CORPUS_VERSION,
      window_days:30,min_answers:12,min_mature_views:12,rows:rows(data)};
  }
  if(path==='/v1/admin/campaign-performance') {
    const {from,to}=dateRange(url,{days:30,maxDays:90});
    const data=await timed(query,'campaign_performance',ADMIN_CAMPAIGN_SQL,[from,to,DRAFT_RUN_CORPUS_VERSION]);
    return {generated_at:new Date().toISOString(),from,to,corpus_version:DRAFT_RUN_CORPUS_VERSION,rows:rows(data)};
  }
  throw Object.assign(Error('Not found.'),{status:404});
}
