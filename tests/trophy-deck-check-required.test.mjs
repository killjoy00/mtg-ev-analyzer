import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {trophyDeckCoverage} from '../worker/trophy-decks.mjs';
import {checkTrophyDecks,sourcePuzzleCounts} from '../scripts/trophy-deck-coverage.mjs';

const root=new URL('..',import.meta.url).pathname;
// Builds the CI fixture database only; it never adds puzzles to a real corpus.
const FIXTURE_ONLY=new Set(['scripts/prepare-test-database.mjs']);
function sources(dir) {
  return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(entry=>{
    const relative=path.join(dir,entry.name);
    if(entry.isDirectory())return sources(relative);
    return /\.(mjs|js)$/.test(entry.name)?[relative]:[];
  });
}
const code=[...sources('scripts'),...sources('worker')].map(file=>({file,text:fs.readFileSync(path.join(root,file),'utf8')}));

test('every puzzle import path checks trophy decklists before it writes',()=>{
  const importers=code.filter(({file,text})=>file!=='worker/trophy-import.mjs'&&/\binsertTrophyBatch\(/.test(text));
  assert.ok(importers.length>=3,'expected the reviewed import paths');
  for(const {file,text} of importers) {
    if(FIXTURE_ONLY.has(file))continue;
    assert.match(text,/\bcheckTrophyDecks\(/,`${file} adds puzzles without checking trophy decklists`);
  }
});

test('puzzles are only inserted through the checked import function',()=>{
  for(const {file,text} of code) {
    if(file==='worker/trophy-import.mjs')continue;
    assert.doesNotMatch(text,/INSERT\s+INTO\s+draft_run_verified_puzzles\b/i,`${file} inserts puzzles directly`);
  }
});

test('coverage counts decks through the serving catalog and never requires them',async()=>{
  const {encoded}=await import('../corpus/trophy-decks/fra.mjs');
  const known=Object.keys(JSON.parse(brotliDecompressSync(Buffer.from(encoded,'base64'))).sources)[0];
  const coverage=await trophyDeckCoverage('fra',new Map([[known,6],['0'.repeat(32),2]]));
  assert.deepEqual(coverage,{set:'fra',catalog:true,sources:2,sources_with_deck:1,puzzles:8,puzzles_with_deck:6});
  assert.deepEqual(await trophyDeckCoverage('not-a-catalog',new Map([['0'.repeat(32),3]])),
    {set:'not-a-catalog',catalog:false,sources:1,sources_with_deck:0,puzzles:3,puzzles_with_deck:0});
  assert.deepEqual([...sourcePuzzleCounts([{source_draft_hash:'a'},{source_draft_hash:'a'},{source_draft_hash:'b'}])],[['a',2],['b',1]]);
});

test('the check reports counts to the run summary without source identifiers',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'trophy-decks-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const summary=path.join(dir,'summary.md'),previous=process.env.GITHUB_STEP_SUMMARY;
  process.env.GITHUB_STEP_SUMMARY=summary;
  const errors=[],original=console.error;console.error=line=>errors.push(line);
  try {
    const hidden='f'.repeat(32);
    const coverage=await checkTrophyDecks('not-a-catalog',new Map([[hidden,4]]),'example-component');
    assert.equal(coverage.puzzles_with_deck,0);
    const text=fs.readFileSync(summary,'utf8');
    assert.equal(text,'- Trophy decklists, example-component: 0/4 puzzles from 0/1 source drafts (no catalog for this set)\n');
    assert.ok(!text.includes(hidden)&&!errors.join('').includes(hidden));
  } finally {
    console.error=original;
    if(previous===undefined)delete process.env.GITHUB_STEP_SUMMARY;else process.env.GITHUB_STEP_SUMMARY=previous;
  }
});
