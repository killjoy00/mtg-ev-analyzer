import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {gameDateKey} from '../game-date.mjs';
import {DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_SCORING_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';
import {DRAFT_RUN_SELECTION_VERSION} from '../draft-run-policy.mjs';
import {loadCachedCustomSetMetadata,selectCachedDatabaseRun,selectDatabaseReroll} from '../worker/draft-run-selection.mjs';
import {query} from '../worker/growth-function.js';
assert.match(process.env.PROFILE_BRANCH||'',/^br-[a-z0-9-]+$/);
assert.ok(!['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b'].includes(process.env.PROFILE_BRANCH));
const day=gameDateKey(),sets=(await loadCachedCustomSetMetadata(query,DRAFT_RUN_CORPUS_VERSION,day)).slice(0,3).map(s=>s.set_id);
assert.equal(sets.length,3);
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const safeName=v=>typeof v==='string'&&/^[a-z0-9_]{1,100}$/.test(v)?v:undefined;
const plan=p=>({type:p['Node Type'],relation:safeName(p['Relation Name']),index:safeName(p['Index Name']),
  actual_total_ms:p['Actual Total Time'],actual_rows:p['Actual Rows'],loops:p['Actual Loops'],
  heap_fetches:p['Heap Fetches'],shared_hit:p['Shared Hit Blocks'],shared_read:p['Shared Read Blocks'],
  temp_read:p['Temp Read Blocks'],temp_written:p['Temp Written Blocks'],plans:p.Plans?.map(plan)});
const summary=[];
for(const kind of ['mixed','powered-cube','custom-multi'])for(let sample=0;sample<12;sample++){
 const environment=kind==='powered-cube'?kind:'mixed',seed='reroll-plan:'+kind+':'+sample,setIds=kind==='custom-multi'?sets:[];
 const run=await selectCachedDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seed,environment,{day,setIds});
 assert.equal(run.length,8);
 const source=run[0],options={type:'pack',round:0,seed,excludedSources:run.map(p=>p.source_draft_hash),
  environment,day,setIds,difficultyVersion:DRAFT_RUN_DIFFICULTY_VERSION,selectionVersion:DRAFT_RUN_SELECTION_VERSION};
 let statement,params;
 await selectDatabaseReroll(async(sql,values)=>{statement=sql;params=values;return {rows:[]};},DRAFT_RUN_CORPUS_VERSION,source,options);
 assert.ok(statement.startsWith('SELECT'));
 const at=performance.now(),result=await query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+statement,params);
 const detail=parse(Object.values(result.rows[0])[0])[0],elapsed=Math.round(performance.now()-at);
 const at2=performance.now(),replacement=await selectDatabaseReroll(query,DRAFT_RUN_CORPUS_VERSION,source,options);
 assert.ok(replacement);
 const measured={kind,sample,set:source.set_id,pick:source.pick_number,rating:source.rating,
  explain_http_ms:elapsed,execution_ms:detail['Execution Time'],planning_ms:detail['Planning Time'],
  reroll_http_ms:Math.round(performance.now()-at2),plan:plan(detail.Plan)};
 summary.push(measured);
 console.log(JSON.stringify(measured));
}
console.log(JSON.stringify({slowest:summary.slice().sort((a,b)=>b.execution_ms-a.execution_ms).slice(0,8),
  scoring_version:DRAFT_RUN_SCORING_VERSION,cases:summary.length}));
