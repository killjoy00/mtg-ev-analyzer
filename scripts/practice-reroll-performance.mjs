import fs from 'node:fs';
import assert from 'node:assert/strict';
import {verifyTarget,summarize} from './practice-performance.mjs';
import {selectCachedDatabaseRun,selectDatabaseReroll,loadCachedCustomSetMetadata} from '../worker/draft-run-selection.mjs';
import {DRAFT_RUN_CORPUS_VERSION as version,draftRunDifficulty} from '../draft-run.mjs';
const branch=process.env.PACK1_BENCHMARK_BRANCH,connection=process.env.DATABASE_URL;
async function control(route) {
 const r=await fetch('https://console.neon.tech/api/v2/projects/patient-shadow-91417882'+route,{headers:{authorization:'Bearer '+process.env.NEON_API_KEY},redirect:'error',signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200);return r.json();
}
const [b,e]=await Promise.all([control('/branches/'+branch),control('/branches/'+branch+'/endpoints')]);
verifyTarget({branch,connection,branchRecord:b.branch,endpoints:e.endpoints});
const {query}=await import('../worker/growth-function.js');
const sets=(await loadCachedCustomSetMetadata(query,version)).slice(0,3).map(s=>s.set_id);
const report={branch,sha:process.env.GITHUB_SHA,sets,scope:'serial SQL diagnosis on disposable clone, not gateway capacity',samples:[],index_bytes:null,passed:false};
const dir='artifacts/practice-performance';fs.mkdirSync(dir,{recursive:true});
const cases=[];
for(const kind of ['mixed','powered-cube','custom-single','custom-multi'])for(let i=0;i<3;i++) {
 const environment=kind==='powered-cube'?kind:'mixed',setIds=kind==='custom-single'?sets.slice(0,1):kind==='custom-multi'?sets:[];
 const seed='reroll-diagnosis-'+kind+'-'+i,started=performance.now();
 const selected=await selectCachedDatabaseRun(query,version,seed,environment,{setIds});
 cases.push({kind,seed,source:selected[0],options:{environment,setIds,type:'pack',round:0,seed,excludedSources:selected.map(p=>p.source_draft_hash),anchor:draftRunDifficulty(selected[0])},start_ms:Math.round(performance.now()-started)});
}
try {
 for(const phase of ['before','set_first_index']) {
  if(phase==='set_first_index')await query("CREATE INDEX qa_reroll_set_window_idx ON draft_run_verified_puzzles(set_id,pick_number,corpus_version,puzzle_id) INCLUDE(source_draft_hash,candidate_count,consensus_top_gap,support_entropy,pack_number) WHERE interesting AND pack_number=1");
  for(const c of cases) {
   let statement;const measured=async(sql,params)=>{statement={sql,params};return query(sql,params);};
   const start=performance.now(),selected=await selectDatabaseReroll(measured,version,c.source,c.options),ms=Math.round(performance.now()-start);
   if(phase==='before')c.expected=selected;else assert.deepEqual(selected,c.expected,'index preserves exact reroll');
   report.samples.push({phase,case:c.kind,seed:c.seed,start_ms:c.start_ms,reroll_ms:ms});
   if(c.seed.endsWith('-0')) {
    const plan=await query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+statement.sql,statement.params);
    fs.writeFileSync(dir+'/reroll-'+phase+'-'+c.kind+'.json',JSON.stringify(plan.rows,null,2));
   }
  }
 }
 report.index_bytes=Number((await query("SELECT pg_relation_size('qa_reroll_set_window_idx') bytes")).rows[0].bytes);
 report.summary=Object.fromEntries(['before','set_first_index'].map(p=>[p,Object.fromEntries([...new Set(cases.map(c=>c.kind))].map(k=>[k,summarize(report.samples.filter(s=>s.phase===p&&s.case===k).map(s=>s.reroll_ms))]))]));
 report.passed=true;console.log(JSON.stringify(report));
} finally {fs.writeFileSync(dir+'/reroll-report.json',JSON.stringify(report,null,2));}
