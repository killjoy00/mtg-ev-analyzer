import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {gameDateKey} from '../game-date.mjs';

const UUID=/^[a-f0-9-]{36}$/i;
const fail=(message,status=400,code=null)=>{throw Object.assign(Error(message),{status,...(code?{code}:{})});};
const bool=value=>value===true||value==='t'||value==='true'||value===1||value==='1';
const num=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const parse=value=>{
  if(value==null)return value;
  if(typeof value==='object')return value;
  try{return JSON.parse(value);}catch{return value;}
};
const mostRecent=(...values)=>{
  const present=values.filter(Boolean);
  if(!present.length)return null;
  return present.sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
};

export function userAdminFilters(url) {
  const search=String(url.searchParams.get('search')||'').trim();
  const status=String(url.searchParams.get('status')||'all');
  if(search.length>100)fail('Search is too long.');
  if(!['all','paid','patreon','admin'].includes(status))fail('Invalid user filter.');
  return {search,status};
}

const USER_ADMIN_SORT_COLUMNS=Object.freeze({
  account:"lower(coalesce(nullif(u.name,''),'Unnamed account'))",
  username:'username_sort',
  created:'u."createdAt"',
  last_active:'last_active',
  runs:'rs.runs',
  average_score:'rs.average_score',
  access:'access_sort',
  connections:'patreon_connected',
  admin:'is_admin',
});
export function userAdminSort(url) {
  const column=url.searchParams.get('sort')||'last_active';
  const direction=url.searchParams.get('direction')||(['account','username','access'].includes(column)?'asc':'desc');
  if(!Object.hasOwn(USER_ADMIN_SORT_COLUMNS,column)||!['asc','desc'].includes(direction))
    fail('Choose a valid account sorting column and direction.');
  return {column,direction};
}

export function userAdminPage(url) {
  const raw=url.searchParams.get('page')||'1';
  if(!/^[1-9][0-9]{0,3}$/.test(raw))fail('Choose a valid account page.');
  return Number(raw);
}

const DATE_KEY=/^\d{4}-\d{2}-\d{2}$/;
const validDateKey=value=>DATE_KEY.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

export function playActivityWindow(url,now=new Date()) {
  const end=url.searchParams.get('activity_to')||gameDateKey(now);
  if(!validDateKey(end))fail('Choose a valid activity date range of at most one year.');
  const defaultStart=new Date(end+'T12:00:00Z');defaultStart.setUTCDate(defaultStart.getUTCDate()-13);
  const start=url.searchParams.get('activity_from')||defaultStart.toISOString().slice(0,10);
  if(!validDateKey(start)||end<start||(Date.parse(end)-Date.parse(start))/86400000>365)
    fail('Choose a valid activity date range of at most one year.');
  return {start,end};
}

// Same people, exclusions and next-day maturity as the Daily habit cohorts report, split by
// whether the player is linked to an account today. Guests count once per browser identity.
const PLAY_ACTIVITY_SQL=`WITH eligible AS (
  SELECT coalesce(a.auth_user_id::text,'guest:'||s.player_id::text) person_id,s.day,
    coalesce(s.day,(s.created_at AT TIME ZONE 'America/Los_Angeles')::date) play_day
  FROM draft_run_sessions s
  JOIN players p ON p.id=s.player_id
  LEFT JOIN account_links a ON a.player_id=s.player_id
  WHERE s.corpus_version=$3
    AND jsonb_array_length(s.answers)=jsonb_array_length(s.puzzle_ids)
    AND NOT s.measurement_qa
    AND NOT coalesce(p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)',false)
    AND NOT EXISTS (
      SELECT 1 FROM account_links admin_link JOIN pack1_admins admin ON admin.auth_user_id=admin_link.auth_user_id
      WHERE admin_link.player_id=s.player_id
    )
), grouped AS (
  SELECT CASE WHEN person_id LIKE 'guest:%' THEN 'signed_out' ELSE 'signed_in' END grp,* FROM eligible
), played AS (
  SELECT grp,count(DISTINCT person_id)::int players,count(*)::int completed_runs
  FROM grouped WHERE play_day BETWEEN $1::date AND $2::date GROUP BY grp
), daily_days AS (
  SELECT DISTINCT grp,person_id,day FROM grouped WHERE day IS NOT NULL
), cohort AS (
  SELECT f.grp,f.first_day,next_day.person_id IS NOT NULL returned
  FROM (SELECT grp,person_id,min(day) first_day FROM daily_days GROUP BY grp,person_id) f
  LEFT JOIN daily_days next_day ON next_day.person_id=f.person_id AND next_day.day=f.first_day+1
  WHERE f.first_day BETWEEN $1::date AND $2::date
), today AS (
  SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date AS current_day
), cohort_summary AS (
  SELECT grp,count(*)::int first_daily_people,
    count(*) FILTER(WHERE first_day+1<today.current_day)::int next_day_mature,
    count(*) FILTER(WHERE first_day+1<today.current_day AND returned)::int next_day_returned,
    count(*) FILTER(WHERE first_day+1>=today.current_day)::int next_day_immature,
    round(100.0*count(*) FILTER(WHERE first_day+1<today.current_day AND returned)/nullif(count(*) FILTER(WHERE first_day+1<today.current_day),0),1) next_day_rate
  FROM cohort CROSS JOIN today GROUP BY grp
)
SELECT g.grp "group",coalesce(pl.players,0) players,coalesce(pl.completed_runs,0) completed_runs,
  coalesce(c.first_daily_people,0) first_daily_people,coalesce(c.next_day_mature,0) next_day_mature,
  coalesce(c.next_day_returned,0) next_day_returned,coalesce(c.next_day_immature,0) next_day_immature,c.next_day_rate
FROM (VALUES ('signed_out',1),('signed_in',2)) g(grp,position)
LEFT JOIN played pl ON pl.grp=g.grp
LEFT JOIN cohort_summary c ON c.grp=g.grp
ORDER BY g.position`;

async function playActivity(query,window) {
  try {
    const result=await query(PLAY_ACTIVITY_SQL,[window.start,window.end,DRAFT_RUN_CORPUS_VERSION]);
    return {...window,corpus_version:DRAFT_RUN_CORPUS_VERSION,groups:result.rows.map(row=>({
      group:row.group,players:num(row.players),completed_runs:num(row.completed_runs),
      first_daily_people:num(row.first_daily_people),next_day_mature:num(row.next_day_mature),
      next_day_returned:num(row.next_day_returned),next_day_immature:num(row.next_day_immature),
      next_day_rate:row.next_day_rate==null?null:Number(row.next_day_rate),
    }))};
  } catch(error) {
    console.error(JSON.stringify({event:'admin_play_activity_failed',message:String(error?.message||error).slice(0,200)}));
    return {...window,unavailable:true};
  }
}

function normalizeUser(row) {
  return {
    ...row,
    email_verified:bool(row.email_verified),
    banned:bool(row.banned),
    linked:Boolean(row.claimed_at),
    username_owned:bool(row.username_owned),
    is_admin:bool(row.is_admin),
    patreon_connected:bool(row.patreon_connected),
    active_entitlements:num(row.active_entitlements),
    capabilities:parse(row.capabilities)||[],
    runs:num(row.runs),
    completed_runs:num(row.completed_runs),
    average_score:row.average_score==null?null:Number(row.average_score),
    best_score:row.best_score==null?null:Number(row.best_score),
  };
}

export async function handleUserAdmin(request,query,url=new URL(request.url),{readJson=null,adminAuthUserId=null}={}) {
  const moderation=url.pathname.match(/^\/v1\/admin\/users\/([a-f0-9-]+)\/public-identity$/i);
  if(moderation&&request.method==='POST') {
    if(!UUID.test(moderation[1])||!readJson||!adminAuthUserId)fail('Invalid moderation request.',400);
    const body=await readJson(request);
    const action=String(body.action||'').trim();
    const reason=String(body.reason||'').trim();
    if(!['hide','restore'].includes(action))fail('Choose hide or restore.',400);
    if(reason.length<1||reason.length>500)fail('Moderation reason must be 1-500 characters.',400);
    const target=await query('SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid LIMIT 1',[moderation[1]]);
    const playerId=target.rows[0]?.player_id;
    if(!playerId)fail('User has no linked public identity.',404);
    if(action==='hide') {
      await query(
        `WITH snapshot AS MATERIALIZED (
           SELECT id,username_owned,profile_public FROM players WHERE id=$1::uuid FOR UPDATE
         ), share_ids AS MATERIALIZED (
           SELECT sh.id FROM draft_run_shares sh JOIN draft_run_sessions s ON s.id=sh.session_id
           WHERE s.player_id=$1::uuid
         ), hidden AS (
           UPDATE players p SET username_owned=false,profile_public=false,public_identity_hidden_at=now(),
             public_identity_hidden_reason=$2,updated_at=now()
           FROM snapshot s WHERE p.id=s.id RETURNING p.id
         ), scrub_shares AS (
           UPDATE draft_run_shares SET display_name='A friend'
           WHERE id IN (SELECT id FROM share_ids) RETURNING id
         ), scrub_results AS (
           UPDATE game_results SET opponent_name='A friend'
           WHERE challenge_id IN (SELECT id FROM share_ids) RETURNING id
         ), creator_result_scrub AS (
           UPDATE game_results SET opponent_name='A creator'
           WHERE creator_challenge_id IN (
             SELECT id FROM creator_challenges WHERE source_owner_player_id=$1::uuid
           )
           RETURNING id
         ), retire_creator_challenges AS (
           UPDATE creator_challenges
           SET status='retired',creator_public_name='A creator',creator_handle=NULL,headline='Creator challenge unavailable',
             creator_post_run_note=NULL,source_owner_auth_user_id=NULL,
             privacy_removed_at=COALESCE(privacy_removed_at,now()),
             retired_at=COALESCE(retired_at,now()),updated_at=now(),publication_error=NULL,
             publication_operation_ref=NULL,
             publication_detail=CASE
               WHEN published_at IS NULL
                 AND status NOT IN ('published','publishing')
                 AND NOT (
                   publication_detail->>'action'='publish'
                   AND (
                     publication_detail ? 'workflow'
                     OR COALESCE(publication_detail#>>'{dispatch,state}','') IN ('accepted','ambiguous')
                   )
                 ) THEN
                 jsonb_build_object(
                   'action','retire','reason','public_identity_hidden',
                   'live_verified',true,'static_cleanup','not_required'
                 )
               ELSE
                 jsonb_build_object(
                   'action','retire','reason','public_identity_hidden',
                   'live_verified',false,'static_cleanup','required',
                   'dispatch',jsonb_build_object('state','pending','attempts',0)
                 )
             END
           WHERE source_owner_player_id=$1::uuid
           RETURNING id
         ), creator_audit AS (
           INSERT INTO creator_challenge_audit(creator_challenge_id,admin_auth_user_id,action,detail)
           SELECT id,$3::uuid,'privacy_retired',jsonb_build_object('reason','public_identity_hidden') FROM retire_creator_challenges
           RETURNING id
         ), reports AS (
           UPDATE public_identity_reports SET status='resolved',resolved_at=now(),resolved_by=$3::uuid,updated_at=now()
           WHERE target_player_id=$1::uuid AND status='open' RETURNING id
         )
         INSERT INTO public_identity_moderation_actions(
           target_player_id,admin_auth_user_id,action,reason,previous_username_owned,previous_profile_public
         )
         SELECT s.id,$3::uuid,'hide',$2,s.username_owned,s.profile_public FROM snapshot s`,
        [playerId,reason,adminAuthUserId],
      );
    } else {
      await query(
        `WITH snapshot AS MATERIALIZED (
           SELECT id,username_owned,profile_public FROM players WHERE id=$1::uuid FOR UPDATE
         ), restored AS (
           UPDATE players p SET public_identity_hidden_at=NULL,public_identity_hidden_reason=NULL,
             username_owned=false,profile_public=false,updated_at=now()
           FROM snapshot s WHERE p.id=s.id RETURNING p.id
         )
         INSERT INTO public_identity_moderation_actions(
           target_player_id,admin_auth_user_id,action,reason,previous_username_owned,previous_profile_public
         )
         SELECT s.id,$2::uuid,'restore',$3,s.username_owned,s.profile_public FROM snapshot s`,
        [playerId,adminAuthUserId,reason],
      );
    }
    return {ok:true,action,player_id:playerId};
  }
  if(request.method!=='GET')fail('Method not allowed.',405);
  const detail=url.pathname.match(/^\/v1\/admin\/users\/([a-f0-9-]+)$/i);
  if(detail) {
    if(!UUID.test(detail[1]))fail('Invalid user.',400);
    const id=detail[1];
    const [account,stats,entitlements,providers,runs,events,authActivity,identityReports,moderationActions]=await Promise.all([
      query(`SELECT u.id,u.name,u.email,u."emailVerified" email_verified,u."createdAt" created_at,u."updatedAt" updated_at,
          u.banned,u."banReason" ban_reason,u."banExpires" ban_expires,
          a.claimed_at,p.display_name profile_name,p.profile_public,p.username_owned,
          p.public_identity_terms_version,p.public_identity_terms_accepted_at,
          p.public_identity_hidden_at,p.public_identity_hidden_reason,
          (SELECT count(*)::int FROM public_identity_reports pir WHERE pir.target_player_id=p.id AND pir.status='open') open_identity_reports,
          EXISTS(SELECT 1 FROM pack1_admins pa WHERE pa.auth_user_id=u.id) is_admin
        FROM neon_auth."user" u
        LEFT JOIN account_links a ON a.auth_user_id=u.id
        LEFT JOIN players p ON p.id=a.player_id
        WHERE u.id=$1::uuid`,[id]),
      query(`SELECT count(*)::int runs,
          count(*) FILTER(WHERE score IS NOT NULL)::int completed_runs,
          count(*) FILTER(WHERE day IS NOT NULL)::int dailies,
          count(*) FILTER(WHERE day IS NULL AND challenge_id IS NULL)::int practice_runs,
          count(*) FILTER(WHERE environment='powered-cube')::int cube_runs,
          count(*) FILTER(WHERE jsonb_array_length(custom_set_ids)>0)::int custom_runs,
          round(avg(score) FILTER(WHERE score IS NOT NULL),1) average_score,
          max(score)::int best_score,max(updated_at) last_run
        FROM draft_run_sessions
        WHERE player_id=(SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid)`,[id]),
      query(`SELECT capability,provider,granted_at,expires_at,revoked_at,
          (revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())) active
        FROM entitlement_grants WHERE auth_user_id=$1::uuid
        ORDER BY granted_at DESC,capability,provider`,[id]),
      query(`SELECT provider,membership_status,currently_entitled_amount_cents,is_free_trial,is_gifted,connected_at,last_synced_at
        FROM provider_accounts WHERE auth_user_id=$1::uuid ORDER BY provider`,[id]),
      query(`SELECT environment,day::text,score,created_at,updated_at,
          CASE WHEN day IS NOT NULL THEN 'Daily'
            WHEN challenge_id IS NOT NULL THEN 'Shared run'
            WHEN jsonb_array_length(custom_set_ids)>0 THEN 'Custom practice'
            ELSE 'Practice' END run_type,
          jsonb_array_length(answers)::int answered,jsonb_array_length(puzzle_ids)::int total,
          leaderboard_eligible
        FROM draft_run_sessions
        WHERE player_id=(SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid)
        ORDER BY updated_at DESC LIMIT 20`,[id]),
      query(`SELECT event_name,event_props,created_at FROM analytics_events
        WHERE player_id=(SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid)
        ORDER BY created_at DESC LIMIT 25`,[id]),
      query(`SELECT max("updatedAt") last_auth FROM neon_auth.session WHERE "userId"=$1::uuid`,[id]),
      query(`SELECT id::text,reason,details,status,created_at,updated_at,resolved_at
        FROM public_identity_reports
        WHERE target_player_id=(SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid)
        ORDER BY created_at DESC LIMIT 25`,[id]),
      query(`SELECT action,reason,created_at,admin_auth_user_id::text,
          previous_display_name,new_display_name
        FROM public_identity_moderation_actions
        WHERE target_player_id=(SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid)
        ORDER BY created_at DESC LIMIT 25`,[id]),
    ]);
    if(!account.rows[0])fail('User not found.',404);
    const user=normalizeUser(account.rows[0]);
    user.profile_public=bool(user.profile_public);
    user.is_self=String(user.id)===String(adminAuthUserId);
    const summary={
      ...stats.rows[0],
      runs:num(stats.rows[0]?.runs),
      completed_runs:num(stats.rows[0]?.completed_runs),
      dailies:num(stats.rows[0]?.dailies),
      practice_runs:num(stats.rows[0]?.practice_runs),
      cube_runs:num(stats.rows[0]?.cube_runs),
      custom_runs:num(stats.rows[0]?.custom_runs),
      average_score:stats.rows[0]?.average_score==null?null:Number(stats.rows[0].average_score),
      best_score:stats.rows[0]?.best_score==null?null:Number(stats.rows[0].best_score),
    };
    const recentEvents=events.rows.map(row=>({...row,event_props:parse(row.event_props)||{}}));
    user.last_active=mostRecent(summary.last_run,recentEvents[0]?.created_at,authActivity.rows[0]?.last_auth);
    return {
      user,
      stats:summary,
      entitlements:entitlements.rows.map(row=>({...row,active:bool(row.active)})),
      providers:providers.rows.map(row=>({...row,currently_entitled_amount_cents:num(row.currently_entitled_amount_cents),is_free_trial:bool(row.is_free_trial),is_gifted:bool(row.is_gifted)})),
      recent_runs:runs.rows.map(row=>({...row,score:row.score==null?null:Number(row.score),answered:num(row.answered),total:num(row.total),leaderboard_eligible:bool(row.leaderboard_eligible)})),
      recent_events:recentEvents,
      identity_reports:identityReports.rows,
      moderation_actions:moderationActions.rows,
    };
  }

  if(url.pathname!=='/v1/admin/users')fail('Not found.',404);
  const filters=userAdminFilters(url),page=userAdminPage(url),sort=userAdminSort(url),activityWindow=playActivityWindow(url),
    params=[filters.search,filters.status];
  // Only validated server-owned SQL expressions ever enter ORDER BY.
  const sortOrder=`${USER_ADMIN_SORT_COLUMNS[sort.column]} ${sort.direction.toUpperCase()} NULLS LAST`+
    (sort.column==='last_active'&&sort.direction==='desc'?',u."createdAt" DESC,u.id':',u.id');
  const where=`WHERE ($1='' OR coalesce(u.name,'') ILIKE '%'||$1||'%' OR coalesce(u.email,'') ILIKE '%'||$1||'%'
      OR EXISTS(
        SELECT 1 FROM account_links search_link JOIN players search_player ON search_player.id=search_link.player_id
        WHERE search_link.auth_user_id=u.id AND coalesce(search_player.display_name,'') ILIKE '%'||$1||'%'
      ))
    AND ($2='all'
      OR ($2='paid' AND EXISTS(SELECT 1 FROM entitlement_grants eg WHERE eg.auth_user_id=u.id AND eg.revoked_at IS NULL AND (eg.expires_at IS NULL OR eg.expires_at>now())))
      OR ($2='patreon' AND EXISTS(SELECT 1 FROM provider_accounts pc WHERE pc.auth_user_id=u.id AND pc.provider='patreon'))
      OR ($2='admin' AND EXISTS(SELECT 1 FROM pack1_admins pa WHERE pa.auth_user_id=u.id)))`;
  // Overview only needs global account totals; avoid scanning directory rows or lifetime play cohorts.
  const summaryRequest=query(`WITH activity AS (
        SELECT u.id,GREATEST(
          (SELECT max(s.updated_at) FROM account_links a JOIN draft_run_sessions s ON s.player_id=a.player_id WHERE a.auth_user_id=u.id),
          (SELECT max(e.created_at) FROM account_links a JOIN analytics_events e ON e.player_id=a.player_id WHERE a.auth_user_id=u.id),
          (SELECT max(ns."updatedAt") FROM neon_auth.session ns WHERE ns."userId"=u.id)
        ) last_active
        FROM neon_auth."user" u
      )
      SELECT count(*)::int total,
        count(*) FILTER(WHERE u."createdAt">=now()-interval '30 days')::int new_30d,
        count(*) FILTER(WHERE activity.last_active>=now()-interval '30 days')::int active_30d,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM entitlement_grants eg WHERE eg.auth_user_id=u.id AND eg.revoked_at IS NULL AND (eg.expires_at IS NULL OR eg.expires_at>now())))::int paid,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM provider_accounts pc WHERE pc.auth_user_id=u.id AND pc.provider='patreon'))::int patreon,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM pack1_admins pa WHERE pa.auth_user_id=u.id))::int admins,
        count(*) FILTER(WHERE EXISTS(
          SELECT 1 FROM account_links a JOIN players p ON p.id=a.player_id
          WHERE a.auth_user_id=u.id AND NOT p.username_owned
        ))::int username_attention
      FROM neon_auth."user" u JOIN activity ON activity.id=u.id`);
  if(url.searchParams.get('summary_only')==='1') {
    const summary=await summaryRequest;
    return {generated_at:new Date().toISOString(),
      summary:Object.fromEntries(Object.entries(summary.rows[0]||{}).map(([key,value])=>[key,num(value)]))};
  }
  const includeActivity=url.searchParams.get('activity')!=='0';
  const [summary,count,rows,activity]=await Promise.all([
    summaryRequest,
    query(`SELECT count(*)::int total FROM neon_auth."user" u ${where}`,params),
    query(`SELECT u.id,u.name,u.email,u."emailVerified" email_verified,u."createdAt" created_at,u.banned,
        CASE WHEN a.claimed_at IS NOT NULL THEN lower(coalesce(p.display_name,'Pack Player')) END username_sort,
        CASE WHEN u.banned THEN 'Banned'
          WHEN a.claimed_at IS NOT NULL AND NOT coalesce(p.username_owned,false) THEN 'Username attention'
          WHEN p.public_identity_hidden_at IS NOT NULL THEN 'Identity hidden'
          WHEN EXISTS(SELECT 1 FROM entitlement_grants eg WHERE eg.auth_user_id=u.id
            AND eg.revoked_at IS NULL AND (eg.expires_at IS NULL OR eg.expires_at>now()))
            THEN 'Premium access' ELSE 'Free account' END access_sort,
        a.claimed_at,p.display_name profile_name,p.username_owned,p.public_identity_hidden_at,
        (SELECT count(*)::int FROM public_identity_reports pir WHERE pir.target_player_id=p.id AND pir.status='open') open_identity_reports,
        EXISTS(SELECT 1 FROM pack1_admins pa WHERE pa.auth_user_id=u.id) is_admin,
        EXISTS(SELECT 1 FROM provider_accounts pc WHERE pc.auth_user_id=u.id AND pc.provider='patreon') patreon_connected,
        (SELECT count(*)::int FROM entitlement_grants eg WHERE eg.auth_user_id=u.id AND eg.revoked_at IS NULL AND (eg.expires_at IS NULL OR eg.expires_at>now())) active_entitlements,
        COALESCE((SELECT jsonb_agg(eg.capability ORDER BY eg.capability) FROM entitlement_grants eg
          WHERE eg.auth_user_id=u.id AND eg.revoked_at IS NULL AND (eg.expires_at IS NULL OR eg.expires_at>now())),'[]'::jsonb) capabilities,
        rs.runs,rs.completed_runs,rs.average_score,rs.best_score,
        GREATEST(rs.last_run,ev.last_event,au.last_auth) last_active
      FROM neon_auth."user" u
      LEFT JOIN account_links a ON a.auth_user_id=u.id
      LEFT JOIN players p ON p.id=a.player_id
      LEFT JOIN LATERAL (
        SELECT count(*)::int runs,count(*) FILTER(WHERE score IS NOT NULL)::int completed_runs,
          round(avg(score) FILTER(WHERE score IS NOT NULL),1) average_score,max(score)::int best_score,max(updated_at) last_run
        FROM draft_run_sessions s WHERE s.player_id=a.player_id
      ) rs ON true
      LEFT JOIN LATERAL (SELECT max(created_at) last_event FROM analytics_events e WHERE e.player_id=a.player_id) ev ON true
      LEFT JOIN LATERAL (SELECT max("updatedAt") last_auth FROM neon_auth.session ns WHERE ns."userId"=u.id) au ON true
      ${where}
      ORDER BY ${sortOrder}
      LIMIT 100 OFFSET $3`,[...params,(page-1)*100]),
    includeActivity?playActivity(query,activityWindow):Promise.resolve(null),
  ]);
  return {
    generated_at:new Date().toISOString(),
    filters,
    summary:Object.fromEntries(Object.entries(summary.rows[0]||{}).map(([key,value])=>[key,num(value)])),
    total_matching:num(count.rows[0]?.total),
    page,page_size:100,sort,
    truncated:num(count.rows[0]?.total)>page*100,
    users:rows.rows.map(normalizeUser),
    play_activity:activity,
  };
}
