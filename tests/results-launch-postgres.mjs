// Real disposable local PostgreSQL; no production connection or sending.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixturePool} from './support/postgres-fixture.mjs';
const pool=fixturePool(),client=await pool.connect();
const sql=fs.readFileSync('migrations/0075_results_privacy_launch.sql','utf8');
const q=(...args)=>client.query(...args);
try{
 await q('BEGIN');
 await q('UPDATE results_launch SET launch_at=NULL WHERE singleton');
 await q(sql);
 const first=(await q('SELECT launch_at,launch_at>=transaction_timestamp() AND launch_at<=clock_timestamp() actual FROM results_launch WHERE singleton')).rows[0];
 assert.equal(first.actual,true,'Activation must record actual database time');
 await q(sql);
 assert.equal((await q('SELECT launch_at FROM results_launch WHERE singleton')).rows[0].launch_at.getTime(),first.launch_at.getTime(),'Replays cannot move the notice cutoff');
 await q('ROLLBACK');
 await q('BEGIN');
 await q("UPDATE results_launch SET launch_at=now()-interval '1 day' WHERE singleton");
 const before=(await q('SELECT launch_at FROM results_launch WHERE singleton')).rows[0].launch_at;
 await q(sql);
 assert.equal((await q('SELECT launch_at FROM results_launch WHERE singleton')).rows[0].launch_at.getTime(),before.getTime(),'An existing launch must remain unchanged');
 await q('ROLLBACK');
 await q('BEGIN');
 await q("UPDATE results_launch SET launch_at=now()+interval '1 day' WHERE singleton");
 await assert.rejects(q(sql),/RESULTS_LAUNCH_ALREADY_SCHEDULED/);
 await q('ROLLBACK');
 await q('BEGIN');
 await q('DELETE FROM results_launch WHERE singleton');
 await assert.rejects(q(sql),/RESULTS_LAUNCH_SETTING_REQUIRED/);
 await q('ROLLBACK');
 console.log('PASS results activation: actual timestamp, idempotent replay, preserved launch, and fail-closed scheduled/missing settings.');
}finally{await q('ROLLBACK').catch(()=>{});client.release();await pool.end();}
