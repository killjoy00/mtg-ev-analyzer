// Post-activation serving smoke. The Candidate payload canary proves the data is
// valid before activation; this proves the activated snapshot is what players
// actually receive, through the production selectors:
// - the serving cache inventory holds only the environment's active snapshot;
// - single-set practice (cached path) draws all eight picks from that snapshot;
// - a pack reroll returns a replacement from the same snapshot;
// - when the set is the newest Live release, the Latest Set Daily and the
//   newest-set slots of the mixed Daily come from that snapshot.
// Selection is read-only: no session, schedule or result is written. Loading
// the serving cache may build a cache snapshot, exactly as a practice start does.
// node scripts/activated-snapshot-smoke.mjs CONNECTION_FILE --set SET_ID [--snapshot ID] [--day YYYY-MM-DD]
// node scripts/activated-snapshot-smoke.mjs CONNECTION_FILE --recent HOURS
//   smoke every environment activated (first publication, reactivation or snapshot
//   switch) within HOURS; reads only status events when there is none.
import assert from 'node:assert/strict';
import modelVersions from '../model-versions.json' with {type:'json'};
import {DRAFT_RUN_CORPUS_VERSION,runPickWindows} from '../draft-run.mjs';
import {DRAFT_RUN_SELECTION_VERSION} from '../draft-run-policy.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';
import {liveRegularSets} from '../daily-selection.mjs';
import {gameDateKey} from '../game-date.mjs';
import {
 loadLiveSetMetadata,loadServingSnapshot,customSetsFromSnapshot,
 selectCachedDatabaseRun,selectDatabaseRun,selectDatabaseReroll,servingRevisionMatches,toPgArray
} from './draft-run-selection.mjs';

const fail=message=>{throw Error('Activated snapshot smoke: '+message);};

// Fails clearly when the environment or its activated snapshot is missing, rather
// than treating an absent snapshot as a pass.
export async function loadActivatedEnvironment(query,setId,expectedSnapshotId=null) {
 const env=(await query(`SELECT p.set_id,p.status,p.regular_run,p.release_date::text release_date,p.active_snapshot_id,
   s.schema_version,s.lifecycle_status,s.corpus_version,
   previous.schema_version previous_schema_version,previous.corpus_version previous_corpus_version
  FROM draft_run_environment_policy p
  LEFT JOIN corpus_source_snapshots s ON s.source_snapshot_id=p.active_snapshot_id
  LEFT JOIN LATERAL (
   SELECT old.schema_version,old.corpus_version
   FROM corpus_status_events event JOIN corpus_source_snapshots old
    ON old.source_snapshot_id=event.previous_source_snapshot_id
   WHERE event.set_id=p.set_id AND event.source_snapshot_id=p.active_snapshot_id
    AND event.old_status='Live' AND event.new_status='Live' AND old.set_id=p.set_id
    AND old.schema_version='historical-frozen' AND old.corpus_version='${modelVersions.v4.corpus_version}'
   ORDER BY event.changed_at DESC,event.id DESC LIMIT 1
  ) previous ON true
  WHERE p.set_id=$1`,[setId])).rows[0];
 if(!env)fail(`${setId} has no serving environment.`);
 if(env.status!=='Live')fail(`${setId} is ${env.status}, not Live; activate it before running this smoke.`);
 if(!env.active_snapshot_id)fail(`${setId} has no active_snapshot_id.`);
 if(!env.schema_version)fail(`${setId} active snapshot ${env.active_snapshot_id} does not exist.`);
 if(expectedSnapshotId&&env.active_snapshot_id!==expectedSnapshotId)
  fail(`${setId} is serving ${env.active_snapshot_id}, not the expected ${expectedSnapshotId}.`);
 const historical=env.schema_version==='historical-frozen';
 return {
  set_id:env.set_id,
  regular_run:env.regular_run===true||env.regular_run==='t',
  release_date:env.release_date,
  active_snapshot_id:env.active_snapshot_id,
  historical,
  legacy_coverage_parent:env.corpus_version===modelVersions.v5.corpus_version&&
   env.previous_corpus_version===modelVersions.v4.corpus_version&&
   env.previous_schema_version==='historical-frozen',
  // Historical rows keep source_snapshot_id NULL behind a frozen metadata snapshot.
  puzzle_snapshot_id:historical?null:env.active_snapshot_id,
 };
}

export async function puzzleSnapshots(query,ids) {
 const rows=(await query(`SELECT puzzle_id,set_id,corpus_version,source_snapshot_id FROM draft_run_verified_puzzles
  WHERE puzzle_id=ANY($1::text[])`,[toPgArray(ids)])).rows;
 return new Map(rows.map(row=>[row.puzzle_id,row]));
}

// Premier decisions must come from the active snapshot. A Live Traditional
// component of the same set has its own lifecycle and may share the draw, but at
// least one Premier decision is required so the snapshot is actually exercised.
export function assertFromActiveSnapshot(env,picks,snapshots,label) {
 assert.ok(picks.length>0,`${label}: nothing was selected`);
 let premier=0;
 for(const pick of picks) {
  const row=snapshots.get(pick.puzzle_id);
  assert.ok(row,`${label}: ${pick.puzzle_id} is not a stored puzzle`);
  assert.equal(row.set_id,env.set_id,`${label}: ${pick.puzzle_id} is from ${row.set_id}`);
  if(row.corpus_version!==DRAFT_RUN_CORPUS_VERSION)continue;
  premier++;
  assert.equal(row.source_snapshot_id??null,env.puzzle_snapshot_id,
   `${label}: ${pick.puzzle_id} is from snapshot ${row.source_snapshot_id}, not the active ${env.active_snapshot_id}`);
 }
 assert.ok(premier>0,`${label}: no Premier decision was selected, so the active snapshot was not exercised`);
 return premier;
}

// A version-only rebuild must preserve a historical mixed-only capability.
// Prove the retained bridge also excludes custom Practice, then exercise the
// rebuilt set through real mixed selection and a comparable pack reroll.
export async function verifyMixedOnlySnapshot(query,env,cache,{day,seed,readiness=false,
 selectRun=selectCachedDatabaseRun,selectReroll=selectDatabaseReroll}={}) {
 assert.ok(env.legacy_coverage_parent,'Mixed-only proof requires a recorded v8 historical cutover');
 const bridge=await loadServingSnapshot(query,modelVersions.v4.corpus_version,{readiness});
 assert.equal(String(bridge.revision),String(cache.revision),'Bridge capability proof changed revision');
 assert.ok(liveRegularSets(bridge.metadata,day).some(s=>s.set_id===env.set_id),'Historical set was not a released mixed environment');
 assert.equal(customSetsFromSnapshot(bridge,day,[env.set_id]).length,0,'Rebuild removed previously available single-set Practice');
 await assert.rejects(selectRun(query,DRAFT_RUN_CORPUS_VERSION,seed+':custom-denied','mixed',
  {setIds:[env.set_id],day,readiness}),cause=>Number(cause.status)===400,'Incomplete coverage must still reject single-set Practice');
 let practice;
 for(let attempt=0;attempt<128;attempt++) {
  const candidate=await selectRun(query,DRAFT_RUN_CORPUS_VERSION,seed+':mixed:'+attempt,'mixed',{day,readiness});
  assert.equal(String(candidate.servingRevision),String(cache.revision),'Mixed Practice changed revision');
  assert.deepEqual(candidate.map(p=>Number(p.pick_number)),runPickWindows('mixed').map(w=>w[0]),'Mixed Practice does not follow the run windows');
  if(candidate.some(p=>p.set_id===env.set_id)){practice=candidate;break;}
 }
 assert.ok(practice,`${env.set_id}: rebuilt snapshot was never selected for mixed Practice`);
 const selected=practice.filter(p=>p.set_id===env.set_id);
 assertFromActiveSnapshot(env,selected,await puzzleSnapshots(query,selected.map(p=>p.puzzle_id)),'mixed practice');
 const excludedSources=practice.map(p=>p.source_draft_hash);
 let reroll,round;
 for(let i=0;i<practice.length&&!reroll;i++) {
  if(practice[i].set_id!==env.set_id)continue;
  const candidate=await selectReroll(query,DRAFT_RUN_CORPUS_VERSION,practice[i],{
   type:'pack',round:i,seed,environment:'mixed',excludedSources,
   difficultyVersion:DRAFT_RUN_DIFFICULTY_VERSION,selectionVersion:DRAFT_RUN_SELECTION_VERSION,daily:false,day});
  if(!candidate)continue;
  assert.ok(!excludedSources.includes(candidate.source_draft_hash),'Mixed reroll reused a source already in the run');
  const snapshots=await puzzleSnapshots(query,[candidate.puzzle_id]);
  if(snapshots.get(candidate.puzzle_id)?.corpus_version!==DRAFT_RUN_CORPUS_VERSION)continue;
  assertFromActiveSnapshot(env,[candidate],snapshots,'mixed reroll');
  reroll=candidate;round=i;
 }
 assert.ok(reroll,`${env.set_id}: no mixed round produced a comparable Premier pack reroll`);
 return {practice:{mode:'mixed',single_set_offered:false,legacy_corpus_version:modelVersions.v4.corpus_version,
  puzzles:practice.map(p=>p.puzzle_id)},reroll:{round,replaced:practice[round].puzzle_id,replacement:reroll.puzzle_id}};
}

export async function runActivatedSnapshotSmoke(query,{setId,snapshotId=null,day=gameDateKey(),seed=`activation-smoke:${setId}:${day}`,log=console.log,readiness=false,expectedRevision=null}={}) {
 if(!setId)fail('--set is required.');
 const env=await loadActivatedEnvironment(query,setId,snapshotId);
 const result={set_id:setId,active_snapshot_id:env.active_snapshot_id,historical:env.historical,day,checks:{}};

 // Serving cache: the inventory players draw from contains this set, and only its active snapshot.
 const cache=await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION,{readiness});
 if(expectedRevision!==null)assert.equal(String(cache.revision),String(expectedRevision),'Smoke loaded a different serving revision');
 const inventory=(await query(`SELECT count(*)::int total,
   count(*) FILTER(WHERE p.source_snapshot_id IS DISTINCT FROM $3::text)::int other_snapshot
  FROM draft_run_serving_inventory i JOIN draft_run_verified_puzzles p USING(puzzle_id)
  WHERE i.snapshot_id=$1::bigint AND i.set_id=$2 AND p.corpus_version=$4`,
  [cache.id,setId,env.puzzle_snapshot_id,DRAFT_RUN_CORPUS_VERSION])).rows[0];
 assert.ok(Number(inventory.total)>0,`${setId}: serving cache inventory has no decisions for this set`);
 assert.equal(Number(inventory.other_snapshot),0,`${setId}: serving cache inventory includes decisions outside the active snapshot`);
 result.checks.serving_cache={cache_snapshot:cache.id,revision:cache.revision,decisions:Number(inventory.total)};

 // Single-set practice through the cached selector used by practice starts. A
 // first-class snapshot passed the P1-P8 coverage gate, so it must be offered;
 // a historical environment with incomplete opening packs legitimately is not.
 const cube=setId==='powered-cube',environment=cube?'powered-cube':'mixed';
 const eligible=cube||customSetsFromSnapshot(cache,day,[setId]).some(s=>s.set_id===setId);
 if(!eligible&&env.historical) {
  result.checks.practice={applicable:false,reason:'historical environment is not offered for single-set practice'};
  result.checks.reroll={applicable:false,reason:'no single-set practice run to reroll'};
 } else if(!eligible&&env.legacy_coverage_parent) {
  Object.assign(result.checks,await verifyMixedOnlySnapshot(query,env,cache,{day,seed,readiness}));
 } else {
  assert.ok(eligible,`${setId}: not offered for single-set practice (needs P1-P8 medium and hard coverage of at least 16 sources)`);
  const practice=await selectCachedDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seed,environment,{setIds:cube?[]:[setId],day,readiness});
  assert.deepEqual(practice.map(p=>Number(p.pick_number)),runPickWindows(environment).map(w=>w[0]),`${setId}: practice picks do not follow the run windows`);
  assert.equal(String(practice.servingRevision),String(cache.revision),'Practice smoke changed serving revision');
  let snapshots=await puzzleSnapshots(query,practice.map(p=>p.puzzle_id));
  assertFromActiveSnapshot(env,practice,snapshots,'practice');
  result.checks.practice={puzzles:practice.map(p=>p.puzzle_id)};

  // Pack reroll: a comparable replacement from the same active snapshot.
  // Try rounds in order until one yields a Premier replacement.
  const excludedSources=practice.map(p=>p.source_draft_hash);
  let reroll=null,round=-1;
  for(let i=0;i<practice.length&&!reroll;i++) {
   const candidate=await selectDatabaseReroll(query,DRAFT_RUN_CORPUS_VERSION,practice[i],{
    type:'pack',round:i,seed,environment,setIds:cube?[]:[setId],excludedSources,
    difficultyVersion:DRAFT_RUN_DIFFICULTY_VERSION,selectionVersion:DRAFT_RUN_SELECTION_VERSION,daily:false,day});
   if(!candidate)continue;
   assert.ok(!excludedSources.includes(candidate.source_draft_hash),`${setId}: reroll reused a source already in the run`);
   snapshots=await puzzleSnapshots(query,[candidate.puzzle_id]);
   if(snapshots.get(candidate.puzzle_id)?.corpus_version!==DRAFT_RUN_CORPUS_VERSION)continue;
   assertFromActiveSnapshot(env,[candidate],snapshots,'reroll');
   reroll=candidate;round=i;
  }
  assert.ok(reroll,`${setId}: no round produced a comparable Premier pack reroll`);
  result.checks.reroll={round,replaced:practice[round].puzzle_id,replacement:reroll.puzzle_id};
 }

 // Daily and Latest Set: planned from Live database metadata; the newest regular
 // release fills the Latest Set Daily and the first two mixed Daily slots.
 const live=liveRegularSets(await loadLiveSetMetadata(query,DRAFT_RUN_CORPUS_VERSION),day);
 const newest=live[0]?.set_id;
 if(!env.regular_run||newest!==setId) {
  result.checks.daily={applicable:false,reason:!env.regular_run?'not a regular-run environment'
   :!live.some(s=>s.set_id===setId)?`not released on ${day} (release ${env.release_date})`:`newest Live release is ${newest}`};
 } else {
  const latest=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seed+':latest','latest',{daily:true,day});
  const mixed=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seed+':daily','mixed',{daily:true,day});
  const newestSlots=mixed.filter(p=>p.set_id===setId);
  assert.ok(newestSlots.length>=2,`${setId}: mixed Daily used ${newestSlots.length} newest-set slots, expected at least 2`);
  const snapshots=await puzzleSnapshots(query,[...latest,...newestSlots].map(p=>p.puzzle_id));
  assertFromActiveSnapshot(env,latest,snapshots,'latest daily');
  assertFromActiveSnapshot(env,newestSlots,snapshots,'mixed daily');
  result.checks.daily={applicable:true,latest:latest.map(p=>p.puzzle_id),mixed_newest_slots:newestSlots.length};
 }
 await loadActivatedEnvironment(query,setId,env.active_snapshot_id);
 assert.ok(await servingRevisionMatches(query,cache.revision),'Serving revision changed during the activation smoke');
 log(JSON.stringify({smoke:'activated_snapshot',pass:true,...result}));
 return result;
}

// Activations are the admin lifecycle's Live status events: first publication,
// reactivation, and snapshot switches (Live -> Live with a new snapshot).
export async function loadRecentActivations(query,hours) {
 if(!Number.isFinite(hours)||hours<=0||hours>24*14)fail('--recent must be between 0 and 336 hours.');
 return (await query(`SELECT e.set_id,p.active_snapshot_id,max(e.changed_at) activated_at
  FROM corpus_status_events e JOIN draft_run_environment_policy p ON p.set_id=e.set_id
  WHERE e.new_status='Live' AND p.status='Live'
    AND e.changed_at>now()-make_interval(hours=>$1::int)
  GROUP BY e.set_id,p.active_snapshot_id ORDER BY e.set_id`,[Math.ceil(hours)])).rows;
}

export async function runRecentActivationSmokes(query,{hours,day=gameDateKey(),log=console.log}={}) {
 const activations=await loadRecentActivations(query,hours);
 if(!activations.length){log(JSON.stringify({smoke:'activated_snapshot',recent_hours:hours,activations:0}));return [];}
 const failures=[],results=[];
 for(const activation of activations) {
  try {results.push(await runActivatedSnapshotSmoke(query,{setId:activation.set_id,snapshotId:activation.active_snapshot_id,day,log}));}
  catch(error){failures.push(`${activation.set_id}: ${error.message}`);log(JSON.stringify({smoke:'activated_snapshot',set_id:activation.set_id,pass:false,error:error.message}));}
 }
 if(failures.length)fail(`${failures.length} of ${activations.length} recent activations failed: ${failures.join('; ')}`);
 return results;
}
