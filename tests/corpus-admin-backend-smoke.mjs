import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DAILY_SELECTION_VERSION} from '../daily-selection.mjs';
import {registerHealthyCandidate} from '../scripts/corpus-candidate.mjs';
import {CORPUS_GATE_VERSION} from '../corpus-quality.mjs';
import {SERVING_POLICY_VERSION} from '../serving-quality.mjs';
import {TRADITIONAL_GATE_VERSION,TRADITIONAL_V4_PHASE2_COMPONENT_VERSION,V4_CONTEXT_MODEL_VERSION} from '../corpus-components.mjs';

if(!process.argv.includes('--dev-fixtures'))throw Error('Isolated development branch required.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query}=await import('../worker/growth-function.js');
const {default:api}=await import('../worker/draft-run-function.mjs');
const user=crypto.randomUUID(),token=crypto.randomUUID();
async function call(path,body,status=200,auth=token){const r=await api.fetch(new Request('https://packone.pro/v1/admin/corpus'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(auth?{'x-pack1-auth-session':auth}:{})},body:body?JSON.stringify(body):undefined}));const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
const original=(await query("SELECT status FROM draft_run_environment_policy WHERE set_id='hob'")).rows[0].status;
let check,staleCheck;const discovered='qa-candidate-'+crypto.randomUUID().slice(0,8);
const suffix=randomBytes(3).toString('hex'),snapshotSet=`qa-snapshot-${suffix}`,historicalSet=`qa-history-${suffix}`;
const fixtureSets=[snapshotSet,historicalSet];
const snapshotA=randomBytes(32).toString('hex'),snapshotB=randomBytes(32).toString('hex'),historicalSnapshot=randomBytes(32).toString('hex');
const componentVersion=TRADITIONAL_V4_PHASE2_COMPONENT_VERSION;
const parse=x=>typeof x==='string'?JSON.parse(x):x;
const findSet=(report,setId)=>{const row=report.sets.find(set=>set.set_id===setId);assert.ok(row,`${setId}: admin row missing`);return row;};

async function insertFixtureSet(setId,name,activeSnapshotId,manifest) {
 await query('INSERT INTO draft_run_verified_sets(set_id,corpus_version,manifest) VALUES($1,$2,$3::jsonb)',[setId,DRAFT_RUN_CORPUS_VERSION,JSON.stringify({regular_run:true,fixture:name})]);
 await query(`INSERT INTO corpus_sources(set_id,event_type,set_name,release_date,archive_available,game_archive_available,import_status)
  VALUES($1,'PremierDraft',$2,'2026-01-01',true,true,'complete')`,[setId,name]);
 await query(`INSERT INTO draft_run_environment_policy(set_id,regular_run,maximum_pick,daily_weight,selection_version,status,release_date,set_name,source_event_type,active_snapshot_id)
  VALUES($1,true,8,1,$2,'Live','2026-01-01',$3,'PremierDraft',$4)`,[setId,DAILY_SELECTION_VERSION,name,activeSnapshotId]);
 if(manifest)await query('UPDATE corpus_set_versions SET manifest=$3::jsonb WHERE set_id=$1 AND corpus_version=$2',[setId,DRAFT_RUN_CORPUS_VERSION,JSON.stringify(manifest)]);
}

async function insertSnapshot(id,setId,schema,lifecycle,manifest) {
 await query(`INSERT INTO corpus_source_snapshots(source_snapshot_id,set_id,event_type,corpus_version,schema_version,draft_sha256,game_sha256,importer_identity,model_identity,manifest,lifecycle_status)
  VALUES($1,$2,'PremierDraft',$3,$4,$5,$6,'qa-importer','qa-model',$7::jsonb,$8)`,
 [id,setId,DRAFT_RUN_CORPUS_VERSION,schema,randomBytes(32).toString('hex'),randomBytes(32).toString('hex'),JSON.stringify(manifest),lifecycle]);
}

async function insertHealth(id,setId,ready,fixture,checkedAt='now()') {
 await query(`INSERT INTO corpus_health_checks(set_id,corpus_version,source_snapshot_id,manifest_hash,gate_version,ready,report,checked_at)
  SELECT $2,s.corpus_version,s.source_snapshot_id,md5(s.manifest::text),$3,$4,$5::jsonb,${checkedAt}
  FROM corpus_source_snapshots s WHERE s.source_snapshot_id=$1`,[id,setId,CORPUS_GATE_VERSION,ready,JSON.stringify({fixture})]);
}

async function clonePuzzle({setId,version=DRAFT_RUN_CORPUS_VERSION,snapshotId=null,ratio=.5,component=false}) {
 const puzzleId=randomBytes(16).toString('hex'),sourceHash=randomBytes(16).toString('hex');
 const patch=component?{
  source_event_type:'TradDraft',event_match_wins:3,event_match_losses:0,corpus_version:version,
  parent_corpus_version:DRAFT_RUN_CORPUS_VERSION,model_version:V4_CONTEXT_MODEL_VERSION,
  model_source_event:'PremierDraft',skill_evidence:'win_rate_bucket'
 }:{source_event_type:'PremierDraft',event_match_wins:7,corpus_version:version};
 const template=(await query(`SELECT p.puzzle_id FROM draft_run_verified_puzzles p
  JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
  WHERE p.pick_number=1 AND p.pack_number=1 AND p.interesting
   AND coalesce(p.payload->>'source_event_type','PremierDraft')='PremierDraft'
  ORDER BY p.puzzle_id LIMIT 1`)).rows[0];
 assert.ok(template?.puzzle_id,'Eligible first-pick template is required.');
 await query(`INSERT INTO draft_run_verified_puzzles
  SELECT (jsonb_populate_record(NULL::draft_run_verified_puzzles,
   to_jsonb(p)||jsonb_build_object(
    'puzzle_id',$2::text,'set_id',$3::text,'source_draft_hash',$4::text,'corpus_version',$5::text,
    'pick_number',1,'source_snapshot_id',$6::text,
    'payload',p.payload||$7::jsonb
   ))).*
  FROM draft_run_verified_puzzles p WHERE p.puzzle_id=$1`,
 [template.puzzle_id,puzzleId,setId,sourceHash,version,snapshotId,JSON.stringify(patch)]);
 await query("UPDATE draft_run_puzzle_ratings SET rating=60,top_two_ratio=.5,target_support_ratio=$2 WHERE puzzle_id=$1 AND difficulty_version='support-ratio-v1'",[puzzleId,ratio]);
 return {puzzleId,sourceHash};
}

async function cacheCount(setId) {
 const built=parse((await query("SELECT pack1_serving_snapshot($1,'support-ratio-v1',$2) snapshot",[DRAFT_RUN_CORPUS_VERSION,SERVING_POLICY_VERSION])).rows[0].snapshot);
 assert.ok(built?.id,`${setId}: serving cache did not build`);
 const count=Number((await query('SELECT count(*)::int n FROM draft_run_serving_inventory WHERE snapshot_id=$1::bigint AND set_id=$2',[built.id,setId])).rows[0].n);
 return {count,revision:String(built.revision),id:String(built.id)};
}

async function assertDashboardMatchesCache(report,setId,expected) {
 const row=findSet(report,setId),cache=await cacheCount(setId);
 assert.equal(row.serving_count,expected,`${setId}: dashboard serving count`);
 assert.equal(cache.count,expected,`${setId}: cache serving count`);
 assert.equal(String(report.serving_revision),cache.revision,`${setId}: revision mismatch`);
}

async function snapshotReportingFixture() {
 await insertSnapshot(snapshotA,snapshotSet,'qa-snapshot-v1','Approved',{fixture:'active-a'});
 await insertSnapshot(snapshotB,snapshotSet,'qa-snapshot-v1','Candidate',{fixture:'candidate-b'});
 await insertFixtureSet(snapshotSet,'QA Snapshot Reporting',snapshotA);
 await insertHealth(snapshotA,snapshotSet,true,'active-a',"now()-interval '8 days'");
 await insertHealth(snapshotB,snapshotSet,false,'candidate-b-failed');
 const a1=await clonePuzzle({setId:snapshotSet,snapshotId:snapshotA,ratio:.5});
 await clonePuzzle({setId:snapshotSet,snapshotId:snapshotA,ratio:.4});
 await clonePuzzle({setId:snapshotSet,snapshotId:snapshotA,ratio:.1});
 const excluded=await clonePuzzle({setId:snapshotSet,snapshotId:snapshotA,ratio:.5});
 await query("INSERT INTO corpus_source_exclusions(set_id,corpus_version,source_draft_hash,reason,evidence) VALUES($1,$2,$3,'qa-fixture','{}')",[snapshotSet,DRAFT_RUN_CORPUS_VERSION,excluded.sourceHash]);
 await clonePuzzle({setId:snapshotSet,snapshotId:snapshotB,ratio:.5});
 await clonePuzzle({setId:snapshotSet,snapshotId:snapshotB,ratio:.5});
 await clonePuzzle({setId:snapshotSet,snapshotId:snapshotB,ratio:.5});
 await clonePuzzle({setId:snapshotSet,snapshotId:snapshotB,ratio:.1});
 assert.notEqual(a1.sourceHash,excluded.sourceHash);

 await query('INSERT INTO corpus_set_versions(set_id,corpus_version,manifest) VALUES($1,$2,$3::jsonb)',[snapshotSet,componentVersion,JSON.stringify({fixture:'live-component'})]);
 await query(`INSERT INTO corpus_components(set_id,parent_version,component_version,event_type,model_version,status)
  VALUES($1,$2,$3,'TradDraft',$4,'Live')`,[snapshotSet,DRAFT_RUN_CORPUS_VERSION,componentVersion,V4_CONTEXT_MODEL_VERSION]);
 const componentHash=(await query('SELECT md5(manifest::text) hash FROM corpus_set_versions WHERE set_id=$1 AND corpus_version=$2',[snapshotSet,componentVersion])).rows[0].hash;
 await query("INSERT INTO corpus_health_checks(set_id,corpus_version,manifest_hash,gate_version,ready,report) VALUES($1,$2,$3,$4,true,'{\"fixture\":\"live-component\"}')",[snapshotSet,componentVersion,componentHash,TRADITIONAL_GATE_VERSION]);
 await clonePuzzle({setId:snapshotSet,version:componentVersion,ratio:.5,component:true});
 await clonePuzzle({setId:snapshotSet,version:componentVersion,ratio:.1,component:true});

 await insertSnapshot(historicalSnapshot,historicalSet,'historical-frozen','Approved',{fixture:'historical-frozen'});
 await insertFixtureSet(historicalSet,'QA Historical Frozen',historicalSnapshot);
 await insertHealth(historicalSnapshot,historicalSet,true,'historical-frozen');
 await clonePuzzle({setId:historicalSet,snapshotId:null,ratio:.5});
 await clonePuzzle({setId:historicalSet,snapshotId:null,ratio:.1});

 let report=await call(''),row=findSet(report,snapshotSet),candidate=report.snapshots.find(s=>s.source_snapshot_id===snapshotB);
 assert.equal(row.serving_parent_count,2);
 assert.equal(row.serving_component_count,1);
 assert.equal(row.active_snapshot_retained_count,4);
 assert.equal(row.active_snapshot_eligible_count,2);
 assert.equal(row.active_snapshot_under_floor_count,1);
 assert.equal(row.active_snapshot_excluded_count,1);
 assert.equal(row.staged_count,4);
 assert.equal(row.staged_eligible_count,3);
 assert.equal(row.ready,true);
 assert.equal(row.health_current,false);
 assert.equal(row.report.fixture,'active-a');
 assert.ok(candidate);
 assert.equal(candidate.ready,false);
 assert.equal(candidate.serving_count,0);
 assert.equal(candidate.retained_count,4);
 assert.equal(candidate.report.fixture,'candidate-b-failed');
 await assertDashboardMatchesCache(report,snapshotSet,3);
 const historical=findSet(report,historicalSet),historicalSnapshotRow=report.snapshots.find(s=>s.source_snapshot_id===historicalSnapshot);
 assert.equal(historical.serving_count,1);
 assert.equal(historical.active_snapshot_retained_count,2);
 assert.equal(historicalSnapshotRow.retained_count,2);
 assert.equal(historicalSnapshotRow.serving_count,1);
 await assertDashboardMatchesCache(report,historicalSet,1);

 await call('/'+snapshotSet+'/snapshot',{sourceSnapshotId:snapshotB,corpusVersion:DRAFT_RUN_CORPUS_VERSION,reason:'QA blocked candidate'},409);
 await insertHealth(snapshotB,snapshotSet,true,'candidate-b-passing');
 await call('/'+snapshotSet+'/snapshot',{sourceSnapshotId:snapshotB,corpusVersion:DRAFT_RUN_CORPUS_VERSION,reason:'QA valid switch'});
 report=await call('');row=findSet(report,snapshotSet);
 assert.equal(row.active_snapshot_id,snapshotB);
 assert.equal(row.serving_parent_count,3);
 assert.equal(row.serving_component_count,1);
 assert.equal(row.report.fixture,'candidate-b-passing');
 assert.equal(report.snapshots.find(s=>s.source_snapshot_id===snapshotA).lifecycle_status,'Superseded');
 assert.equal(report.snapshots.find(s=>s.source_snapshot_id===snapshotB).lifecycle_status,'Approved');
 await assertDashboardMatchesCache(report,snapshotSet,4);

 await call('/'+snapshotSet+'/status',{oldStatus:'Live',status:'Paused',corpusVersion:DRAFT_RUN_CORPUS_VERSION,reason:'QA pause'});
 report=await call('');row=findSet(report,snapshotSet);
 assert.equal(row.status,'Paused');
 assert.equal(row.serving_parent_count,0);
 assert.equal(row.serving_component_count,1);
 assert.equal(row.active_snapshot_retained_count,4);
 await assertDashboardMatchesCache(report,snapshotSet,1);

 await call('/'+snapshotSet+'/status',{oldStatus:'Paused',status:'Retired',corpusVersion:DRAFT_RUN_CORPUS_VERSION,reason:'QA retire'});
 report=await call('');row=findSet(report,snapshotSet);
 assert.equal(row.status,'Retired');
 assert.equal(row.serving_parent_count,0);
 assert.equal(row.serving_component_count,1);
 assert.equal(row.active_snapshot_retained_count,4);
 await assertDashboardMatchesCache(report,snapshotSet,1);
}

async function cleanFixtureSet(setId) {
 await query('DELETE FROM corpus_status_events WHERE set_id=$1',[setId]);
 await query('DELETE FROM corpus_source_exclusions WHERE set_id=$1',[setId]);
 await query('DELETE FROM corpus_components WHERE set_id=$1',[setId]);
 await query('DELETE FROM draft_run_environment_policy WHERE set_id=$1',[setId]);
 await query('DELETE FROM draft_run_verified_puzzles WHERE set_id=$1',[setId]);
 await query('DELETE FROM corpus_health_checks WHERE set_id=$1',[setId]);
 await query('DELETE FROM corpus_source_snapshot_trajectories WHERE source_snapshot_id IN (SELECT source_snapshot_id FROM corpus_source_snapshots WHERE set_id=$1)',[setId]);
 await query('DELETE FROM corpus_source_snapshots WHERE set_id=$1',[setId]);
 await query('DELETE FROM corpus_sources WHERE set_id=$1',[setId]);
 await query('DELETE FROM corpus_set_versions WHERE set_id=$1',[setId]);
 await query('DELETE FROM draft_run_verified_sets WHERE set_id=$1',[setId]);
}

try {
 await call('',null,401,null);
 await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[user,'QA corpus admin',`${user}@example.invalid`]);
 await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()+interval \'1 hour\',now())',[token,user]);
 await call('',null,403);
 await query('INSERT INTO pack1_admins(auth_user_id) VALUES($1::uuid)',[user]);
 // Discovery is not Candidate. Only a current passing report earns Candidate.
 await query('INSERT INTO draft_run_verified_sets(set_id,corpus_version,manifest) VALUES($1,$2,$3::jsonb)',[discovered,DRAFT_RUN_CORPUS_VERSION,JSON.stringify({discovered:true,regular_run:true})]);
 await query("INSERT INTO corpus_sources(set_id,event_type,release_date,set_name,archive_available,import_status) VALUES($1,'PremierDraft','2026-01-01','QA Candidate',true,'complete')",[discovered]);
 const manifestHash=(await query('SELECT md5(manifest::text) hash FROM corpus_set_versions WHERE set_id=$1 AND corpus_version=$2',[discovered,DRAFT_RUN_CORPUS_VERSION])).rows[0].hash;
 assert.equal((await registerHealthyCandidate(query,discovered,manifestHash)).rows.length,0);
 await query("INSERT INTO corpus_health_checks(set_id,corpus_version,manifest_hash,gate_version,ready,report) VALUES($1,$2,$3,$4,true,'{}')",[discovered,DRAFT_RUN_CORPUS_VERSION,manifestHash,CORPUS_GATE_VERSION]);
 assert.equal((await registerHealthyCandidate(query,discovered,'stale')).rows.length,0);
 assert.equal((await registerHealthyCandidate(query,discovered,manifestHash)).rows[0].status,'Candidate');
 // A regular set cannot become Live without the metadata season reconciliation
 // needs if it later becomes the immutable Latest Set Daily.
 await query("UPDATE draft_run_environment_policy SET set_name=NULL WHERE set_id=$1",[discovered]);
 await call('/'+discovered+'/status',{oldStatus:'Candidate',status:'Live',corpusVersion:DRAFT_RUN_CORPUS_VERSION,reason:'QA missing season metadata'},409);
 await query("UPDATE draft_run_environment_policy SET set_name='QA Candidate' WHERE set_id=$1",[discovered]);
 await query("UPDATE draft_run_environment_policy SET status='Retired' WHERE set_id=$1",[discovered]);
 assert.equal((await registerHealthyCandidate(query,discovered,manifestHash)).rows.length,0);
 const report=await call('');assert.ok(report.sets.some(s=>s.set_id==='hob'));assert.equal(report.corpus_version,DRAFT_RUN_CORPUS_VERSION);
 const change=(oldStatus,status)=>call('/hob/status',{oldStatus,status,corpusVersion:DRAFT_RUN_CORPUS_VERSION,reason:'QA lifecycle'});
 // The CI database is a disposable Neon child. Remove inherited production-ready evidence so this pre-health assertion is isolated.
 await query("UPDATE corpus_health_checks SET ready=false WHERE set_id='hob' AND corpus_version=$1 AND ready=true",[DRAFT_RUN_CORPUS_VERSION]);
 await change('Live','Paused');
 await call('/hob/status',{oldStatus:'Live',status:'Paused',corpusVersion:DRAFT_RUN_CORPUS_VERSION},409);
 await call('/hob/status',{oldStatus:'Paused',status:'Live',corpusVersion:DRAFT_RUN_CORPUS_VERSION},409);
 // Health is a pre-flight check, not a heartbeat: serving never reads it, but a
 // passing check older than seven days cannot reactivate. Age every inherited row
 // so this passing-but-stale row is the latest evidence the gate sees.
 await query("UPDATE corpus_health_checks SET checked_at=now()-interval '9 days' WHERE set_id='hob' AND corpus_version=$1",[DRAFT_RUN_CORPUS_VERSION]);
 staleCheck=(await query(`INSERT INTO corpus_health_checks(set_id,corpus_version,source_snapshot_id,manifest_hash,gate_version,ready,report,checked_at)
 SELECT p.set_id,s.corpus_version,s.source_snapshot_id,md5(s.manifest::text),$2,true,'{"fixture":"stale"}',now()-interval '8 days'
 FROM draft_run_environment_policy p
 JOIN corpus_source_snapshots s ON s.source_snapshot_id=p.active_snapshot_id
 WHERE p.set_id='hob' AND s.corpus_version=$1
 RETURNING id`,[DRAFT_RUN_CORPUS_VERSION,CORPUS_GATE_VERSION])).rows[0].id;
 await call('/hob/status',{oldStatus:'Paused',status:'Live',corpusVersion:DRAFT_RUN_CORPUS_VERSION},409);
 // One exact snapshot check (simulated by a fresh passing row) then allows it.
 check=(await query(`INSERT INTO corpus_health_checks(set_id,corpus_version,source_snapshot_id,manifest_hash,gate_version,ready,report)
 SELECT p.set_id,s.corpus_version,s.source_snapshot_id,md5(s.manifest::text),$2,true,'{"fixture":true}'
 FROM draft_run_environment_policy p
 JOIN corpus_source_snapshots s ON s.source_snapshot_id=p.active_snapshot_id
 WHERE p.set_id='hob' AND s.corpus_version=$1
 RETURNING id`,[DRAFT_RUN_CORPUS_VERSION,CORPUS_GATE_VERSION])).rows[0].id;
 await change('Paused','Live');
 const audit=(await query('SELECT old_status,new_status,reason FROM corpus_status_events WHERE auth_user_id=$1::uuid ORDER BY id',[user])).rows;
 assert.deepEqual(audit.map(x=>[x.old_status,x.new_status]),[['Live','Paused'],['Paused','Live']]);
 // Staging another version must not erase the version currently serving.
 const manifest=(await query("SELECT corpus_version,manifest FROM draft_run_verified_sets WHERE set_id='hob'")).rows[0];
 await query("UPDATE draft_run_verified_sets SET corpus_version='qa-future-manifest' WHERE set_id='hob'");
 assert.equal((await query("SELECT count(*) n FROM corpus_set_versions WHERE set_id='hob' AND corpus_version=$1",[DRAFT_RUN_CORPUS_VERSION])).rows[0].n,'1');
 await query("UPDATE draft_run_verified_sets SET corpus_version=$1 WHERE set_id='hob'",[manifest.corpus_version]);
 await snapshotReportingFixture();
 console.log('PASS: Corpus admin authentication, lifecycle gates, active-snapshot reporting, cache parity, supplemental serving and historical compatibility.');
} finally {
 for(const setId of fixtureSets)await cleanFixtureSet(setId);
 await query('DELETE FROM draft_run_environment_policy WHERE set_id=$1',[discovered]);
 await query('DELETE FROM corpus_health_checks WHERE set_id=$1',[discovered]);
 await query('DELETE FROM corpus_sources WHERE set_id=$1',[discovered]);
 await query('DELETE FROM corpus_set_versions WHERE set_id=$1',[discovered]);
 await query('DELETE FROM draft_run_verified_sets WHERE set_id=$1',[discovered]);
 await query("UPDATE draft_run_environment_policy SET status=$1 WHERE set_id='hob'",[original]);
 if(check)await query('DELETE FROM corpus_health_checks WHERE id=$1::bigint',[check]);
 if(staleCheck)await query('DELETE FROM corpus_health_checks WHERE id=$1::bigint',[staleCheck]);
 await query("DELETE FROM corpus_set_versions WHERE corpus_version='qa-future-manifest'");
 await query('DELETE FROM corpus_status_events WHERE auth_user_id=$1::uuid',[user]);
 await query('DELETE FROM pack1_admins WHERE auth_user_id=$1::uuid',[user]);
 await query('DELETE FROM neon_auth.session WHERE token=$1',[token]);
 await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[user]);
}
