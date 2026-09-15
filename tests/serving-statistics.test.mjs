import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SERVING_ANALYZE_SQL,SERVING_STATISTICS_COLUMNS,SERVING_STATISTICS_READY_SQL,refreshServingStatistics,verifyServingStatistics} from '../worker/serving-statistics.mjs';

const ready=Object.fromEntries(Object.keys(SERVING_STATISTICS_COLUMNS).map(table=>[table,true]));
test('the repeatable statistics migration matches fixed metadata-only import maintenance',()=>{
  const sql=fs.readFileSync(new URL('../migrations/0015_draft_run_serving_statistics.sql',import.meta.url),'utf8');
  const statements=sql.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean);
  assert.deepEqual(statements,SERVING_ANALYZE_SQL);
  assert.match(statements[0],/pack_number/);
  assert.ok(statements.every(sql=>sql.startsWith('ANALYZE public.')&&!sql.includes('payload')));
});

test('statistics refresh runs once per table, verifies readiness, and propagates failure',async()=>{
  const calls=[];
  const query=async sql=>{calls.push(sql);return {rows:[ready]};};
  assert.deepEqual(await refreshServingStatistics(query),{analyzed_tables:Object.keys(ready)});
  assert.deepEqual(calls,[...SERVING_ANALYZE_SQL,SERVING_STATISTICS_READY_SQL]);
  let count=0;
  await assert.rejects(refreshServingStatistics(async()=>{count++;throw Error('maintenance failed');}),/maintenance failed/);
  assert.equal(count,1);
});

test('deployment readiness fails closed when any serving table lacks metadata statistics',async()=>{
  for(const table of Object.keys(ready)) {
    for(const missing of [false,'f',undefined])await assert.rejects(
      verifyServingStatistics(async()=>({rows:[{...ready,[table]:missing}]})),/Missing serving statistics/);
  }
  await assert.rejects(verifyServingStatistics(async()=>({rows:[]})),/Missing serving statistics/);
  await verifyServingStatistics(async()=>({rows:[ready]}));
  await verifyServingStatistics(async()=>({rows:[Object.fromEntries(Object.keys(ready).map(table=>[table,'t']))]}));
});
