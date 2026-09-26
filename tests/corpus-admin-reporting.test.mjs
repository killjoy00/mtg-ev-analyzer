import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleCorpusAdmin} from '../worker/corpus-admin.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';

const result=rows=>({rows});
const setRow=(status='Live')=>({set_id:'qa-snapshot',set_name:'QA snapshot',status,active_snapshot_id:'a'.repeat(64),ready:true,health_current:false,report:{fixture:'active-a'},manifest:{snapshot:'A'}});
const snapshot=(id,lifecycle,active,ready,report)=>({source_snapshot_id:id,set_id:'qa-snapshot',corpus_version:DRAFT_RUN_CORPUS_VERSION,schema_version:'snapshot-v1',lifecycle_status:lifecycle,active,environment_status:'Live',ready,health_current:ready,report});
const inventory=(id,retained,eligible,under_floor=0,excluded=0,version=DRAFT_RUN_CORPUS_VERSION)=>({set_id:'qa-snapshot',corpus_version:version,source_snapshot_id:id,pick_number:1,retained,eligible,under_floor,excluded});

function assemble(status='Live'){
 const a='a'.repeat(64),b='b'.repeat(64),component='traditional-premier-v4-phase2-v1';
 return assembleCorpusAdmin({
  sets:result([setRow(status)]),history:result([]),blockedSources:result([]),servingRevision:result([{revision:'42'}]),
  components:result([{set_id:'qa-snapshot',component_version:component,status:'Live',manifest:{},ready:true,health_current:true}]),
  snapshots:result([snapshot(a,'Approved',true,true,{fixture:'active-a'}),snapshot(b,'Candidate',false,false,{fixture:'candidate-b-failed'})]),
  retainedInventory:result([inventory(a,4,2,1,1),inventory(b,5,4,1,0),inventory(null,2,1,1,0,component)]),
  servingInventory:result([
   ...(status==='Live'?[inventory(a,3,2,1,0)]:[]),
   inventory(null,2,1,1,0,component)
  ])
 });
}

test('active snapshot and Live supplemental inventory are reported independently from a failed Candidate',()=>{
 const data=assemble(),set=data.sets[0],candidate=data.snapshots.find(s=>s.lifecycle_status==='Candidate');
 assert.equal(data.serving_revision,'42');
 assert.equal(set.serving_count,3);
 assert.equal(set.serving_parent_count,2);
 assert.equal(set.serving_component_count,1);
 assert.equal(set.active_snapshot_retained_count,4);
 assert.equal(set.active_snapshot_eligible_count,2);
 assert.equal(set.active_snapshot_under_floor_count,1);
 assert.equal(set.active_snapshot_excluded_count,1);
 assert.equal(set.staged_count,5);
 assert.equal(set.staged_eligible_count,4);
 assert.deepEqual(set.report,{fixture:'active-a'});
 assert.equal(candidate.serving_count,0);
 assert.equal(candidate.retained_count,5);
 assert.equal(candidate.ready,false);
 assert.deepEqual(candidate.report,{fixture:'candidate-b-failed'});
});

test('Paused parent inventory stops serving while independently Live supplemental inventory remains exact',()=>{
 const set=assemble('Paused').sets[0];
 assert.equal(set.serving_parent_count,0);
 assert.equal(set.serving_component_count,1);
 assert.equal(set.serving_count,1);
 assert.equal(set.active_snapshot_retained_count,4);
});

test('historical-frozen snapshots own retained NULL-snapshot rows',()=>{
 const historical='historical-qa';
 const data=assembleCorpusAdmin({
  sets:result([{set_id:'qa-history',set_name:'QA history',status:'Live',active_snapshot_id:historical,ready:true,health_current:true,manifest:{}}]),
  history:result([]),components:result([]),blockedSources:result([]),servingRevision:result([{revision:'9'}]),
  snapshots:result([{source_snapshot_id:historical,set_id:'qa-history',corpus_version:DRAFT_RUN_CORPUS_VERSION,schema_version:'historical-frozen',lifecycle_status:'Approved',active:true,environment_status:'Live',ready:true,health_current:true,report:{fixture:'historical'}}]),
  retainedInventory:result([{set_id:'qa-history',corpus_version:DRAFT_RUN_CORPUS_VERSION,source_snapshot_id:null,pick_number:1,retained:3,eligible:2,under_floor:1,excluded:0}]),
  servingInventory:result([{set_id:'qa-history',corpus_version:DRAFT_RUN_CORPUS_VERSION,source_snapshot_id:null,pick_number:1,retained:3,eligible:2,under_floor:1,excluded:0}])
 });
 assert.equal(data.snapshots[0].retained_count,3);
 assert.equal(data.snapshots[0].serving_count,2);
 assert.equal(data.sets[0].active_snapshot_eligible_count,2);
 assert.equal(data.sets[0].serving_count,2);
});
