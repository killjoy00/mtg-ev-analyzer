import {SERVING_POLICY_VERSION,SERVING_QUALITY_SQL,MINIMUM_IMPLIED_TROPHY_SCORE} from '../serving-quality.mjs';
import {corpusMembership} from './corpus-components.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {TRADITIONAL_GATE_VERSION} from '../corpus-components.mjs';
import {CORPUS_GATE_VERSION,CORPUS_THRESHOLDS,CORPUS_TRANSITIONS} from '../corpus-quality.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const parse=x=>typeof x==='string'?JSON.parse(x):x;
export async function handleCorpusAdmin(request,query,readJson,accountId,automationIdentity=null) {
 const path=new URL(request.url).pathname;
 if(request.method==='GET'&&path==='/v1/admin/corpus') {
  const [sets,history,components,blockedSources,inventory]=await Promise.all([
   query(`WITH known AS (SELECT set_id FROM draft_run_verified_sets UNION SELECT set_id FROM corpus_sources)
    SELECT k.set_id,p.status,p.regular_run,coalesce(p.set_name,s.set_name,k.set_id) set_name,
    coalesce(p.release_date,s.release_date)::text release_date,coalesce(s.event_type,p.source_event_type) source_event_type,
    s.archive_url,s.archive_available,s.archive_etag,s.archive_last_modified,s.last_checked_at,s.import_status,s.last_error,
    v.corpus_version,v.manifest,v.last_successful_import,h.checked_at last_health_verification,h.report,h.ready,
    (SELECT count(*) FROM corpus_source_exclusions x WHERE x.set_id=k.set_id AND x.corpus_version=$1) excluded_source_trajectories,
    (h.manifest_hash=md5(v.manifest::text) AND h.checked_at>now()-interval '7 days' AND h.gate_version=$2) health_current
    FROM known k LEFT JOIN draft_run_environment_policy p USING(set_id)
    LEFT JOIN corpus_sources s ON s.set_id=k.set_id AND s.event_type='PremierDraft'
    LEFT JOIN corpus_set_versions v ON v.set_id=k.set_id AND v.corpus_version=$1
    LEFT JOIN LATERAL (SELECT * FROM corpus_health_checks c WHERE c.set_id=k.set_id AND c.corpus_version=$1 ORDER BY checked_at DESC,id DESC LIMIT 1) h ON true
    ORDER BY coalesce(p.release_date,s.release_date) DESC NULLS LAST,k.set_id,s.event_type`,[DRAFT_RUN_CORPUS_VERSION,CORPUS_GATE_VERSION]),
   query('SELECT set_id,component_version,auth_user_id,admin_identity,changed_at,old_status,new_status,reason FROM corpus_status_events ORDER BY changed_at DESC,id DESC LIMIT 100'),
   query(`SELECT c.*,v.manifest,h.checked_at,h.ready,h.report,
     (h.manifest_hash=md5(v.manifest::text) AND h.checked_at>now()-interval '7 days' AND h.gate_version=$2) health_current
     FROM corpus_components c JOIN corpus_set_versions v ON v.set_id=c.set_id AND v.corpus_version=c.component_version
     LEFT JOIN LATERAL(SELECT * FROM corpus_health_checks q WHERE q.set_id=c.set_id AND q.corpus_version=c.component_version ORDER BY checked_at DESC,id DESC LIMIT 1) h ON true
     WHERE c.parent_version=$1 ORDER BY c.set_id,c.component_version`,[DRAFT_RUN_CORPUS_VERSION,TRADITIONAL_GATE_VERSION]),
   query("SELECT s.set_id,s.event_type,s.archive_url,s.import_status,s.last_error FROM corpus_sources s WHERE s.event_type='TradDraft' AND s.import_status='failed' AND NOT EXISTS(SELECT 1 FROM corpus_components c WHERE c.set_id=s.set_id AND c.parent_version=$1)",[DRAFT_RUN_CORPUS_VERSION]),
   query(`SELECT p.set_id,p.corpus_version,p.pick_number,count(*)::int interesting,
    count(*) FILTER(WHERE ${SERVING_QUALITY_SQL})::int eligible,
    count(*) FILTER(WHERE NOT (${SERVING_QUALITY_SQL}) OR r.target_support_ratio IS NULL)::int under_floor
    FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r USING(puzzle_id)
    WHERE (${corpusMembership()}) AND p.interesting AND p.pack_number=1 AND r.difficulty_version='support-ratio-v1'
    AND p.pick_number BETWEEN CASE WHEN p.set_id='powered-cube' THEN 2 ELSE 1 END AND CASE WHEN p.set_id='powered-cube' THEN 9 ELSE 8 END
    AND NOT EXISTS(SELECT 1 FROM corpus_source_exclusions x WHERE x.set_id=p.set_id AND x.corpus_version=p.corpus_version AND x.source_draft_hash=p.source_draft_hash)
    GROUP BY p.set_id,p.corpus_version,p.pick_number`,[DRAFT_RUN_CORPUS_VERSION])
  ]);
  const counts=(set,version=null)=>{const rows=inventory.rows.filter(r=>r.set_id===set&&(version?r.corpus_version===version:r.corpus_version===DRAFT_RUN_CORPUS_VERSION||components.rows.some(c=>c.set_id===set&&c.component_version===r.corpus_version&&c.status==='Live')));return {eligible_count:rows.reduce((n,r)=>n+Number(r.eligible),0),under_floor_count:rows.reduce((n,r)=>n+Number(r.under_floor),0),serving_by_pick:rows.reduce((by,r)=>{by[r.pick_number]=(by[r.pick_number]||0)+Number(r.eligible);return by;},{})};};
  return {corpus_version:DRAFT_RUN_CORPUS_VERSION,serving_policy_version:SERVING_POLICY_VERSION,minimum_implied_trophy_score:MINIMUM_IMPLIED_TROPHY_SCORE,thresholds:CORPUS_THRESHOLDS,gate_version:CORPUS_GATE_VERSION,sets:sets.rows.map(r=>({...r,...counts(r.set_id),serving_count:r.status==='Live'?counts(r.set_id).eligible_count:0,manifest:parse(r.manifest),report:parse(r.report)})),components:components.rows.map(r=>({...r,...counts(r.set_id,r.component_version),manifest:parse(r.manifest),report:parse(r.report)})),blocked_sources:blockedSources.rows,history:history.rows,transitions:CORPUS_TRANSITIONS};
 }
 const component=path.match(/^\/v1\/admin\/corpus\/([a-z0-9-]{2,40})\/components\/([a-z0-9-]{2,80})\/status$/);
 if(request.method==='POST'&&component) {
  if(!accountId&&!automationIdentity)fail('Authenticated administrative identity required.',403);
  const b=await readJson(request),old=b.oldStatus,next=b.status;
  if(!CORPUS_TRANSITIONS[old]?.includes(next))fail('Invalid lifecycle transition.');
  if(b.corpusVersion!==DRAFT_RUN_CORPUS_VERSION)fail('The parent corpus changed. Refresh.',409);
  if(b.reason!=null&&(typeof b.reason!=='string'||b.reason.length>1000))fail('Reason must be at most 1,000 characters.');
  const result=await query(`WITH changed AS (
   UPDATE corpus_components c SET status=$4,status_changed_at=now()
   WHERE c.set_id=$1 AND c.component_version=$2 AND c.parent_version=$5 AND c.status=$3
     AND ($4<>'Live' OR EXISTS(SELECT 1 FROM corpus_set_versions v JOIN LATERAL(
       SELECT * FROM corpus_health_checks h WHERE h.set_id=v.set_id AND h.corpus_version=v.corpus_version ORDER BY checked_at DESC,id DESC LIMIT 1
     ) h ON true JOIN draft_run_environment_policy p ON p.set_id=v.set_id
     WHERE v.set_id=c.set_id AND v.corpus_version=c.component_version AND p.status='Live'
       AND h.ready AND h.gate_version=$8 AND h.manifest_hash=md5(v.manifest::text) AND h.checked_at>now()-interval '7 days'))
   RETURNING set_id,component_version,status
  ), audit AS(INSERT INTO corpus_status_events(set_id,component_version,auth_user_id,old_status,new_status,reason,admin_identity)
   SELECT set_id,component_version,$6::uuid,$3,status,$7,$9::jsonb FROM changed RETURNING id)
  SELECT changed.* FROM changed CROSS JOIN audit`,[component[1],component[2],old,next,DRAFT_RUN_CORPUS_VERSION,accountId,b.reason||null,TRADITIONAL_GATE_VERSION,automationIdentity?JSON.stringify(automationIdentity):null]);
  if(!result.rows.length)fail('Status changed, or source publication is blocked by quality gates or parent status.',409);
  return {ok:true,...result.rows[0]};
 }
 const match=path.match(/^\/v1\/admin\/corpus\/([a-z0-9-]{2,40})\/status$/);
 if(request.method==='POST'&&match) {
  const b=await readJson(request),old=b.oldStatus,next=b.status;
  if(!CORPUS_TRANSITIONS[old]?.includes(next))fail('Invalid lifecycle transition.');
  if(b.corpusVersion!==DRAFT_RUN_CORPUS_VERSION)fail('The serving corpus changed. Refresh the dashboard.',409);
  if(b.reason!=null&&(typeof b.reason!=='string'||b.reason.length>1000))fail('Reason must be at most 1,000 characters.');
  // One statement makes the state change and its audit event atomic. Promotion
  // requires fresh health for this exact manifest, not a different staged version.
  const result=await query(`WITH changed AS (
   UPDATE draft_run_environment_policy p SET status=$3,status_changed_at=now()
   WHERE p.set_id=$1 AND p.status=$2 AND ($3<>'Live' OR EXISTS (
    SELECT 1 FROM corpus_set_versions v JOIN LATERAL (
     SELECT * FROM corpus_health_checks c WHERE c.set_id=v.set_id AND c.corpus_version=v.corpus_version ORDER BY checked_at DESC,id DESC LIMIT 1
    ) h ON true WHERE v.set_id=p.set_id AND v.corpus_version=$4 AND h.ready AND h.gate_version=$7
      AND h.manifest_hash=md5(v.manifest::text) AND h.checked_at>now()-interval '7 days'
      AND p.source_event_type='PremierDraft' AND (p.set_id='powered-cube' OR p.release_date IS NOT NULL)))
   RETURNING p.set_id,p.status
  ), audit AS (INSERT INTO corpus_status_events(set_id,auth_user_id,old_status,new_status,reason)
   SELECT set_id,$5::uuid,$2,status,$6 FROM changed RETURNING id)
  SELECT changed.* FROM changed CROSS JOIN audit`,[match[1],old,next,DRAFT_RUN_CORPUS_VERSION,accountId,b.reason||null,CORPUS_GATE_VERSION]);
  if(!result.rows.length)fail('Status changed, or publication is blocked by missing/stale quality verification. Refresh the dashboard.',409);
  return {ok:true,...result.rows[0]};
 }
 fail('Not found.',404);
}
