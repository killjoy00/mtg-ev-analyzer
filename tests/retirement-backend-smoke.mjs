// Run only on a disposable Neon branch. Daily plans have JSON references,
// so deleting a retired puzzle does not trigger a foreign-key error.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
if(!process.argv.includes('--dev-fixtures'))throw Error('An isolated development branch is required.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query}=await import('../worker/growth-function.js');
const migration=fs.readFileSync(new URL('../migrations/0016_retire_third_source.sql',import.meta.url),'utf8');
const repairs=migration.split('-- statement').filter(sql=>sql.includes('-- schedule-integrity-repair:'));
assert.equal(repairs.length,1,'Retirement must repair dangling Daily plans');
const puzzles=(await query(`SELECT puzzle_id,corpus_version FROM draft_run_verified_puzzles
  WHERE corpus_version=(SELECT corpus_version FROM draft_run_verified_puzzles LIMIT 1) LIMIT 8`)).rows;
assert.equal(puzzles.length,8,'A populated isolated branch is required');
const ids=puzzles.map(p=>p.puzzle_id);
const marker=`qa-retirement-${randomUUID()}`;
const goodDay='9998-01-01',badDay='9998-01-02';
try {
  // Fixed fixture dates make this independent of today's Eastern date and
  // whether today's production plan happens to include a retired source.
  for(const [day,plan] of [[goodDay,ids],[badDay,[marker,...ids.slice(1)]]]) {
    await query(`INSERT INTO draft_run_schedules(day,environment,corpus_version,puzzle_ids,selection_version)
      VALUES($1::date,'mixed',$2,$3::jsonb,$4)`,[day,puzzles[0].corpus_version,JSON.stringify(plan),marker]);
  }
  const read=async()=> (await query(`SELECT day::text,puzzle_ids,corpus_version FROM draft_run_schedules
    WHERE selection_version=$1 ORDER BY day`,[marker])).rows;
  const before=await read();
  assert.equal(before.length,2);
  await query(repairs[0]);
  assert.deepEqual(await read(),[before[0]],'Only the dangling plan should be removed');
  await query(repairs[0]);
  assert.deepEqual(await read(),[before[0]],'Retrying retirement must preserve valid plans');
  console.log(JSON.stringify({retirement:'ready',danglingPlanRemoved:true,validPlanPreserved:true,retrySafe:true}));
} finally {
  await query('DELETE FROM draft_run_schedules WHERE selection_version=$1',[marker]);
}
