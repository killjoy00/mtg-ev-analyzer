import assert from 'node:assert/strict';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';
import {SERVING_POLICY_VERSION,SERVING_QUALITY_SQL} from '../serving-quality.mjs';
import {gameDateKey} from '../game-date.mjs';
import {corpusMembership} from './corpus-components.mjs';
import {customSetsFromSnapshot,loadServingSnapshot,selectCachedDatabaseRun,servingRevisionMatches,toPgArray} from './draft-run-selection.mjs';
import {runActivatedSnapshotSmoke} from '../scripts/activated-snapshot-smoke.mjs';

export const READINESS_CACHE_SCHEMA='serving-cache-v1';
export const readinessKey=[DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_DIFFICULTY_VERSION,SERVING_POLICY_VERSION,READINESS_CACHE_SCHEMA];
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const yes=value=>value===true||value==='t';
const first=result=>result.rows?.[0];
const error=(message,status=409)=>Object.assign(Error(message),{status});

export async function registerServingReadiness(query) {
 return String(first(await query('SELECT pack1_register_readiness_key($1,$2,$3,$4)::text id',readinessKey)).id);
}

// This endpoint is intentionally small and read-only. Polling does not rescan
// inventory, claim a lease, create a job, or keep an expensive build alive.
export async function readServingReadiness(query,{operationId=null}={}) {
 const row=first(await query(`SELECT rv.revision::text current_revision,k.id::text key_id,
  j.id::text operation_id,j.revision::text revision,j.state,j.attempts,j.created_at,j.updated_at,
  j.lease_expires_at,j.next_attempt_at,j.finished_at,j.cache_snapshot_id::text cache_snapshot_id,
  j.worker_release,j.last_error,j.retry_count,j.evidence,
  (j.revision=rv.revision) current,
  (j.revision=rv.revision AND j.state='ready' AND s.id IS NOT NULL) ready,
  (SELECT id::text FROM draft_run_readiness_jobs WHERE key_id=k.id AND revision=rv.revision) current_operation_id
 FROM draft_run_serving_revision rv
 LEFT JOIN draft_run_readiness_keys k ON k.corpus_version=$1 AND k.difficulty_version=$2
  AND k.serving_policy_version=$3 AND k.cache_schema=$4
 LEFT JOIN draft_run_readiness_jobs j ON j.key_id=k.id AND
  CASE WHEN $5::bigint IS NULL THEN j.revision=rv.revision ELSE j.id=$5::bigint END
 LEFT JOIN draft_run_serving_snapshots s ON s.id=j.cache_snapshot_id AND s.revision=j.revision
  AND s.corpus_version=k.corpus_version AND s.difficulty_version=k.difficulty_version
  AND s.serving_policy_version=k.serving_policy_version AND s.cache_schema=k.cache_schema
 WHERE rv.singleton`,[...readinessKey,operationId]));
 if(!row)return {state:'unavailable',ready:false,message:'Serving revision is unavailable.'};
 return {...row,state:row.state||'unconfigured',current:yes(row.current),ready:yes(row.ready),
  last_error:parse(row.last_error),evidence:parse(row.evidence),attempts:Number(row.attempts||0),retry_count:Number(row.retry_count||0)};
}

export function readinessFailure(cause) {
 const code=String(cause?.pgCode||cause?.code||'');
 const transient=[429,502,503,504].includes(cause?.status)||['40001','57014','57P01','ECONNRESET','ETIMEDOUT'].includes(code)
  ||code.startsWith('08')||['AbortError','TimeoutError'].includes(cause?.name)
  ||cause instanceof TypeError&&/fetch|network/i.test(cause.message)
  ||/^Corpus SQL request failed \((429|502|503|504)\)/.test(cause?.message||'');
 if(cause?.code==='READINESS_CHANGED')return {retryable:true,detail:{code:'revision_changed',message:'Serving inputs or the Pacific date changed during verification. Retry the current operation.'}};
 if(cause?.code==='ERR_ASSERTION'||cause?.code==='READINESS_VERIFY')return {retryable:false,detail:{code:'verification_failed',message:String(cause.message).slice(0,500)}};
 return {retryable:transient,detail:{code:transient?'transient_failure':'worker_failure',message:transient?
  'Warmup or verification was interrupted. Automatic recovery is queued; an administrator may retry after the lease is released.':
  'The readiness worker failed. Inspect the operation, schema and exact worker release before retrying. No activation was rolled back.'}};
}

export function changedReadinessSets(intent,previous) {
 const environments=intent?.environments||[],old=new Map((previous?.environments||[]).map(e=>[e.set_id,e]));
 const componentsFor=(value,id)=>(value?.components||[]).filter(c=>c.set_id===id);
 return environments.filter(e=>e.status==='Live'&&previous&&(
  JSON.stringify(e)!==JSON.stringify(old.get(e.set_id))||
  JSON.stringify(componentsFor(intent,e.set_id))!==JSON.stringify(componentsFor(previous,e.set_id))
 )).map(e=>e.set_id);
}

export async function verifyServingReadiness(query,job,cache) {
 assert.equal(String(cache.revision),String(job.revision),'Built cache is not the operation revision');
 const day=gameDateKey();
 // Compare all compact selector inputs in both directions, on the database.
 // This proves removals, exclusions, bands, components and snapshot provenance,
 // not merely that the cache table exists or one lucky puzzle was selected.
 const inventory=first(await query(`WITH expected AS MATERIALIZED (
  SELECT p.puzzle_id,p.set_id,p.pick_number,r.band,p.source_draft_hash
  FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version=$3
  WHERE (${corpusMembership({serving:true})}) AND p.interesting AND p.pack_number=1 AND ${SERVING_QUALITY_SQL}
   AND NOT EXISTS(SELECT 1 FROM corpus_source_exclusions x WHERE x.set_id=p.set_id
    AND x.corpus_version=p.corpus_version AND x.source_draft_hash=p.source_draft_hash)
 ), actual AS MATERIALIZED (
  SELECT puzzle_id,set_id,pick_number,band,source_draft_hash FROM draft_run_serving_inventory WHERE snapshot_id=$2::bigint
 ) SELECT (SELECT count(*)::int FROM expected) expected,(SELECT count(*)::int FROM actual) actual,
  (SELECT count(*)::int FROM (SELECT * FROM expected EXCEPT SELECT * FROM actual) q) missing,
  (SELECT count(*)::int FROM (SELECT * FROM actual EXCEPT SELECT * FROM expected) q) extra`,
 [DRAFT_RUN_CORPUS_VERSION,cache.id,DRAFT_RUN_DIFFICULTY_VERSION]));
 assert.equal(Number(inventory.missing),0,'Current cache is missing eligible serving inventory');
 assert.equal(Number(inventory.extra),0,'Current cache contains obsolete, excluded or otherwise ineligible inventory');
 assert.equal(Number(inventory.expected),Number(inventory.actual),'Current cache inventory count differs from runtime membership');
 const previous=parse(first(await query('SELECT intent FROM draft_run_readiness_jobs WHERE key_id=$1::bigint AND revision<$2::bigint ORDER BY revision DESC LIMIT 1',[job.key_id,job.revision]))?.intent);
 const intent=parse(job.intent),eligible=customSetsFromSnapshot(cache,day);
 const targets=new Set(changedReadinessSets(intent,previous));
 if(eligible[0])targets.add(eligible[0].set_id);
 if(cache.metadata.some(e=>e.set_id==='powered-cube'))targets.add('powered-cube');
 const samples=[];
 for(const setId of targets) {
  const intended=intent.environments.find(e=>e.set_id===setId);
  const smoke=await runActivatedSnapshotSmoke(query,{setId,snapshotId:intended.active_snapshot_id,day,
   readiness:true,expectedRevision:job.revision,log:()=>{}});
  samples.push(smoke);
 }
 // Also exercise the real multi-set cached selector, without creating sessions.
 if(eligible.length>1) {
  const setIds=eligible.slice(0,2).map(e=>e.set_id);
  const chosen=await selectCachedDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,`readiness:${job.revision}:multi`,'mixed',{day,setIds,readiness:true});
  assert.equal(String(chosen.servingRevision),String(job.revision),'Multi-set selection changed revision');
  const count=Number(first(await query(`SELECT count(*)::int n FROM draft_run_serving_inventory
   WHERE snapshot_id=$1::bigint AND puzzle_id=ANY($2::text[])`,[cache.id,toPgArray(chosen.map(p=>p.puzzle_id))])).n);
  assert.equal(count,8,'Multi-set selection is not eight decisions from the verified inventory');
  samples.push({mode:'multi',set_ids:setIds,puzzles:chosen.map(p=>p.puzzle_id)});
 }
 if(!await servingRevisionMatches(query,job.revision)||day!==gameDateKey())throw Object.assign(Error('Readiness inputs changed'),{code:'READINESS_CHANGED'});
 return {revision:String(job.revision),day,cache_snapshot_id:String(cache.id),
  inventory:{verified:true,expected:Number(inventory.expected),actual:Number(inventory.actual),missing:0,extra:0},samples};
}

// One bounded attempt. A database lease, not this Promise or an in-memory flag,
// owns execution. The existing authenticated ten-minute maintenance invocation
// recovers expired leases and due retries even if the initiating request died.
export async function advanceServingReadiness(query,{operationId=null,release=process.env.PACK1_RELEASE_COMMIT||'unknown',
 build=q=>loadServingSnapshot(q,DRAFT_RUN_CORPUS_VERSION,{readiness:true}),verify=verifyServingReadiness}={}) {
 const before=await readServingReadiness(query,{operationId});
 if(operationId&&!before.current)return before;
 if(!before.key_id||!before.operation_id)return before;
 if(before.ready)return before;
 const job=parse(first(await query('SELECT pack1_claim_readiness($1::bigint,$2) job',[before.key_id,release]))?.job);
 if(!job)return readServingReadiness(query,{operationId:before.operation_id});
 try {
  const cache=await build(query);
  assert.equal(String(cache.revision),String(job.revision),'Warmup built a superseding revision');
  const accepted=yes(first(await query('SELECT pack1_readiness_verifying($1::bigint,$2::uuid,$3::bigint) accepted',[job.id,job.lease_token,cache.id])).accepted);
  if(!accepted)throw Object.assign(Error('Readiness claim changed'),{code:'READINESS_CHANGED'});
  const evidence=await verify(query,job,cache);
  const completed=yes(first(await query('SELECT pack1_complete_readiness($1::bigint,$2::uuid,$3::bigint,$4::jsonb) completed',
   [job.id,job.lease_token,cache.id,JSON.stringify(evidence)])).completed);
  if(!completed)throw Object.assign(Error('Readiness completion changed'),{code:'READINESS_CHANGED'});
 } catch(cause) {
  const failure=readinessFailure(cause);
  // If persistence also fails, leave the lease to expire. Never claim rollback,
  // forget committed publication, or depend on fire-and-forget continuation.
  await query('SELECT pack1_fail_readiness($1::bigint,$2::uuid,$3::boolean,$4::jsonb)',
   [job.id,job.lease_token,failure.retryable,JSON.stringify(failure.detail)]);
 }
 return readServingReadiness(query,{operationId:job.id});
}

export async function retryServingReadiness(query,operationId,identity) {
 if(!/^[1-9][0-9]{0,18}$/.test(String(operationId)))throw error('Invalid readiness operation.');
 const accepted=yes(first(await query('SELECT pack1_retry_readiness($1::bigint,$2::jsonb) accepted',[operationId,JSON.stringify(identity)])).accepted);
 if(!accepted)throw error('This operation is current, running, already ready, or superseded. Refresh readiness before retrying.');
 return advanceServingReadiness(query,{operationId});
}

export async function maintainServingReadiness(query,options={}) {
 try {
  const status=await advanceServingReadiness(query,options);
  return {operation:'corpus-readiness',...status};
 } catch {
  return {operation:'corpus-readiness',state:'unavailable',ready:false,
   message:'Readiness could not be inspected. The durable job remains recoverable; check database/schema availability.'};
 }
}
