import test from 'node:test';import assert from 'node:assert/strict';
import {handlePlayerReports} from '../worker/admin-player-reports.mjs';
import {adminPath} from '../edge/gateway.mjs';
import fs from 'node:fs';
import manifest from '../migrations/manifest.json' with {type:'json'};
const id='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
const path='/v1/admin/player-reports/decisions/'+id+'/pick';
const req=method=>new Request('https://api.packone.pro'+path,{method});
test('pick context and mutations stay behind the explicit admin gateway',()=>{
 for(const method of ['GET','POST'])assert.equal(adminPath(path,method),true);
 for(const method of ['DELETE','PATCH'])assert.equal(adminPath(path,method),false);
 assert.equal(adminPath(path+'/other','POST'),false);
 assert.equal(adminPath('/v1/admin/player-reports/serving/warmup','POST'),true);
 assert.equal(adminPath('/v1/admin/player-reports/serving/warmup','GET'),false);
});
test('removal validates action, revision and reason before database access',async()=>{
 let calls=0;const q=async()=>{calls++;throw Error('Unexpected SQL');};
 for(const body of [{action:'delete',expected_revision:0,reason:'test'},{action:'remove',expected_revision:-1,reason:'test'},
  {action:'remove',expected_revision:0,reason:''},{action:'restore',expected_revision:0,reason:'x'.repeat(501)}])
  await assert.rejects(()=>handlePlayerReports(req('POST'),q,async()=>body,actor),/Choose|Enter/);
 assert.equal(calls,0);
 await assert.rejects(()=>handlePlayerReports(req('GET'),q,async()=>({}),null),/Administrator/);
});
test('conflicting moderation is an actionable 409 and never declares a commit',async()=>{
 const q=async()=>{throw Object.assign(Error('db conflict'),{pgCode:'40001'});};
 await assert.rejects(()=>handlePlayerReports(req('POST'),q,async()=>({action:'remove',expected_revision:1,reason:'Forced decision'}),actor),e=>e.status===409);
});
test('lost readiness verification does not hide an already committed moderation',async()=>{
 let calls=0;const q=async(sql,values)=>{calls++;
  if(sql.includes('pack1_moderate_reported_pick')){assert.deepEqual(values,[id,true,0,'Forced decision',actor]);return {rows:[{result:{removed:true,revision:1,copies:2}}]};}
  throw Error('Readiness interrupted');
 };
 const result=await handlePlayerReports(req('POST'),q,async()=>({action:'remove',expected_revision:0,reason:' Forced decision '}),actor);
 assert.equal(result.moderation_committed,true);assert.equal(result.moderation.removed,true);assert.equal(result.readiness.ready,false);assert.ok(calls>1);
});
test('missing archived payload disables removal while retaining report access',async()=>{
 const result=await handlePlayerReports(req('GET'),async()=>({rows:[{puzzle_id:'archived-missing',payload:null}]}),async()=>({}),actor);
 assert.equal(result.available,false);
});
test('the serving cache and its carry-forward comparison both skip removed picks',()=>{
 const removal=/NOT EXISTS\(SELECT 1 FROM draft_run_pick_removal_members m JOIN draft_run_pick_removals q USING\(decision_key\)\s+WHERE m\.puzzle_id=p\.puzzle_id AND q\.removed\)/;
 for(const name of ['pack1_build_serving_snapshot','pack1_serving_snapshot_matches_current']) {
  const latest=manifest.ordered.map(file=>fs.readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'))
   .map(sql=>sql.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\$\\$;`))?.[0]).filter(Boolean).at(-1);
  assert.ok(latest,name);
  assert.match(latest,removal,`${name} must exclude report-removed picks`);
 }
});
