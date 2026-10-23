// Runs ONLY after the disposable local PostgreSQL fixture was created.
// The serving-cache builder and its carry-forward comparison must apply the
// same membership filters. 0064 filtered report-removed picks only in the
// builder, so after a removal no verified cache could carry to a new revision.
import assert from 'node:assert/strict';
import {fixturePool} from './support/postgres-fixture.mjs';

const pool=fixturePool(),client=await pool.connect();
const query=(text,values=[])=>client.query(text,values);
const KEY=['elite-trophy-colour-stage-v9','support-ratio-v1','trophy-implied-score-20-v1'];
const build=async()=>(await query('SELECT pack1_build_serving_snapshot($1,$2,$3)->>\'id\' id',KEY)).rows[0].id;
const matches=async snapshot=>(await query('SELECT pack1_serving_snapshot_matches_current($1,$2,$3,$4::bigint) ok',[...KEY,snapshot])).rows[0].ok;
let tests=0;
const check=(ok,message)=>{assert.ok(ok,message);tests++;};
try {
  await query('BEGIN');
  const before=await build();
  check(before&&await matches(before),'A freshly built cache matches current serving inputs');
  const victim=(await query('SELECT puzzle_id FROM draft_run_serving_inventory WHERE snapshot_id=$1::bigint ORDER BY puzzle_id LIMIT 1',[before])).rows[0]?.puzzle_id;
  check(victim,'The fixture cache holds at least one decision');

  await query(`INSERT INTO draft_run_pick_removals(decision_key,set_id,pick_number,removed,revision,reason,actor_id)
    SELECT repeat('ab',32),set_id,pick_number,true,1,'serving carry fixture','22222222-2222-4222-8222-222222222222'
    FROM draft_run_verified_puzzles WHERE puzzle_id=$1`,[victim]);
  await query('INSERT INTO draft_run_pick_removal_members(puzzle_id,decision_key) VALUES($1,repeat(\'ab\',32))',[victim]);
  await query('UPDATE draft_run_serving_revision SET revision=revision+1 WHERE singleton');

  const after=await build();
  check(after!==before,'A new serving revision builds a new cache');
  check(!(await query('SELECT 1 FROM draft_run_serving_inventory WHERE snapshot_id=$1::bigint AND puzzle_id=$2',[after,victim])).rows.length,
    'The builder excludes the removed decision');
  check(await matches(after)===true,'The rebuilt cache matches current inputs, so it can carry to the next revision');
  check(await matches(before)===false,'The cache that still holds the removed decision is not carried');

  console.log('PASS: '+tests+' real PostgreSQL serving-cache carry-forward assertions with a report-removed decision.');
} finally {
  await query('ROLLBACK').catch(()=>{});
  client.release();
  await pool.end();
}
