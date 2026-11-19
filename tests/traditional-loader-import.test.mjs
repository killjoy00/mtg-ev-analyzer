import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import modelVersions from '../model-versions.json' with {type:'json'};
import {importComponents,sourceQuality} from '../scripts/load-traditional-components.mjs';
import {TRADITIONAL_V5_PHASE2_COMPONENT_VERSION,TRADITIONAL_V4_PHASE2_COMPONENT_VERSION,V4_CONTEXT_MODEL_VERSION} from '../corpus-components.mjs';

test('historical v4 admission remains pinned to v8 when the current release is v9',()=>{
 const original=JSON.parse(fs.readFileSync(new URL('../results/rebuild-2026-09-18/traditional-puzzle-report.json',import.meta.url)));
 const evidence={...original.sets.blb,v8_parity_picks:original.sets.blb.parity_picks};
 delete evidence.parity_picks;
 const report={schema:1,corrected:{component_version:TRADITIONAL_V4_PHASE2_COMPONENT_VERSION,
  parent_corpus:modelVersions.v4.corpus_version,model:V4_CONTEXT_MODEL_VERSION},
  format_training_audit:{valid_despite_issue_164:true},sets:{blb:evidence}};
 const n=evidence.quality.usable_traditional_puzzles;
 const metrics={puzzles:n,usable:n,metadataComplete:n,imagesComplete:n};
 assert.equal(sourceQuality(report,'blb',metrics).ready,true);
 assert.equal(sourceQuality({...report,corrected:{...report.corrected,parent_corpus:modelVersions.v5.corpus_version}},'blb',metrics).ready,false);
});

test('Traditional importer records a blocked component without creating a Candidate',async()=>{
 const writes=[];
 const query=async(sql,params=[])=>{
  if(sql.startsWith('INSERT INTO corpus_sources')){writes.push({sql,params});return {rows:[]};}
  if(sql.startsWith('ANALYZE '))return {rows:[]};
  if(sql.startsWith('SELECT (SELECT count(*)='))return {rows:[{draft_run_verified_puzzles:true,draft_run_puzzle_ratings:true}]};
  throw Error('Unexpected import mutation: '+sql);
 };
 const blocked={sid:'blb',health:{ready:false,gates:{quality:false}},manifest:{
  component_version:TRADITIONAL_V5_PHASE2_COMPONENT_VERSION,
  source_archive:{url:'https://17lands-public.s3.amazonaws.com/analysis_data/draft_data/draft_data_public.BLB.TradDraft.csv.gz'}
 }};
 await importComponents(query,[blocked]);
 assert.equal(writes.length,1);
 assert.equal(writes[0].params[0],'blb');
 assert.match(writes[0].params[2],/quality/);
 await assert.rejects(importComponents(query,[{...blocked,manifest:{...blocked.manifest,component_version:'unknown'}}]),/Unsupported component identity/);
 assert.equal(writes.length,1,'Unsupported identity must not mutate source or Candidate state');
});
