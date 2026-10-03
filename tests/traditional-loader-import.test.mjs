import test from 'node:test';
import assert from 'node:assert/strict';
import {importComponents} from '../scripts/load-traditional-components.mjs';
import {TRADITIONAL_V5_PHASE2_COMPONENT_VERSION} from '../corpus-components.mjs';

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
