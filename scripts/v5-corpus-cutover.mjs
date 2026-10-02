import fs from 'node:fs';
import modelVersions from '../model-versions.json' with {type:'json'};
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';
import {SERVING_POLICY_VERSION} from '../serving-quality.mjs';
import {CORPUS_GATE_VERSION} from '../corpus-quality.mjs';
import {V5_PARENT_CORPUS_VERSION} from '../corpus-components.mjs';
import {READINESS_CACHE_SCHEMA,registerServingReadiness,advanceServingReadiness,readServingReadiness} from '../worker/corpus-readiness.mjs';
import {verifyCorpusPublicationToken,CORPUS_PUBLICATION_AUDIENCE} from '../worker/trophy-import-auth.mjs';
import {corpusDatabase} from './neon-corpus-db.mjs';

const [connection,action,candidateRoot='generated/v5-candidate',stateFile='generated/v5-release-baseline.json']=process.argv.slice(2);
if(!connection||!['activate','rollback','verify-active'].includes(action))throw Error('Usage: node scripts/v5-corpus-cutover.mjs CONNECTION activate|rollback|verify-active CANDIDATE_ROOT STATE_FILE');
if(DRAFT_RUN_CORPUS_VERSION!==V5_PARENT_CORPUS_VERSION)throw Error('Cutover must run from the reviewed v9 release commit.');
const query=corpusDatabase(connection);
const catalog=JSON.parse(fs.readFileSync(candidateRoot+'/v5-trophy-import/catalog.json','utf8'));
const baseline=JSON.parse(fs.readFileSync(stateFile,'utf8'));
if(catalog.corpus_version!==V5_PARENT_CORPUS_VERSION||catalog.sets.length!==32||baseline.sets?.length!==32)throw Error('Incomplete v9 candidate or rollback baseline.');
const bySet=new Map(catalog.sets.map(s=>[s.id,s]));
const baselineBySet=new Map((baseline.environment||[]).map(e=>[e.set_id,e]));
const mapping=[...bySet].sort(([a],[b])=>a.localeCompare(b)).map(([set_id,set])=>{
  const before=baselineBySet.get(set_id);
  if(!before||!set.source_snapshot_id)throw Error('Candidate/baseline set mismatch: '+set_id);
  return {set_id,target_snapshot_id:set.source_snapshot_id,previous_snapshot_id:before.active_snapshot_id};
});
if(new Set(mapping.map(x=>x.target_snapshot_id)).size!==mapping.length)throw Error('Duplicate v9 source snapshot identity.');

async function workflowIdentity() {
  const endpoint=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL||'');
  endpoint.searchParams.set('audience',CORPUS_PUBLICATION_AUDIENCE);
  const r=await fetch(endpoint,{headers:{authorization:`Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN||''}`},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Administrative workflow identity unavailable');
  return verifyCorpusPublicationToken((await r.json()).value);
}
async function parentReady(parent) {
  const row=(await query(`SELECT rv.revision::text revision,j.state,
      (j.revision=rv.revision AND j.state='ready' AND s.id IS NOT NULL) ready,j.id::text operation_id
    FROM draft_run_serving_revision rv
    LEFT JOIN draft_run_readiness_keys k ON k.corpus_version=$1 AND k.difficulty_version=$2
      AND k.serving_policy_version=$3 AND k.cache_schema=$4
    LEFT JOIN draft_run_readiness_jobs j ON j.key_id=k.id AND j.revision=rv.revision
    LEFT JOIN draft_run_serving_snapshots s ON s.id=j.cache_snapshot_id AND s.revision=rv.revision
    WHERE rv.singleton`,[parent,DRAFT_RUN_DIFFICULTY_VERSION,SERVING_POLICY_VERSION,READINESS_CACHE_SCHEMA])).rows[0];
  return {...row,ready:row?.ready===true||row?.ready==='t'};
}
async function verifyPointers(expected='target') {
  const rows=(await query(`SELECT p.set_id,p.status,p.active_snapshot_id,s.corpus_version,s.lifecycle_status
    FROM draft_run_environment_policy p JOIN corpus_source_snapshots s ON s.source_snapshot_id=p.active_snapshot_id
    WHERE p.set_id=ANY($1::text[]) ORDER BY p.set_id`,['{'+mapping.map(x=>'"'+x.set_id+'"').join(',')+'}'])).rows;
  if(rows.length!==mapping.length)throw Error('Cutover environments are missing.');
  for(const row of rows) {
    const item=mapping.find(x=>x.set_id===row.set_id);
    const wanted=expected==='target'?item.target_snapshot_id:item.previous_snapshot_id;
    const version=expected==='target'?modelVersions.v5.corpus_version:modelVersions.v4.corpus_version;
    if(row.active_snapshot_id!==wanted||row.corpus_version!==version)throw Error(`${row.set_id}: active pointer is not the expected ${expected} snapshot`);
    if(row.status==='Live'&&row.lifecycle_status!=='Approved')throw Error(row.set_id+': Live environment snapshot is not Approved');
    if(row.status==='Candidate'&&row.lifecycle_status!=='Candidate')throw Error(row.set_id+': Candidate environment snapshot changed lifecycle');
  }
  return rows;
}

if(action==='verify-active') {
  await verifyPointers('target');
  const [v8,v9]=await Promise.all([parentReady(modelVersions.v4.corpus_version),parentReady(modelVersions.v5.corpus_version)]);
  if(!v8.ready||!v9.ready)throw Error('Both v8 bridge and v9 release readiness must be ready after activation.');
  console.log(JSON.stringify({verified:true,v8,v9,sets:mapping.length}));
  process.exit(0);
}

const identity=await workflowIdentity();
const reason=`Owner-authorized v5/v9 ${action}; exact candidate run ${process.env.V5_CANDIDATE_RUN_ID||'unknown'}, workflow run ${identity.run_id}`;
const identityJson=JSON.stringify(identity);
const mapJson=JSON.stringify(mapping);

if(action==='activate') {
  const result=(await query(`WITH requested AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS x(set_id text,target_snapshot_id text,previous_snapshot_id text)
    ), eligible AS MATERIALIZED (
      SELECT r.set_id,r.target_snapshot_id,r.previous_snapshot_id,e.status
      FROM requested r
      JOIN draft_run_environment_policy e ON e.set_id=r.set_id AND e.active_snapshot_id=r.previous_snapshot_id
      JOIN corpus_source_snapshots old ON old.source_snapshot_id=r.previous_snapshot_id
        AND old.set_id=r.set_id AND old.corpus_version=$2
      JOIN corpus_source_snapshots target ON target.source_snapshot_id=r.target_snapshot_id
        AND target.set_id=r.set_id AND target.corpus_version=$3 AND target.lifecycle_status='Candidate'
      JOIN LATERAL (
        SELECT h.ready,h.gate_version,h.manifest_hash,h.checked_at
        FROM corpus_health_checks h WHERE h.source_snapshot_id=target.source_snapshot_id
        ORDER BY h.checked_at DESC,h.id DESC LIMIT 1
      ) h ON h.ready AND h.gate_version=$4 AND h.manifest_hash=md5(target.manifest::text)
        AND h.checked_at>now()-interval '7 days'
      WHERE e.status IN ('Live','Candidate')
    ), guard AS (
      SELECT count(*)::int n FROM eligible
      HAVING count(*)=(SELECT count(*) FROM requested) AND count(*)=$5
    ), changed AS (
      UPDATE draft_run_environment_policy e
      SET active_snapshot_id=x.target_snapshot_id,status_changed_at=now()
      FROM eligible x,guard g WHERE e.set_id=x.set_id
      RETURNING e.set_id,e.status,e.active_snapshot_id
    ), promoted AS (
      UPDATE corpus_source_snapshots s
      SET lifecycle_status='Approved',status_changed_at=now(),superseded_by=NULL
      FROM changed c WHERE c.status='Live' AND s.source_snapshot_id=c.active_snapshot_id
        AND s.lifecycle_status='Candidate'
      RETURNING s.source_snapshot_id
    ), superseded AS (
      UPDATE corpus_source_snapshots s
      SET lifecycle_status='Superseded',status_changed_at=now(),superseded_by=r.target_snapshot_id
      FROM requested r JOIN changed c ON c.set_id=r.set_id
      WHERE s.source_snapshot_id=r.previous_snapshot_id AND s.lifecycle_status IN ('Approved','Candidate')
      RETURNING s.source_snapshot_id
    ), audit AS (
      INSERT INTO corpus_status_events(set_id,auth_user_id,old_status,new_status,reason,admin_identity,source_snapshot_id,previous_source_snapshot_id)
      SELECT c.set_id,NULL,c.status,c.status,$6,$7::jsonb,c.active_snapshot_id,r.previous_snapshot_id
      FROM changed c JOIN requested r USING(set_id) RETURNING id
    )
    SELECT (SELECT count(*) FROM requested)::int requested,
      (SELECT count(*) FROM changed)::int changed,
      (SELECT count(*) FROM promoted)::int promoted,
      (SELECT count(*) FROM superseded)::int superseded,
      (SELECT count(*) FROM audit)::int audited`,
    [mapJson,modelVersions.v4.corpus_version,modelVersions.v5.corpus_version,CORPUS_GATE_VERSION,mapping.length,reason,identityJson])).rows[0];
  if(Number(result?.changed)!==mapping.length||Number(result?.audited)!==mapping.length)throw Error('Cross-version activation compare-and-swap failed: '+JSON.stringify(result));
  await registerServingReadiness(query);
  const readiness=await advanceServingReadiness(query);
  if(!readiness.ready)throw Error('v9 parent activation committed but readiness is not ready: '+JSON.stringify(readiness));
  const v8=await parentReady(modelVersions.v4.corpus_version);
  if(!v8.ready)throw Error('v8 bridge readiness was not preserved across the v9 pointer activation.');
  await verifyPointers('target');
  console.log(JSON.stringify({activated:true,...result,v8,v9:readiness}));
} else {
  const result=(await query(`WITH requested AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS x(set_id text,target_snapshot_id text,previous_snapshot_id text)
    ), eligible AS MATERIALIZED (
      SELECT r.set_id,r.target_snapshot_id,r.previous_snapshot_id,e.status
      FROM requested r
      JOIN draft_run_environment_policy e ON e.set_id=r.set_id AND e.active_snapshot_id=r.target_snapshot_id
      JOIN corpus_source_snapshots target ON target.source_snapshot_id=r.target_snapshot_id
        AND target.set_id=r.set_id AND target.corpus_version=$3
      JOIN corpus_source_snapshots old ON old.source_snapshot_id=r.previous_snapshot_id
        AND old.set_id=r.set_id AND old.corpus_version=$2 AND old.lifecycle_status='Superseded'
      WHERE e.status IN ('Live','Candidate') AND target.lifecycle_status IN ('Approved','Candidate')
    ), guard AS (
      SELECT count(*)::int n FROM eligible
      HAVING count(*)=(SELECT count(*) FROM requested) AND count(*)=$4
    ), changed AS (
      UPDATE draft_run_environment_policy e
      SET active_snapshot_id=x.previous_snapshot_id,status_changed_at=now()
      FROM eligible x,guard g WHERE e.set_id=x.set_id
      RETURNING e.set_id,e.status,e.active_snapshot_id
    ), restored AS (
      UPDATE corpus_source_snapshots s
      SET lifecycle_status=CASE WHEN c.status='Live' THEN 'Approved' ELSE 'Candidate' END,
        status_changed_at=now(),superseded_by=NULL
      FROM changed c WHERE s.source_snapshot_id=c.active_snapshot_id
      RETURNING s.source_snapshot_id
    ), staged AS (
      UPDATE corpus_source_snapshots s SET lifecycle_status='Candidate',status_changed_at=now(),superseded_by=NULL
      FROM requested r JOIN changed c ON c.set_id=r.set_id
      WHERE s.source_snapshot_id=r.target_snapshot_id
      RETURNING s.source_snapshot_id
    ), components AS (
      UPDATE corpus_components SET status='Candidate',status_changed_at=now()
      WHERE parent_version=$3 AND status='Live' RETURNING component_version
    ), audit AS (
      INSERT INTO corpus_status_events(set_id,auth_user_id,old_status,new_status,reason,admin_identity,source_snapshot_id,previous_source_snapshot_id)
      SELECT c.set_id,NULL,c.status,c.status,$5,$6::jsonb,c.active_snapshot_id,r.target_snapshot_id
      FROM changed c JOIN requested r USING(set_id) RETURNING id
    )
    SELECT (SELECT count(*) FROM requested)::int requested,
      (SELECT count(*) FROM changed)::int changed,
      (SELECT count(*) FROM restored)::int restored,
      (SELECT count(*) FROM staged)::int staged,
      (SELECT count(*) FROM components)::int components_paused,
      (SELECT count(*) FROM audit)::int audited`,
    [mapJson,modelVersions.v4.corpus_version,modelVersions.v5.corpus_version,mapping.length,reason,identityJson])).rows[0];
  if(Number(result?.changed)!==mapping.length||Number(result?.audited)!==mapping.length)throw Error('Cross-version rollback compare-and-swap failed: '+JSON.stringify(result));
  const v8=await parentReady(modelVersions.v4.corpus_version);
  if(!v8.ready)throw Error('Restored v8 revision is not ready after rollback.');
  await verifyPointers('previous');
  console.log(JSON.stringify({rolled_back:true,...result,v8}));
}
