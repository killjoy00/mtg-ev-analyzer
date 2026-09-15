// Re-analyze only an isolated CI branch. Selection reads do not reserve runs.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {refreshServingStatistics,verifyServingStatistics} from '../worker/serving-statistics.mjs';
import {selectDatabaseRun} from '../worker/draft-run-selection.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
if(!process.argv.includes('--dev-fixtures'))throw Error('An isolated development branch is required.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query}=await import('../worker/growth-function.js');
await verifyServingStatistics(query);
const results=[];
const sample=async()=>{
  const runs=[];
  for(const environment of ['mixed','powered-cube']) {
    const start=performance.now();
    const run=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,'serving-statistics-parity',environment,{daily:true,day:'2026-09-15'});
    results.push({environment,ms:Math.round(performance.now()-start)});
    assert.equal(run.length,8);
    runs.push(run.map(p=>p.puzzle_id));
  }
  return runs;
};
const before=await sample();
await refreshServingStatistics(query);
assert.deepEqual(await sample(),before,'Repeated metadata ANALYZE must preserve exact deterministic mixed/Cube draws');
console.log(JSON.stringify({statistics:'ready',repeatAnalyzeSelectionParity:true,timings:results}));
