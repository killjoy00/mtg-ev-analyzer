// Compare exact current-Practice draws on a verified disposable production clone.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {verifyTarget,summarize} from './practice-performance.mjs';
import {selectCachedDatabaseRun,loadServingSnapshot,customSetsFromSnapshot} from '../worker/draft-run-selection.mjs';
import {DRAFT_RUN_CORPUS_VERSION as version} from '../draft-run.mjs';
import {gameDateKey} from '../game-date.mjs';
const branch=process.env.PACK1_BENCHMARK_BRANCH,connection=process.env.DATABASE_URL;
async function control(route) {
 const r=await fetch('https://console.neon.tech/api/v2/projects/patient-shadow-91417882'+route,{headers:{authorization:'Bearer '+process.env.NEON_API_KEY},redirect:'error',signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200);return r.json();
}
const [b,e]=await Promise.all([control('/branches/'+branch),control('/branches/'+branch+'/endpoints')]);
verifyTarget({branch,connection,branchRecord:b.branch,endpoints:e.endpoints});
const {query}=await import('../worker/growth-function.js');
const snapshot=await loadServingSnapshot(query,version),sets=customSetsFromSnapshot(snapshot,gameDateKey()).slice(0,3).map(s=>s.set_id);
assert.equal(sets.length,3);
const signature='pack1_select_serving_run_v1(bigint,bigint,text,text,text,jsonb)';
const original=(await query("SELECT pg_get_functiondef($1::regprocedure) definition",[signature])).rows[0].definition;
const draw=`    SELECT i.puzzle_id,i.source_draft_hash
      INTO chosen_puzzle_id,chosen_source
    FROM draft_run_serving_inventory i
    WHERE i.snapshot_id=p_snapshot_id AND i.pick_number BETWEEN window_start AND window_end
      AND i.source_draft_hash<>ALL(selected_sources) AND i.set_id=chosen_set AND i.band=chosen_band
    ORDER BY i.puzzle_id COLLATE "C" LIMIT 1 OFFSET chosen_offset;`;
assert.equal(original.split(draw).length,2,'Installed draw body must match the reviewed reference');
const proposed=original.replace(draw,()=>`    IF window_start=window_end THEN
      SELECT i.puzzle_id,i.source_draft_hash
        INTO chosen_puzzle_id,chosen_source
      FROM draft_run_serving_inventory i
      WHERE i.snapshot_id=p_snapshot_id AND i.pick_number=window_start
        AND i.source_draft_hash<>ALL(selected_sources) AND i.set_id=chosen_set AND i.band=chosen_band
      ORDER BY i.puzzle_id COLLATE "C" LIMIT 1 OFFSET chosen_offset;
    ELSE
${draw}
    END IF;`);
const report={branch,sha:process.env.GITHUB_SHA,snapshot:snapshot.id,revision:snapshot.revision,sets,scope:'bounded clone SQL draw diagnosis; exact parity and concurrent SQL timing, not API capacity',phases:[],plans:[],passed:false};
const dir='artifacts/practice-performance';fs.mkdirSync(dir,{recursive:true});
const sql=statement=>execFileSync('psql',['-X','-q','-d',connection,'-v','ON_ERROR_STOP=1'],{input:statement,stdio:['pipe','ignore','pipe'],timeout:240000});
const actors=Array.from({length:50},(_,i)=>i).filter(id=>id%10>=5).map(id=>{
 const mode=(id+1)%4;
 return {id,seed:'draw-diagnosis-'+id,environment:mode===1?'powered-cube':'mixed',setIds:mode===2?sets.slice(0,1):mode===3?sets:[]};
});
const expected=new Map();
const largest=[...snapshot.groups].sort((a,b)=>Number(b.n)-Number(a.n))[0];
async function phase(name,exactPick) {
 const samples=[];
 for(let wave=0;wave<2;wave++) {
  const results=await Promise.allSettled(actors.map(async c=>{
   const start=performance.now(),selected=await selectCachedDatabaseRun(query,version,c.seed,c.environment,{setIds:c.setIds});
   const ids=selected.map(p=>p.puzzle_id),key=c.id;
   if(name==='reference')expected.set(key,selected);else assert.deepEqual(selected,expected.get(key),'exact eight decisions, metadata, order and difficulty anchors');
   samples.push({actor:c.id,environment:c.environment,setIds:c.setIds,wave,ms:Math.round(performance.now()-start),ids});
  }));
  for(const r of results)if(r.status==='rejected')throw r.reason;
 }
 const statement=`SELECT puzzle_id,source_draft_hash FROM draft_run_serving_inventory
 WHERE snapshot_id=$1::bigint AND set_id=$2 AND band=$3
 AND ${exactPick?'pick_number=$4::int AND $5::int=$4::int':'pick_number BETWEEN $4::int AND $5::int'}
 ORDER BY puzzle_id COLLATE "C" LIMIT 1 OFFSET $6::int`;
 const params=[snapshot.id,largest.set_id,largest.band,largest.pick_number,largest.pick_number,Math.floor(Number(largest.n)*.95)];
 const selected=(await query(statement,params)).rows;
 if(name==='reference')report.reference_draw=selected;else assert.deepEqual(selected,report.reference_draw,'same high-offset decision');
 const raw=(await query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+statement,params)).rows[0]['QUERY PLAN'];
 report.plans.push({phase:name,group:largest,plan:typeof raw==='string'?JSON.parse(raw):raw});
 report.phases.push({name,summary:summarize(samples.map(s=>s.ms)),samples});
}
try {
 await phase('reference',false);
 const start=performance.now();
 sql('CREATE INDEX draft_run_inventory_pick_draw_idx ON draft_run_serving_inventory(snapshot_id,set_id,band,pick_number,puzzle_id) INCLUDE(source_draft_hash);\n'+proposed);
 report.install_ms=Math.round(performance.now()-start);
 report.index_bytes=Number((await query("SELECT pg_relation_size('draft_run_inventory_pick_draw_idx') bytes")).rows[0].bytes);
 await phase('pick_index',true);
 report.passed=true;
 console.log(JSON.stringify({branch,passed:report.passed,index_bytes:report.index_bytes,install_ms:report.install_ms,phases:report.phases.map(p=>({name:p.name,summary:p.summary}))}));
} finally {
 try {sql(original);} finally {fs.writeFileSync(dir+'/draw-report.json',JSON.stringify(report,null,2));}
}
