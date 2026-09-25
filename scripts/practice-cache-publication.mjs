// Destructive test fixtures are confined to a control-plane-verified disposable clone.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {verifyTarget} from './practice-performance.mjs';
import {loadServingSnapshot} from '../worker/draft-run-selection.mjs';
const branch=process.env.PACK1_BENCHMARK_BRANCH,connection=process.env.DATABASE_URL;
async function control(route) {
 const r=await fetch('https://console.neon.tech/api/v2/projects/patient-shadow-91417882'+route,{headers:{authorization:'Bearer '+process.env.NEON_API_KEY},redirect:'error',signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200);return r.json();
}
const [b,e]=await Promise.all([control('/branches/'+branch),control('/branches/'+branch+'/endpoints')]);
verifyTarget({branch,connection,branchRecord:b.branch,endpoints:e.endpoints});
const {query}=await import('../worker/growth-function.js');
const fixture='qa-publication-'+crypto.randomUUID(),report={branch,sha:process.env.GITHUB_SHA,race_passed:false,bulk_samples:[],scope:'rollback-only 1,000-row metadata update, not a complete import throughput claim'};
const dir='artifacts/practice-performance';fs.mkdirSync(dir,{recursive:true});
try {
 // Hold the builder after it captures the input revision, then commit a real
 // revision change from another connection. No production function is replaced.
 await query(`CREATE FUNCTION qa_pause_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF NEW.corpus_version LIKE 'qa-publication-%' THEN PERFORM pg_advisory_xact_lock(516,2);PERFORM pg_sleep(4);END IF;RETURN NEW;END $$`);
 await query('CREATE TRIGGER qa_pause_snapshot BEFORE INSERT ON draft_run_serving_snapshots FOR EACH ROW EXECUTE FUNCTION qa_pause_snapshot()');
 const build=loadServingSnapshot(query,fixture).then(value=>({value}),error=>({error}));
 let held=false;
 for(let i=0;i<50&&!held;i++)held=(await query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=516 AND objid=2 AND granted) held")).rows[0].held==='t';
 assert.ok(held,'builder pause observed');
 await query('UPDATE draft_run_environment_policy SET status=status WHERE false');
 const result=await build;assert.equal(result.error?.status,503,'mixed-revision build is rejected');
 assert.equal(Number((await query('SELECT count(*) n FROM draft_run_serving_snapshots WHERE corpus_version=$1',[fixture])).rows[0].n),0,'partial snapshot rolled back');
 report.race_passed=true;
 await query('DROP TRIGGER qa_pause_snapshot ON draft_run_serving_snapshots');await query('DROP FUNCTION qa_pause_snapshot()');
 // Alternate baseline/candidate to expose trigger cost under the same clone,
 // statement and row count. Every update and trigger toggle rolls back.
 for(let repeat=0;repeat<3;repeat++)for(const enabled of [false,true]) {
   const disable=enabled?'':`ALTER TABLE draft_run_verified_puzzles DISABLE TRIGGER serving_puzzle_metadata;ALTER TABLE draft_run_puzzle_ratings DISABLE TRIGGER serving_ratings;`;
   const sql=`BEGIN;${disable} EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) UPDATE draft_run_verified_puzzles SET interesting=interesting WHERE puzzle_id IN (SELECT puzzle_id FROM draft_run_verified_puzzles ORDER BY puzzle_id LIMIT 1000);ROLLBACK;`;
   const out=execFileSync('psql',['-X','-q','-A','-t','-d',connection,'-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:120000});
   const plan=JSON.parse(out)[0];report.bulk_samples.push({repeat,cache_triggers:enabled,execution_ms:plan['Execution Time'],triggers:plan.Triggers||[]});
 }
 report.passed=report.race_passed;console.log(JSON.stringify(report));
} finally {fs.writeFileSync(dir+'/publication.json',JSON.stringify(report,null,2));}
