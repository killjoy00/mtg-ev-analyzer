import assert from 'node:assert/strict';
import {corpusDatabase} from '../scripts/neon-corpus-db.mjs';
import {stageCorpusManifest} from '../scripts/stage-corpus-manifest.mjs';
if(!process.argv.includes('--dev-fixtures'))throw Error('Disposable branch required');
const query=corpusDatabase(process.argv[2]);
const set='hob',version='qa-staging-'+crypto.randomUUID();
const before=(await query('SELECT corpus_version,manifest FROM draft_run_verified_sets WHERE set_id=$1',[set])).rows[0];
assert.ok(before);
try {
  await stageCorpusManifest(query,set,version,{model_version:'qa-newer',test:true},{preserveServing:true});
  await stageCorpusManifest(query,set,version,{supplement:true},{preserveServing:true});
  assert.deepEqual((await query('SELECT corpus_version,manifest FROM draft_run_verified_sets WHERE set_id=$1',[set])).rows[0],before,'Staging must not hide the corpus used by the older API');
  const staged=(await query('SELECT manifest FROM corpus_set_versions WHERE set_id=$1 AND corpus_version=$2',[set,version])).rows[0];
  const manifest=typeof staged.manifest==='string'?JSON.parse(staged.manifest):staged.manifest;
  assert.equal(manifest.model_version,'qa-newer');assert.equal(manifest.supplement,true);
  console.log('New version staged and resumed without changing the old serving manifest.');
} finally { await query('DELETE FROM corpus_set_versions WHERE set_id=$1 AND corpus_version=$2',[set,version]); }
