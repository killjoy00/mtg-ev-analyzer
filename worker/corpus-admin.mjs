import {SERVING_POLICY_VERSION,SERVING_QUALITY_SQL,MINIMUM_IMPLIED_TROPHY_SCORE} from '../serving-quality.mjs';
import {corpusMembership} from './corpus-components.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {TRADITIONAL_GATE_VERSION} from '../corpus-components.mjs';
import {CORPUS_GATE_VERSION,CORPUS_THRESHOLDS,CORPUS_TRANSITIONS} from '../corpus-quality.mjs';

const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const parse=x=>typeof x==='string'?JSON.parse(x):x;
const number=x=>Number(x||0);
const resultRows=result=>result?.rows||result||[];

function summarize(rows,{retainedField='retained',eligibleField='eligible',underFloorField='under_floor',excludedField='excluded'}={}) {
 const summary={retained_count:0,eligible_count:0,under_floor_count:0,excluded_count:0,inventory_by_pick:{}};
 for(const row of rows) {
  summary.retained_count+=number(row[retainedField]);
  summary.eligible_count+=number(row[eligibleField]);
  summary.under_floor_count+=number(row[underFloorField]);
  summary.excluded_count+=number(row[excludedField]);
  const pick=String(row.pick_number);
  summary.inventory_by_pick[pick]=(summary.inventory_by_pick[pick]||0)+number(row[eligibleField]);
 }
 return summary;
}

function rowsForSnapshot(rows,snapshot) {
 return rows.filter(row=>row.set_id===snapshot.set_id&&row.corpus_version===snapshot.corpus_version&&(
  row.source_snapshot_id===snapshot.source_snapshot_id||
  (row.source_snapshot_id==null&&snapshot.schema_version==='historical-frozen')
 ));
}

export function assembleCorpusAdmin({sets,history,components,blockedSources,retainedInventory,servingInventory,snapshots,servingRevision}) {
 const setRows=resultRows(sets),componentRows=resultRows(components),retainedRows=resultRows(retainedInventory),servingRows=resultRows(servingInventory);
 const enrichedSnapshots=resultRows(snapshots).map(snapshot=>{
  const retained=summarize(rowsForSnapshot(retainedRows,snapshot));
  const serving=summarize(rowsForSnapshot(servingRows,snapshot));
  return {...snapshot,...retained,serving_count:serving.eligible_count,serving_under_floor_count:serving.under_floor_count,
   active:snapshot.active===true||snapshot.active==='t',report:parse(snapshot.report)};
 });
 const snapshotsFor=setId=>enrichedSnapshots.filter(snapshot=>snapshot.set_id===setId);
 const componentsFor=setId=>componentRows.filter(component=>component.set_id===setId);
 const exactServingFor=(setId,version=null)=>servingRows.filter(row=>row.set_id===setId&&(!version||row.corpus_version===version));
 const retainedFor=(setId,version=null)=>retainedRows.filter(row=>row.set_id===setId&&(!version||row.corpus_version===version));
 const enrichedComponents=componentRows.map(component=>{
  const retained=summarize(retainedFor(component.set_id,component.component_version));
  const serving=summarize(exactServingFor(component.set_id,component.component_version));
  return {...component,...retained,serving_count:serving.eligible_count,serving_under_floor_count:serving.under_floor_count,
   serving_by_pick:serving.inventory_by_pick,manifest:parse(component.manifest),report:parse(component.report)};
 });
 const enrichedSets=setRows.map(set=>{
  const exactServing=exactServingFor(set.set_id),parentServing=exactServing.filter(row=>row.corpus_version===DRAFT_RUN_CORPUS_VERSION);
  const supplementalServing=exactServing.filter(row=>row.corpus_version!==DRAFT_RUN_CORPUS_VERSION);
  const serving=summarize(exactServing),parent=summarize(parentServing),supplemental=summarize(supplementalServing);
  const parentRetained=summarize(retainedFor(set.set_id,DRAFT_RUN_CORPUS_VERSION));
  const setSnapshots=snapshotsFor(set.set_id),active=setSnapshots.find(snapshot=>snapshot.active);
  const activeInventory=active?{
   retained_count:active.retained_count,eligible_count:active.eligible_count,under_floor_count:active.under_floor_count,
   excluded_count:active.excluded_count,inventory_by_pick:active.inventory_by_pick
  }:parentRetained;
  const staged=setSnapshots.filter(snapshot=>!snapshot.active&&['Blocked','Candidate'].includes(snapshot.lifecycle_status));
  const retained=setSnapshots.filter(snapshot=>!snapshot.active&&!['Blocked','Candidate'].includes(snapshot.lifecycle_status));
  const sumSnapshots=list=>list.reduce((totals,snapshot)=>({
   retained_count:totals.retained_count+number(snapshot.retained_count),eligible_count:totals.eligible_count+number(snapshot.eligible_count),
   under_floor_count:totals.under_floor_count+number(snapshot.under_floor_count),excluded_count:totals.excluded_count+number(snapshot.excluded_count)
  }),{retained_count:0,eligible_count:0,under_floor_count:0,excluded_count:0});
  const stagedInventory=sumSnapshots(staged),retainedSnapshots=sumSnapshots(retained);
  const componentRetained=summarize(componentsFor(set.set_id).flatMap(component=>retainedFor(set.set_id,component.component_version)));
  return {...set,
   serving_count:serving.eligible_count,under_floor_count:serving.under_floor_count,serving_by_pick:serving.inventory_by_pick,
   serving_parent_count:parent.eligible_count,serving_component_count:supplemental.eligible_count,
   retained_count:parentRetained.retained_count,retained_eligible_count:parentRetained.eligible_count,
   active_snapshot_retained_count:activeInventory.retained_count,active_snapshot_eligible_count:activeInventory.eligible_count,
   active_snapshot_under_floor_count:activeInventory.under_floor_count,active_snapshot_excluded_count:activeInventory.excluded_count,
   staged_count:stagedInventory.retained_count,staged_eligible_count:stagedInventory.eligible_count,
   historical_retained_count:retainedSnapshots.retained_count,component_retained_count:componentRetained.retained_count,
   manifest:parse(set.manifest),report:parse(set.report)};
 });
 return {
  corpus_version:DRAFT_RUN_CORPUS_VERSION,
  serving_policy_version:SERVING_POLICY_VERSION,
  serving_revision:servingRows[0]?.serving_revision??resultRows(servingRevision)[0]?.revision??null,
  minimum_implied_trophy_score:MINIMUM_IMPLIED_TROPHY_SCORE,
  thresholds:CORPUS_THRESHOLDS,
  gate_version:CORPUS_GATE_VERSION,
  sets:enrichedSets,
  components:enrichedComponents,
  blocked_sources:resultRows(blockedSources),
  snapshots:enrichedSnapshots,
  history:resultRows(history),
  transitions:CORPUS_TRANSITIONS
 };
}

export async function handleCorpusAdmin(request,query,readJson,accountId,automationIdentity=null) {
 const path=new URL(request.url).pathname;
 if(request.method==='GET'&&path==='/v1/admin/corpus') {
  const [sets,history,components,blockedSources,retainedInventory,servingInventory,snapshots,servingRevision]=await Promise.all([
   query(`WITH known AS (SELECT set_id FROM draft_run_verified_sets UNION SELECT set_id FROM corpus_sources)
    SELECT k.set_id,p.status,p.regular_run,coalesce(p.set_name,s.set_name,k.set_id) set_name,
    coalesce(p.release_date,s.release_date)::text release_date,coalesce(s.event_type,p.source_event_type) source_event_type,
    s.archive_url,s.archive_available,s.archive_etag,s.archive_last_modified,s.last_checked_at,s.import_status,s.last_error,
    v.corpus_version,coalesce(a.manifest,v.manifest) manifest,v.last_successful_import,
    p.active_snapshot_id,a.corpus_version active_snapshot_corpus_version,a.schema_version active_snapshot_schema_version,a.lifecycle_status active_snapshot_lifecycle_status,
    a.created_at active_snapshot_created_at,a.importer_identity active_snapshot_importer_identity,a.model_identity active_snapshot_model_identity,
    h.checked_at last_health_verification,h.report,h.ready,
    (SELECT count(*) FROM corpus_source_exclusions x WHERE x.set_id=k.set_id AND x.corpus_version=$1) excluded_source_trajectories,
    (h.manifest_hash=md5(coalesce(a.manifest,v.manifest)::text) AND h.checked_at>now()-interval '7 days' AND h.gate_version=$2) health_current
    FROM known k LEFT JOIN draft_run_environment_policy p USING(set_id)
    LEFT JOIN corpus_sources s ON s.set_id=k.set_id AND s.event_type='PremierDraft'
    LEFT JOIN corpus_set_versions v ON v.set_id=k.set_id AND v.corpus_version=$1
    LEFT JOIN corpus_source_snapshots a ON a.source_snapshot_id=p.active_snapshot_id AND a.set_id=k.set_id
    LEFT JOIN LATERAL (
     SELECT * FROM corpus_health_checks c
     WHERE CASE WHEN a.source_snapshot_id IS NOT NULL THEN c.source_snapshot_id=a.source_snapshot_id
      ELSE c.set_id=k.set_id AND c.corpus_version=$1 AND c.source_snapshot_id IS NULL END
     ORDER BY checked_at DESC,id DESC LIMIT 1
    ) h ON true
    ORDER BY coalesce(p.release_date,s.release_date) DESC NULLS LAST,k.set_id,s.event_type`,[DRAFT_RUN_CORPUS_VERSION,CORPUS_GATE_VERSION]),
   query('SELECT set_id,component_version,auth_user_id,admin_identity,changed_at,old_status,new_status,reason,source_snapshot_id,previous_source_snapshot_id FROM corpus_status_events ORDER BY changed_at DESC,id DESC LIMIT 100'),
   query(`SELECT c.*,v.manifest,h.checked_at,h.ready,h.report,
     (h.manifest_hash=md5(v.manifest::text) AND h.checked_at>now()-interval '7 days' AND h.gate_version=$2) health_current
     FROM corpus_components c JOIN corpus_set_versions v ON v.set_id=c.set_id AND v.corpus_version=c.component_version
     LEFT JOIN LATERAL(SELECT * FROM corpus_health_checks q WHERE q.set_id=c.set_id AND q.corpus_version=c.component_version ORDER BY checked_at DESC,id DESC LIMIT 1) h ON true
     WHERE c.parent_version=$1 ORDER BY c.set_id,c.component_version`,[DRAFT_RUN_CORPUS_VERSION,TRADITIONAL_GATE_VERSION]),
   query("SELECT s.set_id,s.event_type,s.archive_url,s.import_status,s.last_error FROM corpus_sources s WHERE s.event_type='TradDraft' AND s.import_status='failed' AND NOT EXISTS(SELECT 1 FROM corpus_components c WHERE c.set_id=s.set_id AND c.parent_version=$1)",[DRAFT_RUN_CORPUS_VERSION]),
   query(`SELECT p.set_id,p.corpus_version,p.source_snapshot_id,p.pick_number,count(*)::int retained,
    count(*) FILTER(WHERE x.source_draft_hash IS NOT NULL)::int excluded,
    count(*) FILTER(WHERE x.source_draft_hash IS NULL AND r.puzzle_id IS NOT NULL AND ${SERVING_QUALITY_SQL})::int eligible,
    count(*) FILTER(WHERE x.source_draft_hash IS NULL AND (r.puzzle_id IS NULL OR NOT coalesce((${SERVING_QUALITY_SQL}),false)))::int under_floor
    FROM draft_run_verified_puzzles p
    LEFT JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
    LEFT JOIN corpus_source_exclusions x ON x.set_id=p.set_id AND x.corpus_version=p.corpus_version AND x.source_draft_hash=p.source_draft_hash
    WHERE (${corpusMembership()}) AND p.interesting AND p.pack_number=1
    AND p.pick_number BETWEEN CASE WHEN p.set_id='powered-cube' THEN 2 ELSE 1 END AND CASE WHEN p.set_id='powered-cube' THEN 9 ELSE 8 END
    GROUP BY p.set_id,p.corpus_version,p.source_snapshot_id,p.pick_number`,[DRAFT_RUN_CORPUS_VERSION]),
   query(`SELECT p.set_id,p.corpus_version,p.source_snapshot_id,p.pick_number,rv.revision::text serving_revision,count(*)::int retained,
    count(*) FILTER(WHERE r.puzzle_id IS NOT NULL AND ${SERVING_QUALITY_SQL})::int eligible,
    count(*) FILTER(WHERE r.puzzle_id IS NULL OR NOT coalesce((${SERVING_QUALITY_SQL}),false))::int under_floor,
    0::int excluded
    FROM draft_run_verified_puzzles p
    LEFT JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
    CROSS JOIN draft_run_serving_revision rv
    WHERE (${corpusMembership({serving:true})}) AND p.interesting AND p.pack_number=1
    AND p.pick_number BETWEEN CASE WHEN p.set_id='powered-cube' THEN 2 ELSE 1 END AND CASE WHEN p.set_id='powered-cube' THEN 9 ELSE 8 END
    AND NOT EXISTS(SELECT 1 FROM corpus_source_exclusions x WHERE x.set_id=p.set_id AND x.corpus_version=p.corpus_version AND x.source_draft_hash=p.source_draft_hash)
    GROUP BY p.set_id,p.corpus_version,p.source_snapshot_id,p.pick_number,rv.revision`,[DRAFT_RUN_CORPUS_VERSION]),
   query(`SELECT s.source_snapshot_id,s.set_id,s.event_type,s.corpus_version,s.schema_version,s.lifecycle_status,s.created_at,s.status_changed_at,s.superseded_by,
     s.importer_identity,s.model_identity,s.draft_sha256,s.game_sha256,s.draft_etag,s.game_etag,s.draft_last_modified,s.game_last_modified,
     h.checked_at,h.ready,h.report,(h.manifest_hash=md5(s.manifest::text) AND h.checked_at>now()-interval '7 days' AND h.gate_version=$2) health_current,
     (p.active_snapshot_id=s.source_snapshot_id) active,p.status environment_status
    FROM corpus_source_snapshots s
    LEFT JOIN draft_run_environment_policy p ON p.set_id=s.set_id
    LEFT JOIN LATERAL(SELECT * FROM corpus_health_checks q WHERE q.source_snapshot_id=s.source_snapshot_id ORDER BY checked_at DESC,id DESC LIMIT 1) h ON true
    WHERE s.corpus_version=$1 OR p.active_snapshot_id=s.source_snapshot_id
    ORDER BY s.set_id,(p.active_snapshot_id=s.source_snapshot_id) DESC,s.created_at DESC,s.source_snapshot_id DESC`,[DRAFT_RUN_CORPUS_VERSION,CORPUS_GATE_VERSION]),
   query('SELECT revision::text revision FROM draft_run_serving_revision WHERE singleton')
  ]);
  return assembleCorpusAdmin({sets,history,components,blockedSources,retainedInventory,servingInventory,snapshots,servingRevision});
 }
 const component=path.match(/^\/v1\/admin\/corpus\/([a-z0-9-]{2,40})\/components\/([a-z0-9-]{2,80})\/status$/);
 if(request.method==='POST'&&component) {
  if(!accountId&&!automationIdentity)fail('Authenticated administrative identity required.',403);
  const b=await readJson(request),old=b.oldStatus,next=b.status;
  if(!CORPUS_TRANSITIONS[old]?.includes(next))fail('Invalid lifecycle transition.');
  if(b.corpusVersion!==DRAFT_RUN_CORPUS_VERSION)fail('The parent corpus changed. Refresh.',409);
  if(b.reason!=null&&(typeof b.reason!=='string'||b.reason.length>1000))fail('Reason must be at most 1,000 characters.');
  const result=await query(`WITH identity_allowed AS MATERIALIZED (
   SELECT 1 WHERE $6::uuid IS NULL OR pack1_identity_attachment_allowed($6::uuid)
  ), changed AS (
   UPDATE corpus_components c SET status=$4,status_changed_at=now()
   WHERE c.set_id=$1 AND c.component_version=$2 AND c.parent_version=$5 AND c.status=$3
     AND EXISTS(SELECT 1 FROM identity_allowed)
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
 const snapshotMatch=path.match(/^\/v1\/admin\/corpus\/([a-z0-9-]{2,40})\/snapshot$/);
 if(request.method==='POST'&&snapshotMatch) {
  if(!accountId&&!automationIdentity)fail('Authenticated administrative identity required.',403);
  const b=await readJson(request);
  if(b.corpusVersion!==DRAFT_RUN_CORPUS_VERSION)fail('The serving corpus changed. Refresh the dashboard.',409);
  if(!/^[a-f0-9]{64}$/.test(String(b.sourceSnapshotId||'')))fail('Invalid source snapshot identity.');
  if(b.reason!=null&&(typeof b.reason!=='string'||b.reason.length>1000))fail('Reason must be at most 1,000 characters.');
  const result=await query(`WITH identity_allowed AS MATERIALIZED (
   SELECT 1 WHERE $4::uuid IS NULL OR pack1_identity_attachment_allowed($4::uuid)
  ), current AS MATERIALIZED (
   SELECT p.set_id,p.status,p.active_snapshot_id
   FROM draft_run_environment_policy p
   WHERE p.set_id=$1 AND p.status='Live' AND EXISTS(SELECT 1 FROM identity_allowed)
  ), target AS MATERIALIZED (
   SELECT s.source_snapshot_id
   FROM corpus_source_snapshots s
   JOIN LATERAL (
    SELECT * FROM corpus_health_checks h
    WHERE h.source_snapshot_id=s.source_snapshot_id
    ORDER BY checked_at DESC,id DESC LIMIT 1
   ) h ON true
   WHERE s.source_snapshot_id=$2 AND s.set_id=$1 AND s.corpus_version=$3
    AND s.lifecycle_status='Candidate'
    AND h.ready AND h.gate_version=$6 AND h.manifest_hash=md5(s.manifest::text)
    AND h.checked_at>now()-interval '7 days'
  ), changed AS (
   UPDATE draft_run_environment_policy p
   SET active_snapshot_id=t.source_snapshot_id,status_changed_at=now()
   FROM current c,target t
   WHERE p.set_id=c.set_id AND c.active_snapshot_id IS DISTINCT FROM t.source_snapshot_id
   RETURNING p.set_id,p.status,c.active_snapshot_id previous_source_snapshot_id,p.active_snapshot_id source_snapshot_id
  ), promoted AS (
   UPDATE corpus_source_snapshots s SET lifecycle_status='Approved',status_changed_at=now()
   FROM changed c WHERE s.source_snapshot_id=c.source_snapshot_id AND s.lifecycle_status='Candidate'
   RETURNING s.source_snapshot_id
  ), superseded AS (
   UPDATE corpus_source_snapshots s SET lifecycle_status='Superseded',status_changed_at=now(),superseded_by=c.source_snapshot_id
   FROM changed c WHERE s.source_snapshot_id=c.previous_source_snapshot_id AND s.lifecycle_status='Approved'
   RETURNING s.source_snapshot_id
  ), audit AS (
   INSERT INTO corpus_status_events(set_id,auth_user_id,old_status,new_status,reason,admin_identity,source_snapshot_id,previous_source_snapshot_id)
   SELECT c.set_id,$4::uuid,'Live','Live',$5,$7::jsonb,c.source_snapshot_id,c.previous_source_snapshot_id
   FROM changed c RETURNING id
  )
  SELECT c.* FROM changed c CROSS JOIN promoted CROSS JOIN audit`,
  [snapshotMatch[1],b.sourceSnapshotId,DRAFT_RUN_CORPUS_VERSION,accountId,b.reason||null,CORPUS_GATE_VERSION,automationIdentity?JSON.stringify(automationIdentity):null]);
  if(!result.rows.length)fail('Snapshot changed, is not Candidate, or lacks fresh passing health evidence.',409);
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
  const result=await query(`WITH identity_allowed AS MATERIALIZED (
   SELECT 1 WHERE $5::uuid IS NULL OR pack1_identity_attachment_allowed($5::uuid)
  ), changed AS (
   UPDATE draft_run_environment_policy p SET status=$3,status_changed_at=now()
   WHERE p.set_id=$1 AND p.status=$2 AND EXISTS(SELECT 1 FROM identity_allowed)
     AND ($3<>'Live' OR EXISTS (
    SELECT 1 FROM corpus_source_snapshots s JOIN LATERAL (
     SELECT * FROM corpus_health_checks c WHERE c.source_snapshot_id=s.source_snapshot_id ORDER BY checked_at DESC,id DESC LIMIT 1
    ) h ON true WHERE s.source_snapshot_id=p.active_snapshot_id AND s.set_id=p.set_id AND s.corpus_version=$4
      AND s.lifecycle_status IN ('Candidate','Approved') AND h.ready AND h.gate_version=$7
      AND h.manifest_hash=md5(s.manifest::text) AND h.checked_at>now()-interval '7 days'
      AND p.source_event_type='PremierDraft' AND (p.set_id='powered-cube' OR (p.release_date IS NOT NULL AND p.set_name IS NOT NULL AND btrim(p.set_name)<>''))))
   RETURNING p.set_id,p.status,p.active_snapshot_id
  ), approved AS (
   UPDATE corpus_source_snapshots s SET lifecycle_status='Approved',status_changed_at=now()
   FROM changed c WHERE c.status='Live' AND s.source_snapshot_id=c.active_snapshot_id AND s.lifecycle_status='Candidate'
   RETURNING s.source_snapshot_id
  ), audit AS (INSERT INTO corpus_status_events(set_id,auth_user_id,old_status,new_status,reason,source_snapshot_id)
   SELECT set_id,$5::uuid,$2,status,$6,active_snapshot_id FROM changed RETURNING id)
  SELECT changed.* FROM changed CROSS JOIN audit`,[match[1],old,next,DRAFT_RUN_CORPUS_VERSION,accountId,b.reason||null,CORPUS_GATE_VERSION]);
  if(!result.rows.length)fail('Status changed, or publication is blocked by missing/stale quality verification. Refresh the dashboard.',409);
  return {ok:true,...result.rows[0]};
 }
 fail('Not found.',404);
}
