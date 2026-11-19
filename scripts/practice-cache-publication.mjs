// Destructive test fixtures are confined to a control-plane-verified disposable clone.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
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
// The race probe uses a native connection so its raw SQLSTATE cannot be hidden
// by HTTP transport behavior. Measured selector/reroll requests remain unchanged.
function nativeSnapshot(sql,params) {
 assert.equal(sql,'SELECT pack1_serving_snapshot($1,$2,$3) snapshot');assert.equal(params.length,3);
 return new Promise((resolve,reject)=>{
  const child=execFile('psql',['-X','-q','-A','-t','-d',connection,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',
    '-v','corpus='+params[0],'-v','difficulty='+params[1],'-v','policy='+params[2]],
   {encoding:'utf8',timeout:90000},(error,stdout,stderr)=>{
    if(error)reject(Object.assign(Error('Native publication probe rejected.'),{pgCode:stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]||null}));
    else resolve({rows:[{snapshot:stdout.trim()}]});
   });
  child.stdin.end("SELECT pack1_serving_snapshot(:'corpus',:'difficulty',:'policy')::text snapshot;\n");
 });
}
try {
 // Hold the builder after it captures the input revision, then commit a real
 // revision change from another connection. No production function is replaced.
 await query('CREATE TABLE qa_publication_gates(gate text PRIMARY KEY,released boolean NOT NULL DEFAULT false)');
 await query("INSERT INTO qa_publication_gates(gate) VALUES ('builder'),('writer')");
 await query(`CREATE FUNCTION qa_wait_publication(p_gate text) RETURNS void LANGUAGE plpgsql VOLATILE AS $publication$
   DECLARE deadline timestamptz:=clock_timestamp()+interval '60 seconds';
   BEGIN
    LOOP
     EXIT WHEN (SELECT released FROM qa_publication_gates WHERE gate=p_gate);
     IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'Publication fixture barrier deadline exceeded';END IF;
     PERFORM pg_sleep(0.05);
    END LOOP;
   END; $publication$`);
 await query(`CREATE FUNCTION qa_pause_snapshot() RETURNS trigger LANGUAGE plpgsql AS $publication$ BEGIN
   IF NEW.corpus_version LIKE 'qa-publication-%' THEN PERFORM pg_advisory_xact_lock(516,2);PERFORM qa_wait_publication('builder');END IF;RETURN NEW;END; $publication$`);
 await query('CREATE TRIGGER qa_pause_snapshot BEFORE INSERT ON draft_run_serving_snapshots FOR EACH ROW EXECUTE FUNCTION qa_pause_snapshot()');
 const revisionBefore=String((await query('SELECT revision::text FROM draft_run_serving_revision WHERE singleton')).rows[0].revision);
 const build=loadServingSnapshot(nativeSnapshot,fixture).then(value=>({value}),error=>({error}));
 let held=false;
 for(let i=0;i<50&&!held;i++)held=(await query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=516 AND objid=2 AND granted) held")).rows[0].held==='t';
 assert.ok(held,'builder pause observed');
 // Empty/no-op policy updates intentionally do not invalidate current caches.
 // Use the existing revision function to commit an actual concurrent change.
 await query('SELECT pack1_bump_serving_revision()');
 const revisionAfter=String((await query('SELECT revision::text FROM draft_run_serving_revision WHERE singleton')).rows[0].revision);
 assert.ok(BigInt(revisionAfter)>BigInt(revisionBefore),'concurrent revision change committed');
 report.race_revisions={before:revisionBefore,after:revisionAfter};
 await query("UPDATE qa_publication_gates SET released=true WHERE gate='builder'");
 const result=await build;
 report.race_result={status:result.error?.status??null,pg_code:result.error?.pgCode??null,snapshot_revision:result.value?.revision??null};
 assert.equal(result.error?.status,503,'mixed-revision build is rejected');
 assert.equal(Number((await query('SELECT count(*) n FROM draft_run_serving_snapshots WHERE corpus_version=$1',[fixture])).rows[0].n),0,'partial snapshot rolled back');
 report.race_passed=true;
 await query('DROP TRIGGER qa_pause_snapshot ON draft_run_serving_snapshots');await query('DROP FUNCTION qa_pause_snapshot()');
 // Alternate baseline/candidate to expose trigger cost under the same clone,
 // statement and row count. Every update and trigger toggle rolls back.
 for(let repeat=0;repeat<3;repeat++)for(const enabled of [false,true]) {
   const disable=enabled?'':`ALTER TABLE draft_run_verified_puzzles DISABLE TRIGGER serving_puzzle_metadata;ALTER TABLE draft_run_puzzle_ratings DISABLE TRIGGER serving_ratings;`;
   const sql=`BEGIN;${disable} EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) UPDATE draft_run_verified_puzzles SET interesting=NOT interesting WHERE puzzle_id IN (SELECT puzzle_id FROM draft_run_verified_puzzles ORDER BY puzzle_id LIMIT 1000);ROLLBACK;`;
   const out=execFileSync('psql',['-X','-q','-A','-t','-d',connection,'-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:120000});
   const plan=JSON.parse(out)[0];report.bulk_samples.push({repeat,cache_triggers:enabled,execution_ms:plan['Execution Time'],triggers:plan.Triggers||[]});
 }
 // Measure the known singleton contention explicitly: a writer holding its
 // transaction open also holds the revision row until commit.
 const holder=query(`DO $publication$ BEGIN PERFORM pack1_bump_serving_revision();
   PERFORM pg_advisory_xact_lock(516,3);PERFORM qa_wait_publication('writer');END; $publication$`).then(value=>({value}),error=>({error}));
 let writerHeld=false;
 for(let i=0;i<50&&!writerHeld;i++)writerHeld=(await query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=516 AND objid=3 AND granted) held")).rows[0].held==='t';
 assert.ok(writerHeld);const waiting=performance.now();
 const blockedWriter=query('SELECT pack1_bump_serving_revision()').then(value=>({value}),error=>({error}));
 let blocked=false;
 for(let i=0;i<50&&!blocked;i++)blocked=(await query(`SELECT EXISTS(
   SELECT 1 FROM pg_locks waiting JOIN pg_locks held ON held.locktype='transactionid'
     AND held.transactionid=waiting.transactionid AND held.granted
   JOIN pg_locks signal ON signal.pid=held.pid AND signal.locktype='advisory'
     AND signal.classid=516 AND signal.objid=3 AND signal.granted
   WHERE waiting.locktype='transactionid' AND NOT waiting.granted) blocked`)).rows[0].blocked==='t';
 assert.ok(blocked,'second writer observed blocked on the held revision transaction');
 report.writer_block_observed=true;
 await new Promise(resolve=>setTimeout(resolve,1500));
 await query("UPDATE qa_publication_gates SET released=true WHERE gate='writer'");
 const second=await blockedWriter,first=await holder;
 if(second.error)throw second.error;if(first.error)throw first.error;
 report.writer_wait_ms=Math.round(performance.now()-waiting);
 assert.ok(report.writer_wait_ms>=1000,'second writer waits for the held revision transaction');
 report.passed=report.race_passed;console.log(JSON.stringify(report));
} finally {
 await query('UPDATE qa_publication_gates SET released=true').catch(()=>{});
 fs.writeFileSync(dir+'/publication.json',JSON.stringify(report,null,2));
}
