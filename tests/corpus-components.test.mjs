import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {gradeDraftRunPick,validateDraftRunPuzzle,supportSharpening,DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {TRADITIONAL_COMPONENT_VERSION as component,TRADITIONAL_PHASE2_COMPONENT_VERSION as phase2Component,FROZEN_CONTEXT_MODEL_VERSION as model,supportedComponent} from '../corpus-components.mjs';
import {componentBelongsTo,corpusMembership} from '../worker/corpus-components.mjs';
const original=JSON.parse(gunzipSync(fs.readFileSync(new URL('../corpus/draft-run/blb.json.gz',import.meta.url)))).find(p=>p.pick_number===1);
const candidate=()=>({...structuredClone(original),corpus_version:component,source_event_type:'TradDraft',model_source_event:'PremierDraft',model_version:model,event_match_wins:3,event_match_losses:0});
test('Traditional source and Premier evidence are independent; trophy match remains 100',()=>{
 const p=candidate();assert.equal(validateDraftRunPuzzle(p,component),true);assert.equal(validateDraftRunPuzzle(p),false);
 assert.equal(supportSharpening(component),supportSharpening(DRAFT_RUN_CORPUS_VERSION));
 for(const c of p.candidates){const score=gradeDraftRunPick(p,c.id).score;assert.ok(c.id===p.historical_pick_id?score===100:score>=0&&score<=95);}
 for(const patch of [{event_match_losses:1},{event_match_losses:null},{event_match_wins:2},{model_source_event:'TradDraft'},{model_version:'different'},{source_event_type:'unknown'}])assert.equal(validateDraftRunPuzzle({...p,...patch},component),false);
});
test('historical membership survives source pauses; new generation requires explicit publication',async()=>{
 assert.ok(corpusMembership({serving:true}).includes("c.status='Live'"));assert.ok(!corpusMembership().includes('status'));
 let queries=0;const query=async()=>{queries++;return {rows:[{}]};};
 assert.equal(await componentBelongsTo(query,original,DRAFT_RUN_CORPUS_VERSION),true);assert.equal(queries,0);
 assert.equal(await componentBelongsTo(query,candidate(),DRAFT_RUN_CORPUS_VERSION),true);assert.equal(queries,1);
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
test('loader rejects changed parent evidence before any component mutation',async()=>{
 let reads=0;const query=async sql=>{assert.match(sql,/^SELECT/);reads++;return {rows:[{m:{model_version:'old'}}]};};
 await assert.rejects(()=>importComponents(query,[{sid:'blb',health:{ready:true},manifest:{frozen_input_signature:'expected'}}]),/Parent model evidence/);
 assert.equal(reads,1);
});

import {CUBE_TRADITIONAL_COMPONENT_VERSION as cubeComponent} from '../corpus-components.mjs';
test('Cube source admission ends at P7 while Premier retains P2–P9',()=>{
 const cube=JSON.parse(gunzipSync(fs.readFileSync(new URL('../corpus/draft-run/powered-cube.json.gz',import.meta.url))));
 for(const p of cube.filter(p=>p.pick_number<=9)) {
  assert.equal(validateDraftRunPuzzle(p),true);
  const trad={...p,corpus_version:cubeComponent,source_event_type:'TradDraft',model_source_event:'PremierDraft',model_version:model,event_match_wins:3,event_match_losses:0};
  assert.equal(validateDraftRunPuzzle(trad,cubeComponent),p.pick_number<=7);
  assert.equal(supportSharpening(cubeComponent),supportSharpening(DRAFT_RUN_CORPUS_VERSION));
 }
});
