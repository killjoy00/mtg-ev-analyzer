import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {loadActivatedEnvironment,assertFromActiveSnapshot,runActivatedSnapshotSmoke,loadRecentActivations,runRecentActivationSmokes} from '../scripts/activated-snapshot-smoke.mjs';

const ACTIVE='a'.repeat(64);
const environment=row=>async()=>({rows:row?[row]:[]});
const live={set_id:'fra',status:'Live',regular_run:true,release_date:'2026-10-02',active_snapshot_id:ACTIVE,schema_version:'premier-modern-skill-buckets-v1',lifecycle_status:'Approved'};

test('a missing or unactivated environment fails clearly instead of passing',async()=>{
 await assert.rejects(loadActivatedEnvironment(environment(null),'fra'),/fra has no serving environment/);
 await assert.rejects(loadActivatedEnvironment(environment({...live,status:'Candidate'}),'fra'),/is Candidate, not Live/);
 await assert.rejects(loadActivatedEnvironment(environment({...live,active_snapshot_id:null}),'fra'),/has no active_snapshot_id/);
 await assert.rejects(loadActivatedEnvironment(environment({...live,schema_version:null}),'fra'),/does not exist/);
 await assert.rejects(loadActivatedEnvironment(environment(live),'fra','b'.repeat(64)),/not the expected/);
 await assert.rejects(runActivatedSnapshotSmoke(environment(null),{}),/--set is required/);
});

test('first-class snapshots expect their own ID on puzzles; historical ones expect NULL',async()=>{
 const current=await loadActivatedEnvironment(environment(live),'fra',ACTIVE);
 assert.equal(current.puzzle_snapshot_id,ACTIVE);
 assert.equal(current.historical,false);
 const historical=await loadActivatedEnvironment(environment({...live,set_id:'hob',active_snapshot_id:'historical-'+'c'.repeat(32),schema_version:'historical-frozen'}),'hob');
 assert.equal(historical.puzzle_snapshot_id,null);
 assert.equal(historical.historical,true);
});

test('selected decisions must come from the active snapshot of the same set',async()=>{
 const env=await loadActivatedEnvironment(environment(live),'fra');
 const rows=list=>new Map(list.map(row=>[row.puzzle_id,row]));
 const premier=(id,extra={})=>({puzzle_id:id,set_id:'fra',corpus_version:DRAFT_RUN_CORPUS_VERSION,source_snapshot_id:ACTIVE,...extra});
 assert.equal(assertFromActiveSnapshot(env,[{puzzle_id:'1'},{puzzle_id:'2'}],rows([premier('1'),premier('2')]),'practice'),2);
 assert.throws(()=>assertFromActiveSnapshot(env,[{puzzle_id:'1'}],rows([premier('1',{source_snapshot_id:'b'.repeat(64)})]),'practice'),/not the active/);
 assert.throws(()=>assertFromActiveSnapshot(env,[{puzzle_id:'1'}],rows([premier('1',{set_id:'hob'})]),'practice'),/is from hob/);
 assert.throws(()=>assertFromActiveSnapshot(env,[{puzzle_id:'1'}],rows([]),'practice'),/not a stored puzzle/);
 assert.throws(()=>assertFromActiveSnapshot(env,[],rows([]),'practice'),/nothing was selected/);
 // A Live Traditional component may share the draw, but it cannot stand in for the snapshot.
 const component=premier('3',{corpus_version:'traditional-premier-v4-phase2-v1',source_snapshot_id:null});
 assert.equal(assertFromActiveSnapshot(env,[{puzzle_id:'1'},{puzzle_id:'3'}],rows([premier('1'),component]),'practice'),1);
 assert.throws(()=>assertFromActiveSnapshot(env,[{puzzle_id:'3'}],rows([component]),'practice'),/active snapshot was not exercised/);
});

test('the smoke drives the production selectors and never writes sessions or schedules',()=>{
 const script=fs.readFileSync(new URL('../scripts/activated-snapshot-smoke.mjs',import.meta.url),'utf8');
 for(const selector of ['loadServingSnapshot','customSetsFromSnapshot','selectCachedDatabaseRun','selectDatabaseReroll','selectDatabaseRun','loadLiveSetMetadata'])
  assert.match(script,new RegExp(selector+'\\('),selector);
 assert.match(script,/'latest',\{daily:true,day\}/);
 assert.match(script,/'mixed',\{daily:true,day\}/);
 assert.doesNotMatch(script,/INSERT INTO|UPDATE |DELETE FROM|draft_run_sessions|draft_run_schedules|ensureDailySchedule/);
});

test('recent activations are Live status events for currently Live environments',async()=>{
 let sql,params;
 const rows=await loadRecentActivations(async(statement,values)=>{sql=statement;params=values;return {rows:[]};},26);
 assert.deepEqual(rows,[]);
 assert.match(sql,/e\.component_version IS NULL AND e\.new_status='Live' AND p\.status='Live'/);
 assert.match(sql,/make_interval\(hours=>\$1::int\)/);
 assert.doesNotMatch(sql,/draft_run_verified_puzzles|payload|INSERT|UPDATE|DELETE/);
 assert.deepEqual(params,[26]);
 for(const hours of [0,-1,NaN,24*14+1])await assert.rejects(loadRecentActivations(async()=>({rows:[]}),hours),/--recent must be/);
});

test('no recent activation reads nothing else; a failed smoke fails the run',async()=>{
 const logs=[];
 let calls=0;
 assert.deepEqual(await runRecentActivationSmokes(async()=>{calls++;return {rows:[]};},{hours:26,log:line=>logs.push(line)}),[]);
 assert.equal(calls,1);
 assert.match(logs[0],/"activations":0/);
 // The activated environment disappeared before its smoke ran: report and fail.
 const query=async sql=>sql.includes('corpus_status_events')?{rows:[{set_id:'fra',active_snapshot_id:ACTIVE}]}:{rows:[]};
 await assert.rejects(runRecentActivationSmokes(query,{hours:26,log:()=>{}}),/1 of 1 recent activations failed: fra: .*has no serving environment/);
});

test('the activation smoke workflow checks recent activations daily and single sets on demand',()=>{
 const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-activation-smoke.yml',import.meta.url),'utf8');
 assert.match(workflow,/schedule:\s+- cron: '47 9 \* \* \*'/);
 assert.match(workflow,/TARGETS: \$\{\{ inputs\.target \|\| 'development production' \}\}/);
 assert.match(workflow,/default: development/);
 assert.match(workflow,/--recent 26/);
 assert.match(workflow,/\[\[ -z "\$SET_ID" \|\| "\$SET_ID" =~ \^\[a-z0-9-\]\{2,40\}\$ \]\]/);
 assert.match(workflow,/node scripts\/activated-snapshot-smoke\.mjs "\$RUNNER_TEMP\/activation-smoke\.connection" --set "\$SET_ID"/);
 for(const input of ['set_id','snapshot_id'])
  assert.deepEqual(workflow.match(new RegExp('\\$\\{\\{ inputs\\.'+input+' \\}\\}','g')),['${{ inputs.'+input+' }}'],input);
});

test('single-set practice is required for a new snapshot but optional for historical history',async()=>{
 // Minimal database: the environment row, an empty serving cache snapshot with
 // this set's inventory present, and no Live regular sets for Daily planning.
 const database=environmentRow=>async sql=>{
  if(sql.includes('FROM draft_run_environment_policy p')&&sql.includes('LEFT JOIN corpus_source_snapshots'))return {rows:[environmentRow]};
  if(sql.includes('pack1_serving_snapshot'))return {rows:[{snapshot:{id:1,revision:1,metadata:[],groups:[]}}]};
  if(sql.includes('draft_run_serving_inventory'))return {rows:[{total:10,other_snapshot:0}]};
  if(sql.includes("p.status='Live' ORDER BY p.set_id"))return {rows:[]};
  throw Error('Unexpected SQL in smoke branch test: '+sql.slice(0,80));
 };
 const historical={...live,set_id:'ktk',active_snapshot_id:'historical-'+'d'.repeat(32),schema_version:'historical-frozen'};
 const result=await runActivatedSnapshotSmoke(database(historical),{setId:'ktk',day:'2026-10-20',log:()=>{}});
 assert.equal(result.checks.practice.applicable,false);
 assert.equal(result.checks.reroll.applicable,false);
 assert.equal(result.checks.daily.applicable,false);
 await assert.rejects(runActivatedSnapshotSmoke(database(live),{setId:'fra',day:'2026-10-20',log:()=>{}}),/fra: not offered for single-set practice/);
});
