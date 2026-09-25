const UUID=/^[a-f0-9-]{36}$/i;
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
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

export async function handleUserAdmin(request,query,url=new URL(request.url)) {
  if(request.method!=='GET')fail('Method not allowed.',405);
  const detail=url.pathname.match(/^\/v1\/admin\/users\/([a-f0-9-]+)$/i);
  if(detail) {
    if(!UUID.test(detail[1]))fail('Invalid user.',400);
    const id=detail[1];
    const [account,stats,entitlements,providers,runs,events,authActivity]=await Promise.all([
      query(`SELECT u.id,u.name,u.email,u."emailVerified" email_verified,u."createdAt" created_at,u."updatedAt" updated_at,
          u.banned,u."banReason" ban_reason,u."banExpires" ban_expires,
          a.claimed_at,p.display_name profile_name,p.profile_public,p.username_owned,
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
    ]);
    if(!account.rows[0])fail('User not found.',404);
    const user=normalizeUser(account.rows[0]);
    user.profile_public=bool(user.profile_public);
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
    };
  }

  if(url.pathname!=='/v1/admin/users')fail('Not found.',404);
  const filters=userAdminFilters(url),params=[filters.search,filters.status];
  const where=`WHERE ($1='' OR coalesce(u.name,'') ILIKE '%'||$1||'%' OR coalesce(u.email,'') ILIKE '%'||$1||'%')
    AND ($2='all'
      OR ($2='paid' AND EXISTS(SELECT 1 FROM entitlement_grants eg WHERE eg.auth_user_id=u.id AND eg.revoked_at IS NULL AND (eg.expires_at IS NULL OR eg.expires_at>now())))
      OR ($2='patreon' AND EXISTS(SELECT 1 FROM provider_accounts pc WHERE pc.auth_user_id=u.id AND pc.provider='patreon'))
      OR ($2='admin' AND EXISTS(SELECT 1 FROM pack1_admins pa WHERE pa.auth_user_id=u.id)))`;
  const [summary,count,rows]=await Promise.all([
    query(`WITH activity AS (
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
      FROM neon_auth."user" u JOIN activity ON activity.id=u.id`),
    query(`SELECT count(*)::int total FROM neon_auth."user" u ${where}`,params),
    query(`SELECT u.id,u.name,u.email,u."emailVerified" email_verified,u."createdAt" created_at,u.banned,
        a.claimed_at,p.display_name profile_name,p.username_owned,
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
      ORDER BY last_active DESC NULLS LAST,u."createdAt" DESC
      LIMIT 100`,params),
  ]);
  return {
    generated_at:new Date().toISOString(),
    filters,
    summary:Object.fromEntries(Object.entries(summary.rows[0]||{}).map(([key,value])=>[key,num(value)])),
    total_matching:num(count.rows[0]?.total),
    truncated:num(count.rows[0]?.total)>100,
    users:rows.rows.map(normalizeUser),
  };
}
