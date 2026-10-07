import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {gameDateKey} from '../game-date.mjs';
import {DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_SCORING_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';
import {DRAFT_RUN_SELECTION_VERSION} from '../draft-run-policy.mjs';
import {loadCachedCustomSetMetadata,loadPuzzleMetadata,selectCachedDatabaseRun,selectDatabaseReroll} from '../worker/draft-run-selection.mjs';
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
const replay={"seed":"practice:bae31e803e5e8b1e09a0e3a8b858f842af6bdb2c6abc1f98fb773df4f8c2644f","anchor":{"band":"hard","rating":80,"version":"support-ratio-v1"},"setIds":[],"version":"elite-trophy-colour-stage-v9","source_id":"259adce0eebb60cd0af047243260e569","environment":"mixed","excludedSources":["c84e66ee04300f9374bf8b91c1edf508","7f882a74576f8649df8d90b6319d62ee","7e2e7ea5a4655daa06f63b345faef139","bad84edd7513d27a31a05cc32aea7214","2db9ff4df67c309ab25dd7efa278442d","209a3ae8a244335bfbcca59d139fdea3","5e7928b5eaf341785fe28467fd38f3e0","752f5d576bad30f4b20c1353bdd30e5c"],"selectionVersion":"eight-pick-v4","difficultyVersion":"support-ratio-v1"};
const expected={"set_id":"snc","pick_number":1,"candidate_count":14,"consensus_top_gap":0.081106,"support_entropy":0.5464695,"rating":80,"band":"hard","difficulty_version":"support-ratio-v1","top_two_ratio":0.8020757327658785,"target_support_ratio":0.8020757327658785};
const [source]=await loadPuzzleMetadata(query,replay.version,[replay.source_id]);
assert.ok(source);
for(const field of Object.keys(expected)) {
 const actual=typeof expected[field]==='number'?Number(source[field]):source[field];
 assert.equal(actual,expected[field],field+' matches the recorded synthetic source');
}
const options={...replay,type:'pack',round:0,day};
let statement,params;
await selectDatabaseReroll(async(sql,values)=>{statement=sql;params=values;return {rows:[]};},replay.version,source,options);
assert.ok(statement.startsWith('SELECT'));
for(let sample=0;sample<3;sample++) {
 const at=performance.now(),result=await query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+statement,params);
 const detail=parse(Object.values(result.rows[0])[0])[0],elapsed=Math.round(performance.now()-at);
 const at2=performance.now(),replacement=await selectDatabaseReroll(query,replay.version,source,options);
 assert.ok(replacement);
 const measured={kind:'recorded-slow-case',sample,set:source.set_id,rating:source.rating,
  explain_http_ms:elapsed,execution_ms:detail['Execution Time'],planning_ms:detail['Planning Time'],
  reroll_http_ms:Math.round(performance.now()-at2),plan:plan(detail.Plan)};
 summary.push(measured);console.log(JSON.stringify(measured));
}
console.log(JSON.stringify({slowest:summary.slice().sort((a,b)=>b.execution_ms-a.execution_ms).slice(0,8),
  scoring_version:DRAFT_RUN_SCORING_VERSION,cases:summary.length}));
