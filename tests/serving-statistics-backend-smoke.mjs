// Re-analyze only an isolated CI branch. Selection reads do not reserve runs.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {refreshServingStatistics,verifyServingStatistics} from '../worker/serving-statistics.mjs';
import {selectDatabaseRun} from '../worker/draft-run-selection.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {SERVING_QUALITY_SQL,MINIMUM_TROPHY_SUPPORT_RATIO} from '../serving-quality.mjs';
if(!process.argv.includes('--dev-fixtures'))throw Error('An isolated development branch is required.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query}=await import('../worker/growth-function.js');
await verifyServingStatistics(query);
// Validate the algebraic/indexable floor against every stored rating and the
// adjacent representable float64 values at its only inclusion boundary.
assert.equal(Number((await query(`SELECT count(*)::int mismatches FROM draft_run_puzzle_ratings r WHERE (${SERVING_QUALITY_SQL}) IS DISTINCT FROM (floor(95*r.target_support_ratio::text::float8+0.5)>=20)`)).rows[0].mismatches),0);
const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,MINIMUM_TROPHY_SUPPORT_RATIO);const bits=view.getBigUint64(0),ratios=[];
for(let offset=-4n;offset<=4n;offset++){view.setBigUint64(0,bits+offset);ratios.push(view.getFloat64(0));}
const edge=(await query(`SELECT r.target_support_ratio,(${SERVING_QUALITY_SQL}) eligible FROM (VALUES ${ratios.map((_,i)=>`($${i+1}::float8)`).join(',')}) r(target_support_ratio)`,ratios)).rows;
for(const row of edge)assert.equal([true,'t'].includes(row.eligible),Math.round(95*Number(row.target_support_ratio))>=20);
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
