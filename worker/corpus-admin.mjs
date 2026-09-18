import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {CORPUS_GATE_VERSION,CORPUS_THRESHOLDS,CORPUS_TRANSITIONS} from '../corpus-quality.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const parse=x=>typeof x==='string'?JSON.parse(x):x;
export async function handleCorpusAdmin(request,query,readJson,accountId) {
 const path=new URL(request.url).pathname;
 if(request.method==='GET'&&path==='/v1/admin/corpus') {
  const [sets,history]=await Promise.all([
   query(`WITH known AS (SELECT set_id FROM draft_run_verified_sets UNION SELECT set_id FROM corpus_sources)
    SELECT k.set_id,p.status,p.regular_run,coalesce(p.set_name,s.set_name,k.set_id) set_name,
    coalesce(p.release_date,s.release_date)::text release_date,coalesce(s.event_type,p.source_event_type) source_event_type,
    s.archive_url,s.archive_available,s.archive_etag,s.archive_last_modified,s.last_checked_at,s.import_status,s.last_error,
    v.corpus_version,v.manifest,v.last_successful_import,h.checked_at last_health_verification,h.report,h.ready,
    (h.manifest_hash=md5(v.manifest::text) AND h.checked_at>now()-interval '7 days' AND h.gate_version=$2) health_current
    FROM known k LEFT JOIN draft_run_environment_policy p USING(set_id)
    LEFT JOIN corpus_sources s USING(set_id)
    LEFT JOIN corpus_set_versions v ON v.set_id=k.set_id AND v.corpus_version=$1
    LEFT JOIN LATERAL (SELECT * FROM corpus_health_checks c WHERE c.set_id=k.set_id AND c.corpus_version=$1 ORDER BY checked_at DESC,id DESC LIMIT 1) h ON true
    ORDER BY coalesce(p.release_date,s.release_date) DESC NULLS LAST,k.set_id,s.event_type`,[DRAFT_RUN_CORPUS_VERSION,CORPUS_GATE_VERSION]),
   query('SELECT set_id,auth_user_id,changed_at,old_status,new_status,reason FROM corpus_status_events ORDER BY changed_at DESC,id DESC LIMIT 100')
  ]);
  return {corpus_version:DRAFT_RUN_CORPUS_VERSION,thresholds:CORPUS_THRESHOLDS,gate_version:CORPUS_GATE_VERSION,sets:sets.rows.map(r=>({...r,manifest:parse(r.manifest),report:parse(r.report)})),history:history.rows,transitions:CORPUS_TRANSITIONS};
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
