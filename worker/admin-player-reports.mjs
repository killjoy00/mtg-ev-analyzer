import {advanceServingReadiness} from './corpus-readiness.mjs';
import {reportedPickContext,moderateReportedPick} from './report-pick-removal.mjs';
// Admin-only inbox. The caller must authenticate against pack1_admins before
// entering this handler; never mount these routes on a public/player endpoint.
const DECISION_REASONS=new Set(['all','draft_context','card_or_image','score_recommendation','uninteresting','broken','other']);
const PROFILE_REASONS=new Set(['all','offensive_name','harassment','impersonation','spam','other']);
const DECISION_STATES=new Set(['open','reviewed','dismissed']);
const PROFILE_STATES=new Set(['open','resolved','dismissed']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const PAGE_SIZE=25;

function filtersFor(url) {
  const kind=url.searchParams.get('kind')||'decisions';
  const status=url.searchParams.get('status')||'open';
  const reason=url.searchParams.get('reason')||'all';
  const pageRaw=url.searchParams.get('page')||'1';
  if(!['decisions','profiles'].includes(kind))fail('Invalid report type.');
  if(status!=='all'&&!(kind==='decisions'?DECISION_STATES:PROFILE_STATES).has(status))fail('Invalid report status.');
  if(!(kind==='decisions'?DECISION_REASONS:PROFILE_REASONS).has(reason))fail('Invalid report reason.');
  if(!/^[1-9][0-9]{0,3}$/.test(pageRaw))fail('Invalid page number.');
  return {kind,status,reason,page:Number(pageRaw),limit:PAGE_SIZE,offset:(Number(pageRaw)-1)*PAGE_SIZE};
}

async function summary(query) {
  const [decisions,profiles]=await Promise.all([
    query("SELECT count(*)::int total, count(*) FILTER (WHERE review_status='open')::int open, count(*) FILTER (WHERE review_status='open' AND reason='broken')::int broken_open FROM draft_run_decision_reports"),
    query("SELECT count(*)::int total, count(*) FILTER (WHERE status='open')::int open FROM public_identity_reports"),
  ]);
  return {decisions:decisions.rows[0],profiles:profiles.rows[0]};
}

async function listReports(query,url) {
  const filters=filtersFor(url);
  const {status,reason,limit,offset,kind}=filters;
  const isDecision=kind==='decisions';
  const from=isDecision?'draft_run_decision_reports r':'public_identity_reports r';
  const statusColumn=isDecision?'r.review_status':'r.status';
  const where=' WHERE ($1::text=\'all\' OR '+statusColumn+'=$1::text) AND ($2::text=\'all\' OR r.reason=$2::text)';
  const params=[status,reason];
  const count=await query('SELECT count(*)::int total FROM '+from+where,params);
  const fields=isDecision
    ? 'r.id, r.created_at, r.review_status status, r.reviewed_at, r.review_note, r.reason, r.comment, r.puzzle_id, r.set_id, r.pick_number, r.round_number, r.selected_card_name, r.recommended_card_name, r.recommended_card_score, r.environment, r.daily_date, r.corpus_version, r.model_version, r.scoring_version, r.backend_release, r.client_platform, r.client_version, r.client_build, (SELECT count(*)::int FROM draft_run_decision_reports x WHERE x.puzzle_id=r.puzzle_id) reports_on_decision, (SELECT count(DISTINCT x.player_id)::int FROM draft_run_decision_reports x WHERE x.puzzle_id=r.puzzle_id) independent_reporters'
    : 'r.id, r.created_at, r.updated_at, r.status, r.reason, r.details, r.target_player_id, p.display_name target_name, p.public_identity_hidden_at, a.auth_user_id target_auth_user_id';
  const join=isDecision?'':' JOIN players p ON p.id=r.target_player_id LEFT JOIN LATERAL (SELECT auth_user_id FROM account_links al WHERE al.player_id=r.target_player_id LIMIT 1) a ON true';
  const rows=await query('SELECT '+fields+' FROM '+from+join+where+' ORDER BY r.created_at DESC,r.id DESC LIMIT $3::int OFFSET $4::int',[...params,limit,offset]);
  return {filters:{kind,status,reason,page:filters.page},page_size:limit,total:count.rows[0]?.total||0,rows:rows.rows};
}

async function reviewDecision(query,id,body,actor) {
  const status=String(body.status||'');
  const expected=String(body.expected_status||'');
  const note=body.note==null?'':String(body.note).trim();
  if(!DECISION_STATES.has(status)||!DECISION_STATES.has(expected)||status===expected)fail('Choose a valid new report status.');
  if(note.length>500)fail('Review note is too long.');
  if(status==='open'&&note)fail('Reopened reports cannot retain a review note.');
  const updated=await query(
    'UPDATE draft_run_decision_reports SET review_status=$2, reviewed_at=CASE WHEN $2=\'open\' THEN NULL ELSE now() END, reviewed_by=CASE WHEN $2=\'open\' THEN NULL ELSE $4::uuid END, review_note=CASE WHEN $2=\'open\' THEN NULL ELSE nullif($3,\'\') END WHERE id=$1::uuid AND review_status=$5 RETURNING id,review_status status,reviewed_at,review_note',
    [id,status,note,actor,expected]
  );
  if(!updated.rows[0])fail('Report was changed by another admin or no longer exists. Refresh.',409);
  return {ok:true,report:updated.rows[0]};
}

async function reviewProfile(query,id,body,actor) {
  const status=String(body.status||'');
  const expected=String(body.expected_status||'');
  if(!((status==='dismissed'&&expected==='open')||(status==='open'&&expected==='dismissed')))
    fail('Only dismissal or reopening is allowed here. Use audited User moderation to hide a profile.');
  const updated=await query(
    "UPDATE public_identity_reports SET status=$2, updated_at=now(), resolved_at=CASE WHEN $2='open' THEN NULL ELSE now() END, resolved_by=CASE WHEN $2='open' THEN NULL ELSE $4::uuid END WHERE id=$1::bigint AND status=$3 RETURNING id,status,updated_at",
    [id,status,expected,actor]
  );
  if(!updated.rows[0])fail('Report was changed by another admin or no longer exists. Refresh.',409);
  return {ok:true,report:updated.rows[0]};
}

export async function handlePlayerReports(request,query,readJson,adminAuthUserId) {
  if(!adminAuthUserId||!UUID.test(adminAuthUserId))fail('Administrator access required.',403);
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(path==='/v1/admin/player-reports/summary'&&method==='GET')
    return {summary:await summary(query)};
  if(path==='/v1/admin/player-reports'&&method==='GET')
    return {...await listReports(query,url),summary:await summary(query)};
  if(path==='/v1/admin/player-reports/serving/warmup'&&method==='POST')
    return {readiness:await advanceServingReadiness(query)};
  const pick=path.match(/^\/v1\/admin\/player-reports\/decisions\/([a-f0-9-]{36})\/pick$/i);
  if(pick&&UUID.test(pick[1])) {
    if(method==='GET')return reportedPickContext(query,pick[1]);
    if(method==='POST')return moderateReportedPick(query,pick[1],await readJson(request),adminAuthUserId);
  }
  if(method==='POST') {
    const decision=path.match(/^\/v1\/admin\/player-reports\/decisions\/([a-f0-9-]{36})$/i);
    const profile=path.match(/^\/v1\/admin\/player-reports\/profiles\/([1-9][0-9]{0,17})$/);
    if(decision) {
      if(!UUID.test(decision[1]))fail('Invalid report ID.');
      return reviewDecision(query,decision[1],await readJson(request),adminAuthUserId);
    }
    if(profile)return reviewProfile(query,profile[1],await readJson(request),adminAuthUserId);
  }
  fail('Not found.',404);
}
