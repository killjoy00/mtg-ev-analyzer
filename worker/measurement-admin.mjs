import {createHash} from 'node:crypto';
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
const SCOPE=`FROM draft_run_measurements WHERE first_seen_at >= $1::date AND first_seen_at < $2::date+interval '1 day'
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
async function account(request,query) {
  const token=request.headers.get('x-pack1-auth-session');
  if(!token||token.length>512)fail('Sign in to your admin account.',401);
  const {rows}=await query(`SELECT "userId" id FROM neon_auth.session WHERE token=$1 AND "expiresAt">now()`,[token]);
  if(!rows[0])fail('Your account session expired. Please sign in.',401);
  return rows[0].id;
}
export async function handleAdmin(request,query,readJson) {
  const url=new URL(request.url),id=await account(request,query);
  if(url.pathname==='/v1/admin/claim'&&request.method==='POST') {
    const body=await readJson(request);
    if(!/^[a-f0-9]{64}$/.test(body.invite||''))fail('Invalid invitation.',403);
    const hash=createHash('sha256').update(body.invite).digest('hex');
    const {rows}=await query(`WITH already AS (SELECT i.redeemed_by FROM pack1_admin_invites i JOIN pack1_admins a ON a.auth_user_id=i.redeemed_by WHERE i.token_hash=$1 AND i.redeemed_by=$2::uuid),
      claimed AS (UPDATE pack1_admin_invites SET redeemed_by=$2::uuid,redeemed_at=now()
      WHERE token_hash=$1 AND expires_at>now() AND redeemed_at IS NULL RETURNING redeemed_by),
      granted AS (INSERT INTO pack1_admins(auth_user_id) SELECT redeemed_by FROM claimed ON CONFLICT DO NOTHING)
      SELECT redeemed_by FROM claimed UNION SELECT redeemed_by FROM already`,[hash,id]);
    if(!rows.length)fail('This invitation expired or has already been used.',403);
    return {ok:true};
  }
  if(!(await query('SELECT 1 FROM pack1_admins WHERE auth_user_id=$1::uuid',[id])).rows.length)fail('This account does not have admin access. Use your private invitation to claim access.',403);
  if(request.method!=='GET')fail('Method not allowed.',405);
  const filters=reportFilters(url);
  if(url.pathname==='/v1/admin/measurements') {
    const scope=`WITH scoped AS (SELECT * ${SCOPE}), primary_data AS (SELECT * FROM scoped WHERE observed AND NOT is_qa AND first_encounter)`;
    const [coverage,summary,groups,reviews,options]=await Promise.all([
      query(`${scope} SELECT count(*)::int recorded,count(*) FILTER(WHERE is_qa)::int qa_excluded,
        count(*) FILTER(WHERE NOT observed AND NOT is_qa)::int unobserved_excluded,
        count(*) FILTER(WHERE observed AND NOT is_qa AND NOT first_encounter)::int repeats_excluded,
        min(first_seen_at) collection_started FROM scoped`,filters.params),
      query(`${scope} SELECT ${METRICS},count(DISTINCT session_id)::int runs,
        count(DISTINCT session_id) FILTER(WHERE run_complete)::int completed_runs FROM primary_data`,filters.params),
      query(`${scope} SELECT dimension,label,${METRICS} FROM primary_data
        CROSS JOIN LATERAL (VALUES ('difficulty',coalesce(band,'unrated')),('set',set_id),('pick',pick_number::text),
        ('round',round::text),('model_disagreement',model_disagreement::text),('version',selection_version||' / '||scoring_version||' / '||difficulty_version)) dimensions(dimension,label)
        GROUP BY dimension,label ORDER BY dimension,label`,filters.params),
      query(`${scope}, chosen AS (SELECT puzzle_id,${METRICS},bool_or(model_disagreement) model_disagreement
        FROM primary_data GROUP BY puzzle_id HAVING count(*) FILTER(WHERE outcome='pick')>=5
        ORDER BY bool_or(model_disagreement) DESC,count(*) FILTER(WHERE outcome='pick') DESC LIMIT 30)
        SELECT c.*,p.set_id,p.pick_number,p.payload->>'historical_pick_id' trophy_id
        FROM chosen c JOIN draft_run_verified_puzzles p USING(puzzle_id)`,filters.params),
      query(`SELECT set_id FROM draft_run_verified_sets ORDER BY set_id`)
    ]);
    return {generated_at:new Date().toISOString(),filters:{...filters,params:undefined},coverage:coverage.rows[0],summary:summary.rows[0],groups:groups.rows,reviews:reviews.rows,sets:options.rows.map(r=>r.set_id),
      definitions:{primary:'First recorded encounter per player and puzzle; observed in the browser; QA excluded.',abandonment:'Unfinished run with an open viewed decision and no activity for 24 hours. A return removes this classification.',timing:'Client-reported foreground time; missing for reloads, multiple tabs, old clients, or invalid timing. This is not a trusted gameplay score.',sample:'Fewer than 30 answers is an early signal, not a calibrated difficulty estimate.',review:'Decisions with at least five first-encounter answers; model disagreement first, then sample size.'}};
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
