import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {gradeDraftRunPick,validateDraftRunPuzzle,supportSharpening,DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {
 TRADITIONAL_COMPONENT_VERSION as component,
 TRADITIONAL_PHASE2_COMPONENT_VERSION as phase2Component,
 TRADITIONAL_V4_PHASE2_COMPONENT_VERSION as v4Component,
 CUBE_TRADITIONAL_COMPONENT_VERSION as cubeComponent,
 CUBE_TRADITIONAL_V4_COMPONENT_VERSION as v4CubeComponent,
 FROZEN_CONTEXT_MODEL_VERSION as model,
 V4_CONTEXT_MODEL_VERSION as v4Model,
 modelVersionForComponent,
 supportedComponent
} from '../corpus-components.mjs';
import {componentBelongsTo,corpusMembership} from '../worker/corpus-components.mjs';
const original=JSON.parse(gunzipSync(fs.readFileSync(new URL('../corpus/draft-run/blb.json.gz',import.meta.url)))).find(p=>p.pick_number===1);
const candidate=()=>({...structuredClone(original),corpus_version:component,source_event_type:'TradDraft',model_source_event:'PremierDraft',model_version:model,event_match_wins:3,event_match_losses:0});
const v4Candidate=()=>({...structuredClone(original),corpus_version:v4Component,parent_corpus_version:DRAFT_RUN_CORPUS_VERSION,source_event_type:'TradDraft',model_source_event:'PremierDraft',model_version:v4Model,event_match_wins:3,event_match_losses:0});

test('Traditional source revisions map to exactly one grader version',()=>{
 assert.equal(modelVersionForComponent(component),model);
 assert.equal(modelVersionForComponent(phase2Component),model);
 assert.equal(modelVersionForComponent(cubeComponent),model);
 assert.equal(modelVersionForComponent(v4Component),v4Model);
 assert.equal(modelVersionForComponent(v4CubeComponent),v4Model);
 assert.equal(modelVersionForComponent('arbitrary'),null);
 for(const version of [component,phase2Component,cubeComponent,v4Component,v4CubeComponent])assert.equal(supportedComponent(version),true);
});

test('Traditional source and Premier evidence are independent; trophy match remains 100',()=>{
 for(const [p,version] of [[candidate(),component],[v4Candidate(),v4Component]]) {
  assert.equal(validateDraftRunPuzzle(p,version),true);assert.equal(validateDraftRunPuzzle(p),false);
  assert.equal(supportSharpening(version),supportSharpening(DRAFT_RUN_CORPUS_VERSION));
  for(const c of p.candidates){const score=gradeDraftRunPick(p,c.id).score;assert.ok(c.id===p.historical_pick_id?score===100:score>=0&&score<=95);}
  for(const patch of [{event_match_losses:1},{event_match_losses:null},{event_match_wins:2},{model_source_event:'TradDraft'},{model_version:'different'},{source_event_type:'unknown'}])assert.equal(validateDraftRunPuzzle({...p,...patch},version),false);
 }
 assert.equal(validateDraftRunPuzzle({...v4Candidate(),model_version:model},v4Component),false);
 assert.equal(validateDraftRunPuzzle({...candidate(),model_version:v4Model},component),false);
});

test('historical membership survives source pauses; new generation requires explicit publication',async()=>{
 const serving=corpusMembership({serving:true});
 assert.ok(serving.includes("c.status='Live'"));
 assert.ok(serving.includes('active_snapshot_id=p.source_snapshot_id'));
 assert.ok(serving.includes('p.corpus_version<>$1'));
 assert.ok(serving.includes('c.parent_version=$1'));
 assert.ok(!corpusMembership().includes('active_snapshot_id'));
 let queries=0;const query=async()=>{queries++;return {rows:[{}]};};
 assert.equal(await componentBelongsTo(query,original,DRAFT_RUN_CORPUS_VERSION),true);assert.equal(queries,0);
 assert.equal(await componentBelongsTo(query,candidate(),DRAFT_RUN_CORPUS_VERSION),true);assert.equal(queries,1);
 assert.equal(await componentBelongsTo(query,v4Candidate(),DRAFT_RUN_CORPUS_VERSION),true);assert.equal(queries,2);
 assert.equal(await componentBelongsTo(query,{...v4Candidate(),model_version:model},DRAFT_RUN_CORPUS_VERSION),false);assert.equal(queries,2);
 assert.equal(await componentBelongsTo(query,{...candidate(),corpus_version:'arbitrary'},DRAFT_RUN_CORPUS_VERSION),false);
});

import {sourceQuality,importComponents} from '../scripts/load-traditional-components.mjs';
const report=JSON.parse(fs.readFileSync(new URL('../results/rebuild-2026-09-18/traditional-puzzle-report.json',import.meta.url)));
test('frozen inventory evidence clears only three sets; incomplete assets block publication',()=>{
 for(const [sid,s] of Object.entries(report.sets)) {
  const n=s.quality.usable_traditional_puzzles,metrics={puzzles:n,usable:n,metadataComplete:n,imagesComplete:n};
  assert.equal(sourceQuality(report,sid,metrics).ready,sid!=='hob');
  assert.equal(sourceQuality(report,sid,{...metrics,imagesComplete:n-1}).ready,false);
  assert.equal(sourceQuality(report,sid,{...metrics,puzzles:n-8}).ready,false);
  if(sid==='blb'){const phase2Report=structuredClone(report);phase2Report.expansion_supported=false;phase2Report.automatic_expansion_supported=true;assert.equal(sourceQuality(phase2Report,sid,metrics).ready,true);}
 }
});

test('v4 revalidation evidence uses v8 parity and issue-164-safe expansion proof',()=>{
 const evidence=structuredClone(report.sets.blb);
 evidence.v8_parity_picks=evidence.parity_picks;delete evidence.parity_picks;
 const n=evidence.quality.usable_traditional_puzzles,metrics={puzzles:n,usable:n,metadataComplete:n,imagesComplete:n};
 const v4Report={
  ...structuredClone(report),
  schema:1,
  production_changed:false,
  publication_authorized:false,
  corrected:{component_version:v4Component,parent_corpus:DRAFT_RUN_CORPUS_VERSION,model:v4Model},
  format_training_audit:{valid_despite_issue_164:true},
  persistent_category_patterns:[],
  residuals:{persistent_category_patterns:[]}
 };
 assert.equal(sourceQuality(v4Report,'blb',metrics,evidence).ready,true);
});

test('loader rejects changed parent evidence before any component mutation',async()=>{
 let reads=0;const query=async sql=>{assert.match(sql,/^SELECT/);reads++;return {rows:[{m:{model_version:'old'}}]};};
 await assert.rejects(()=>importComponents(query,[{sid:'blb',health:{ready:true},manifest:{component_version:v4Component,model_input_signature:'expected'}}]),/Parent model evidence/);
 assert.equal(reads,1);
});

test('Cube source admission ends at P7 while Premier retains P2-P9',()=>{
 const cube=JSON.parse(gunzipSync(fs.readFileSync(new URL('../corpus/draft-run/powered-cube.json.gz',import.meta.url))));
 for(const p of cube.filter(p=>p.pick_number<=9)) {
  assert.equal(validateDraftRunPuzzle(p),true);
  for(const [version,versionModel] of [[cubeComponent,model],[v4CubeComponent,v4Model]]) {
   const trad={...p,corpus_version:version,parent_corpus_version:DRAFT_RUN_CORPUS_VERSION,source_event_type:'TradDraft',model_source_event:'PremierDraft',model_version:versionModel,event_match_wins:3,event_match_losses:0};
   assert.equal(validateDraftRunPuzzle(trad,version),p.pick_number<=7);
   assert.equal(supportSharpening(version),supportSharpening(DRAFT_RUN_CORPUS_VERSION));
  }
 }
});
