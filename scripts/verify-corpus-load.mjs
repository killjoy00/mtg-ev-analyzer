// Verify the staged version directly, independently of the live API version.
// Usage: node scripts/verify-corpus-load.mjs CONNECTION_FILE IMPORT_DIR [--complete]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';
import {corpusDatabase} from './neon-corpus-db.mjs';

const query=corpusDatabase(process.argv[2]);
const baseline=JSON.parse(fs.readFileSync('corpus/draft-run/catalog.json','utf8'));
const imported=JSON.parse(fs.readFileSync(path.join(process.argv[3],'catalog.json'),'utf8'));
assert.equal(baseline.corpus_version,DRAFT_RUN_CORPUS_VERSION);
assert.equal(imported.corpus_version,DRAFT_RUN_CORPUS_VERSION);
assert.equal(imported.complete,true);
assert.deepEqual(imported.errors,{});
const bySet=new Map(imported.sets.map(s=>[s.id,s]));
if(process.argv.includes('--complete')) {
  // Discovery maps the official Cube_-_Powered archive to powered-cube.
  assert.deepEqual([...bySet.keys()].sort(),baseline.sets.map(s=>s.id).sort(),'Every environment, including Cube, must finish before release');
}
const result=await query(`SELECT p.set_id,count(*)::int puzzles,
  count(*) FILTER(WHERE r.puzzle_id IS NULL)::int unrated,
  count(*) FILTER(WHERE p.payload->>'corpus_version' IS DISTINCT FROM p.corpus_version)::int wrong_version
  FROM draft_run_verified_puzzles p LEFT JOIN draft_run_puzzle_ratings r
    ON r.puzzle_id=p.puzzle_id AND r.difficulty_version=$2
  WHERE p.corpus_version=$1 GROUP BY p.set_id`,[DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_DIFFICULTY_VERSION]);
const manifests=await query('SELECT set_id,corpus_version,manifest FROM draft_run_verified_sets');
assert.deepEqual(result.rows.map(s=>s.set_id).sort(),baseline.sets.map(s=>s.id).sort(),'Staged coverage must match the registered environments');
let total=0;
for(const set of baseline.sets) {
  const rows=result.rows.find(r=>r.set_id===set.id),supplement=bySet.get(set.id);
  const stored=manifests.rows.find(r=>r.set_id===set.id);
  const manifest=typeof stored?.manifest==='string'?JSON.parse(stored.manifest):stored?.manifest;
  assert.equal(stored?.corpus_version,DRAFT_RUN_CORPUS_VERSION,`${set.id}: manifest version`);
  assert.equal(manifest.model_version,baseline.model_version,`${set.id}: baseline model`);
  assert.equal(manifest.sha256,set.sha256,`${set.id}: baseline checksum`);
  assert.equal(Number(rows.unrated),0,`${set.id}: unrated puzzles`);
  assert.equal(Number(rows.wrong_version),0,`${set.id}: mismatched payload versions`);
  if(supplement) {
    assert.equal(supplement.model_version,baseline.model_version,`${set.id}: supplement model`);
    assert.equal(manifest.full_import?.input_signature,supplement.input_signature,`${set.id}: import input signature`);
    assert.equal(manifest.full_import?.puzzle_file_sha256,supplement.puzzle_file_sha256,`${set.id}: supplement checksum`);
    assert.equal(Number(rows.puzzles),supplement.total_puzzles,`${set.id}: full puzzle count`);
  } else assert.ok(Number(rows.puzzles)>=set.puzzles,`${set.id}: missing baseline puzzles`);
  total+=Number(rows.puzzles);
}
console.log(JSON.stringify({verified:true,corpus_version:DRAFT_RUN_CORPUS_VERSION,model_version:baseline.model_version,sets:result.rows.length,puzzles:total,full_import_sets:bySet.size,complete:process.argv.includes('--complete')}));
