import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {corpusDatabase} from '../scripts/neon-corpus-db.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';
import {CORPUS_GATE_VERSION} from '../corpus-quality.mjs';
import {TRADITIONAL_GATE_VERSION} from '../corpus-components.mjs';
import {gameDateKey} from '../game-date.mjs';
import {loadServingSnapshot,customSetsFromSnapshot} from '../worker/draft-run-selection.mjs';
import {handleCorpusAdmin} from '../worker/corpus-admin.mjs';
import {registerServingReadiness,readServingReadiness,advanceServingReadiness,retryServingReadiness,verifyServingReadiness} from '../worker/corpus-readiness.mjs';
const connectionFile=process.argv[2],branch=process.env.PACK1_CI_BRANCH_ID;
if(!connectionFile||!process.argv.includes('--dev-fixtures')||!branch?.startsWith('br-')||
 ['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b'].includes(branch))throw Error('Disposable CI branch identity is required.');
const query=corpusDatabase(connectionFile),parse=x=>typeof x==='string'?JSON.parse(x):x,yes=x=>x===true||x==='t';
const tag=randomBytes(5).toString('hex'),candidate=randomBytes(32).toString('hex'),reason='qa-readiness-'+tag;
const identity={actor:'isolated-readiness-fixture',run_id:process.env.GITHUB_RUN_ID||'local'};
const report={suite:'corpus-readiness',branch,sha:process.env.GITHUB_SHA,checks:[]};
const check=(name,details={})=>{report.checks.push({name,...details});console.log(JSON.stringify({check:name,...details}));};
const revision=async()=>String((await query('SELECT revision::text revision FROM draft_run_serving_revision WHERE singleton')).rows[0].revision);
async function fingerprints() {
 return (await query(`SELECT
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.day,s.environment)::text,'')) FROM draft_run_schedules s) schedules,
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text,'')) FROM (SELECT * FROM draft_run_sessions ORDER BY id LIMIT 40) s) sessions`)).rows[0];
}
const post=(path,body)=>handleCorpusAdmin(new Request('https://isolated.invalid/v1/admin/corpus'+path,{method:'POST'}),query,async()=>body,null,identity);
async function resetJob(id) {
 await query("UPDATE draft_run_readiness_jobs SET state='queued',attempts=0,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=now(),finished_at=NULL WHERE id=$1::bigint",[id]);
}
async function health(snapshot,setId,ready) {
 return (await query(`INSERT INTO corpus_health_checks(set_id,corpus_version,source_snapshot_id,manifest_hash,gate_version,ready,report)
  SELECT $2,corpus_version,source_snapshot_id,md5(manifest::text),$3,$4,$5::jsonb FROM corpus_source_snapshots WHERE source_snapshot_id=$1 RETURNING id`,
 [snapshot,setId,CORPUS_GATE_VERSION,ready,JSON.stringify({fixture:reason})])).rows[0].id;
}
let original,setId,component,componentHealth,child,crossSnapshot,futurePuzzle;
try {
 await query('DELETE FROM draft_run_readiness_keys');
 const initial=await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION);
 setId=customSetsFromSnapshot(initial,gameDateKey())[0]?.set_id;
 assert.ok(setId,'A complete Live single-set practice environment is required');
 original=(await query(`SELECT p.active_snapshot_id,p.status,s.lifecycle_status,s.superseded_by
  FROM draft_run_environment_policy p JOIN corpus_source_snapshots s ON s.source_snapshot_id=p.active_snapshot_id WHERE p.set_id=$1`,[setId])).rows[0];
 const immutable=await fingerprints();
 await registerServingReadiness(query);
 assert.equal((await readServingReadiness(query)).state,'queued');
 const countBefore=(await query('SELECT count(*)::int n FROM draft_run_serving_snapshots')).rows[0].n;
 await assert.rejects(loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION),e=>e.status===503);
 assert.equal((await query('SELECT count(*)::int n FROM draft_run_serving_snapshots')).rows[0].n,countBefore,'A player must not build an unready generation');
 const baseline=await advanceServingReadiness(query,{release:process.env.GITHUB_SHA});
 assert.equal(baseline.ready,true,JSON.stringify(baseline));
 check('registered key blocks player builders; automatic baseline verification succeeds');

 // The rebuilt checked-in baseline is loaded before its first-class full
 // snapshots. Its rows deliberately have no source_snapshot_id. A future parent
 // with no readiness key/cache must therefore remain inert until publication.
 const futureVersion='qa-future-parent-'+tag;
 futurePuzzle=randomBytes(16).toString('hex');
 const beforeFutureStage=await revision();
 await query(`INSERT INTO draft_run_verified_puzzles
  SELECT (jsonb_populate_record(NULL::draft_run_verified_puzzles,to_jsonb(p)||jsonb_build_object(
    'puzzle_id',$1,'corpus_version',$2,'source_snapshot_id',NULL,
    'payload',p.payload||jsonb_build_object('corpus_version',$2)))).*
  FROM draft_run_verified_puzzles p
  WHERE p.set_id=$3 AND p.corpus_version=$4
  ORDER BY p.puzzle_id LIMIT 1`,[futurePuzzle,futureVersion,setId,DRAFT_RUN_CORPUS_VERSION]);
 await query(`INSERT INTO draft_run_puzzle_ratings(puzzle_id,difficulty_version,rating,top_two_ratio,target_support_ratio,band)
  SELECT $1,r.difficulty_version,r.rating,r.top_two_ratio,r.target_support_ratio,r.band
  FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r USING(puzzle_id)
  WHERE p.set_id=$2 AND p.corpus_version=$3 AND r.difficulty_version=$4
  ORDER BY p.puzzle_id LIMIT 1`,[futurePuzzle,setId,DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_DIFFICULTY_VERSION]);
 assert.equal(await revision(),beforeFutureStage,'Inactive future-parent baseline and ratings must not churn the serving revision');
 await query('DELETE FROM draft_run_verified_puzzles WHERE puzzle_id=$1',[futurePuzzle]);
 futurePuzzle=null;
 assert.equal(await revision(),beforeFutureStage,'Removing inactive future-parent fixtures must remain non-serving');
 check('future-parent NULL-snapshot baseline and ratings stage without serving revision churn');

 // A future-corpus pointer must not strand the still-deployed parent release.
 // The bridge keeps historical-frozen v8 membership stable, and migration 0049
 // carries the exact verified cache to the new global revision atomically.
 crossSnapshot=randomBytes(32).toString('hex');
 const crossVersion='qa-cross-version-'+tag;
 const bridgeBefore=await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION);
 const bridgeRevision=await revision();
 const priorEvidenceDay=(await query("SELECT ((clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date-1)::text day")).rows[0].day;
 await query(`UPDATE draft_run_readiness_jobs j SET evidence=jsonb_set(j.evidence,'{day}',to_jsonb($2::text))
   FROM draft_run_readiness_keys k,draft_run_serving_revision rv
   WHERE j.key_id=k.id AND k.corpus_version=$1 AND j.revision=rv.revision AND j.state='ready' AND rv.singleton`,
  [DRAFT_RUN_CORPUS_VERSION,priorEvidenceDay]);
 await query(`INSERT INTO corpus_source_snapshots(source_snapshot_id,set_id,event_type,corpus_version,schema_version,importer_identity,model_identity,manifest,lifecycle_status)
  VALUES($1,$2,'PremierDraft',$3,'qa-cross-version-v1','isolated-fixture','future-model',$4::jsonb,'Candidate')`,
 [crossSnapshot,setId,crossVersion,JSON.stringify({fixture:reason,cross_version:true})]);
 await query('UPDATE draft_run_environment_policy SET active_snapshot_id=$2 WHERE set_id=$1',[setId,crossSnapshot]);
 const bridged=await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION);
 const bridgedReadiness=await readServingReadiness(query);
 assert.notEqual(bridgedReadiness.revision,bridgeRevision);
 assert.equal(bridgedReadiness.ready,true,JSON.stringify(bridgedReadiness));
 assert.equal(String(bridged.id),String(bridgeBefore.id),'Exact-equivalent bridge should retain the verified cache identity');
 assert.equal(bridgedReadiness.evidence.day,priorEvidenceDay,'Carry must preserve the original evidence day rather than claim a fresh Daily verification');
 assert.equal(bridgedReadiness.evidence.samples[0].mode,'exact-serving-input-carry-forward');
 assert.equal(bridgedReadiness.evidence.samples[0].carried_evidence_day,priorEvidenceDay);
 await query('UPDATE draft_run_environment_policy SET active_snapshot_id=$2 WHERE set_id=$1',[setId,original.active_snapshot_id]);
 const restoredBridge=await readServingReadiness(query);
 assert.equal(restoredBridge.ready,true,JSON.stringify(restoredBridge));
 assert.equal(String((await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION)).id),String(bridgeBefore.id));
 await query('DELETE FROM corpus_source_snapshots WHERE source_snapshot_id=$1',[crossSnapshot]);
 crossSnapshot=null;
 check('cross-version pointer changes preserve an exactly equivalent verified parent cache without a 503 window');

 const beforeStaging=await revision();
 await query(`INSERT INTO corpus_source_snapshots(source_snapshot_id,set_id,event_type,corpus_version,schema_version,importer_identity,model_identity,manifest,lifecycle_status)
  VALUES($1,$2,'PremierDraft',$3,'qa-readiness-v1','isolated-fixture','unchanged-model',$4::jsonb,'Candidate')`,
 [candidate,setId,DRAFT_RUN_CORPUS_VERSION,JSON.stringify({fixture:reason})]);
 // Server-side clone into a new source namespace: no payload egress, no change to
 // retained rows. Full source coverage avoids an artificial one-pick canary.
 await query(`INSERT INTO draft_run_verified_puzzles
  SELECT (jsonb_populate_record(NULL::draft_run_verified_puzzles,to_jsonb(p)||jsonb_build_object(
   'puzzle_id',md5($1||p.puzzle_id),'source_snapshot_id',$1::text,'source_draft_hash',md5($1||p.source_draft_hash),
   'payload',p.payload||jsonb_build_object('source_snapshot_id',$1::text)))).*
  FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version=$4
  WHERE p.set_id=$2 AND p.corpus_version=$3 AND p.interesting AND p.pack_number=1
   AND r.target_support_ratio>=0.20526315789473684::float8
   AND (p.source_snapshot_id=$5 OR (p.source_snapshot_id IS NULL AND $6='historical-frozen'))`,
 [candidate,setId,DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_DIFFICULTY_VERSION,original.active_snapshot_id,
  (await query('SELECT schema_version FROM corpus_source_snapshots WHERE source_snapshot_id=$1',[original.active_snapshot_id])).rows[0].schema_version]);
 assert.equal(await revision(),beforeStaging,'Staged Candidate insertion must not churn the serving revision');
 await health(candidate,setId,false);
 await assert.rejects(post('/'+setId+'/snapshot',{sourceSnapshotId:candidate,corpusVersion:DRAFT_RUN_CORPUS_VERSION,reason}),e=>e.status===409);
 assert.equal(await revision(),beforeStaging,'Rejected admission must not change serving inputs');
 await health(candidate,setId,true);
 check('non-serving staging stays stable and failing quality evidence blocks activation');

 const activation=post('/'+setId+'/snapshot',{sourceSnapshotId:candidate,expectedActiveSnapshotId:original.active_snapshot_id,corpusVersion:DRAFT_RUN_CORPUS_VERSION,reason});
 let observed;
 for(let i=0;i<30;i++) {
  observed=await readServingReadiness(query);
  if(observed.revision!==beforeStaging&&['warming','verifying','ready','failed'].includes(observed.state))break;
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 assert.notEqual(observed.revision,beforeStaging);
 if(!observed.ready)await assert.rejects(loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION),e=>e.status===503);
 const concurrent=await advanceServingReadiness(query);
 assert.ok(['warming','verifying','ready'].includes(concurrent.state),JSON.stringify(concurrent));
 const activated=await activation;
 assert.equal(activated.activation_committed,true);
 assert.equal(activated.ok,true,JSON.stringify(activated));
 assert.equal(activated.readiness.attempts,1,'Concurrent worker must not claim a second build');
 const event=(await query('SELECT readiness_revision::text revision FROM corpus_status_events WHERE id=$1::bigint',[activated.activation_event_id])).rows[0];
 assert.equal(event.revision,activated.readiness.revision);
 assert.ok(activated.readiness.evidence.samples.some(s=>s.set_id===setId&&s.active_snapshot_id===candidate));
 check('admin activation proactively builds and selects the intended source; concurrent claims coalesce',{revision:event.revision,operation:activated.readiness.operation_id});

 // A real killed Node process leaves a committed lease, not an in-memory job.
 const source=(await query('SELECT source_draft_hash FROM draft_run_verified_puzzles WHERE source_snapshot_id=$1 LIMIT 1',[candidate])).rows[0].source_draft_hash;
 await query("INSERT INTO corpus_source_exclusions(set_id,corpus_version,source_draft_hash,reason,evidence) VALUES($1,$2,$3,$4,'{}')",[setId,DRAFT_RUN_CORPUS_VERSION,source,reason]);
 child=spawn(process.execPath,['--input-type=module','-e',`setInterval(()=>{},1000);const {corpusDatabase}=await import('./scripts/neon-corpus-db.mjs');const {advanceServingReadiness}=await import('./worker/corpus-readiness.mjs');await advanceServingReadiness(corpusDatabase(process.argv[1]),{build:async()=>new Promise(()=>{})});`,connectionFile],{stdio:['ignore','ignore','pipe']});
 let interrupted;
 for(let i=0;i<40;i++) {interrupted=await readServingReadiness(query);if(interrupted.state==='warming')break;await new Promise(r=>setTimeout(r,150));}
 assert.equal(interrupted.state,'warming');
 child.kill('SIGKILL');await new Promise(resolve=>child.once('close',resolve));child=null;
 await query("UPDATE draft_run_readiness_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1::bigint",[interrupted.operation_id]);
 const recovered=await advanceServingReadiness(query);
 assert.equal(recovered.ready,true,JSON.stringify(recovered));assert.equal(recovered.attempts,2);
 check('killed worker lease is reclaimed without a player request; source exclusion is verified');

 await resetJob(recovered.operation_id);
 const transient=await advanceServingReadiness(query,{build:async()=>{throw new DOMException('fixture deadline','TimeoutError');}});
 assert.equal(transient.state,'retry_wait');assert.equal(transient.ready,false);
 const retried=await retryServingReadiness(query,transient.operation_id,identity);
 assert.equal(retried.ready,true,JSON.stringify(retried));assert.equal(retried.retry_count,1);
 check('timeout is actionable and an authorized readiness retry succeeds without reactivation');

 // Corrupt only this disposable branch's derived cache. A real inventory audit
 // must fail; restoring data, not weakening a gate, permits recovery.
 const victim=(await query('SELECT * FROM draft_run_serving_inventory WHERE snapshot_id=$1::bigint LIMIT 1',[retried.cache_snapshot_id])).rows[0];
 await query('DELETE FROM draft_run_serving_inventory WHERE snapshot_id=$1::bigint AND puzzle_id=$2',[victim.snapshot_id,victim.puzzle_id]);
 await resetJob(retried.operation_id);
 const failed=await advanceServingReadiness(query);
 assert.equal(failed.state,'failed');assert.equal(failed.last_error.code,'verification_failed');
 await assert.rejects(loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION),e=>e.status===503);
 await query('INSERT INTO draft_run_serving_inventory SELECT (jsonb_populate_record(NULL::draft_run_serving_inventory,$1::jsonb)).*',[JSON.stringify(victim)]);
 assert.equal((await retryServingReadiness(query,failed.operation_id,identity)).ready,true);
 check('real cache corruption fails serving verification and cannot be bypassed by success UI');

 // Change the revision after the final smoke but before completion. This invokes
 // the real SQL completion function, not a simulated status machine.
 const current=await readServingReadiness(query);await resetJob(current.operation_id);
 const claim=parse((await query('SELECT pack1_claim_readiness($1::bigint,$2) job',[current.key_id,'stale-fixture'])).rows[0].job);
 const cache=await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION,{readiness:true});
 assert.ok(yes((await query('SELECT pack1_readiness_verifying($1::bigint,$2::uuid,$3::bigint) accepted',[claim.id,claim.lease_token,cache.id])).rows[0].accepted));
 const proof=await verifyServingReadiness(query,claim,cache);
 await query('DELETE FROM corpus_source_exclusions WHERE set_id=$1 AND corpus_version=$2 AND source_draft_hash=$3',[setId,DRAFT_RUN_CORPUS_VERSION,source]);
 const completed=(await query('SELECT pack1_complete_readiness($1::bigint,$2::uuid,$3::bigint,$4::jsonb) accepted',[claim.id,claim.lease_token,cache.id,JSON.stringify(proof)])).rows[0].accepted;
 assert.equal(yes(completed),false);
 const superseded=await readServingReadiness(query,{operationId:claim.id});
 assert.equal(superseded.state,'superseded');assert.equal(superseded.ready,false);
 const next=await advanceServingReadiness(query);assert.equal(next.ready,true,JSON.stringify(next));
 check('post-smoke concurrent revision prevents obsolete ready completion',{old_revision:String(claim.revision),current_revision:next.revision});

 // A paused environment's same snapshot must be reverified on reactivation.
 await query("UPDATE draft_run_environment_policy SET status='Paused' WHERE set_id=$1",[setId]);
 const reactivated=await post('/'+setId+'/status',{oldStatus:'Paused',status:'Live',corpusVersion:DRAFT_RUN_CORPUS_VERSION,reason});
 assert.equal(reactivated.ok,true,JSON.stringify(reactivated));
 check('reactivation of the same source creates and completes new readiness');

 component=(await query(`SELECT c.set_id,c.component_version,c.status,v.manifest FROM corpus_components c
  JOIN corpus_set_versions v ON v.set_id=c.set_id AND v.corpus_version=c.component_version
  JOIN draft_run_environment_policy p ON p.set_id=c.set_id AND p.status='Live'
  WHERE c.parent_version=$1 AND c.status='Live' ORDER BY c.set_id LIMIT 1`,[DRAFT_RUN_CORPUS_VERSION])).rows[0];
 assert.ok(component,'A Live supplemental component fixture is required');
 await query("UPDATE corpus_components SET status='Paused' WHERE set_id=$1 AND component_version=$2",[component.set_id,component.component_version]);
 assert.equal((await readServingReadiness(query)).ready,false);
 componentHealth=(await query(`INSERT INTO corpus_health_checks(set_id,corpus_version,manifest_hash,gate_version,ready,report)
  SELECT set_id,corpus_version,md5(manifest::text),$3,true,$4::jsonb FROM corpus_set_versions WHERE set_id=$1 AND corpus_version=$2 RETURNING id`,
 [component.set_id,component.component_version,TRADITIONAL_GATE_VERSION,JSON.stringify({fixture:reason})])).rows[0].id;
 const componentReady=await post('/'+component.set_id+'/components/'+component.component_version+'/status',
  {oldStatus:'Paused',status:'Live',corpusVersion:DRAFT_RUN_CORPUS_VERSION,reason});
 assert.equal(componentReady.ok,true,JSON.stringify(componentReady));
 check('component lifecycle invalidates and warms through the same guarded operation');
 assert.deepEqual(await fingerprints(),immutable,'Readiness must not rewrite fixed Dailies or historical sessions');
 check('existing fixed schedules and historical sessions are byte-for-byte unchanged');
 report.pass=true;
} finally {
 if(child)child.kill('SIGKILL');
 // All of these mutations are restricted to the disposable branch above.
 await query('DELETE FROM draft_run_readiness_keys');
 if(component)await query('UPDATE corpus_components SET status=$3 WHERE set_id=$1 AND component_version=$2',[component.set_id,component.component_version,component.status]);
 if(componentHealth)await query('DELETE FROM corpus_health_checks WHERE id=$1::bigint',[componentHealth]);
 if(original) {
  await query('UPDATE draft_run_environment_policy SET active_snapshot_id=$2,status=$3 WHERE set_id=$1',[setId,original.active_snapshot_id,original.status]);
  await query('UPDATE corpus_source_snapshots SET lifecycle_status=$2,superseded_by=$3 WHERE source_snapshot_id=$1',[original.active_snapshot_id,original.lifecycle_status,original.superseded_by]);
 }
 if(futurePuzzle)await query('DELETE FROM draft_run_verified_puzzles WHERE puzzle_id=$1',[futurePuzzle]);
 if(crossSnapshot)await query('DELETE FROM corpus_source_snapshots WHERE source_snapshot_id=$1',[crossSnapshot]);
 await query('DELETE FROM corpus_status_events WHERE reason=$1',[reason]);
 await query('DELETE FROM corpus_source_exclusions WHERE reason=$1',[reason]);
 await query('DELETE FROM draft_run_verified_puzzles WHERE source_snapshot_id=$1',[candidate]);
 await query('DELETE FROM corpus_health_checks WHERE source_snapshot_id=$1',[candidate]);
 await query('DELETE FROM corpus_source_snapshots WHERE source_snapshot_id=$1',[candidate]);
 fs.mkdirSync('artifacts/corpus-readiness',{recursive:true});
 fs.writeFileSync('artifacts/corpus-readiness/isolated.json',JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report));
