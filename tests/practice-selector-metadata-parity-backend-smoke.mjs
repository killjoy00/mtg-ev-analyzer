// Existing disposable backend CI branch only. Never a production or gateway probe.
// Exact previous-vs-new selector output, then one bounded warmed SQL-only A/B/B/A
// comparison on the same 25 preconnected backends, without gameplay traffic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import pg from 'pg';
import {loadServingSnapshot,customSetsFromSnapshot,currentPracticeBatchPlan} from '../worker/draft-run-selection.mjs';
import {DRAFT_RUN_CORPUS_VERSION as version} from '../draft-run.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';
import {SERVING_POLICY_VERSION} from '../serving-quality.mjs';
import {gameDateKey} from '../game-date.mjs';

assert.ok(process.argv.includes('--dev-fixtures'),'No production execution: isolated fixture marker required');
assert.equal(process.env.BACKEND_DOMAIN,'corpus','Only isolated backend corpus CI is allowed');
assert.match(process.env.PACK1_CI_BRANCH_ID||'',/^br-[a-z0-9-]+$/,'CI disposable branch identity required');
const connectionFile=process.argv[2];
assert.ok(connectionFile&&fs.existsSync(connectionFile),'CI-owned connection file required');
const connection=fs.readFileSync(connectionFile,'utf8').trim();
assert.equal(new URL(connection).hostname.includes('-pooler.'),false,'Require direct connections');
const {Client}=pg,REFERENCE='public.pack1_select_serving_run_reference_0051';
const CURRENT='public.pack1_select_serving_run_v1';
const referenceSQL='SELECT '+REFERENCE+'($1::bigint,$2::bigint,$3,$4,$5,$6::jsonb) selection';
const currentSQL='SELECT '+CURRENT+'($1::bigint,$2::bigint,$3,$4,$5,$6::jsonb) selection';
const old=fs.readFileSync(new URL('../migrations/0051_exact_pick_draw_index.sql',import.meta.url),'utf8');
const expected='CREATE OR REPLACE FUNCTION public.pack1_select_serving_run_v1(';
assert.equal(old.split(expected).length-1,1);
const referenceDefinition=old.slice(old.indexOf(expected)).replace(expected,
  'CREATE OR REPLACE FUNCTION '+REFERENCE+'(');
const outputDir='artifacts/corpus-readiness';
fs.mkdirSync(outputDir,{recursive:true});
const output=outputDir+'/selector-metadata-paired-comparison.json';
const hash=text=>createHash('sha256').update(text).digest('hex');
const now=()=>performance.now();
const round=n=>Math.round(n*100)/100;
const percentile=(numbers,p)=>{
  const sorted=[...numbers].sort((a,b)=>a-b);
  return sorted[Math.ceil(sorted.length*p)-1]??null;
};
const report={
  schema:1,scope:'isolated SQL correctness plus warmed direct-client 25-way comparison; no API capacity',
  source_commit:process.env.HEAD_SHA||null,ci_disposable_branch:process.env.PACK1_CI_BRANCH_ID,
  original_migration:'0051_exact_pick_draw_index.sql',
  proposed_migration:'0059_batch_practice_selected_metadata.sql',
  accepted_capacity:false,cold_to_cold_comparison:false,
  comparison_method:'25 parity/warm-up queries per variant; then warmed ABBA, same snapshot/seeds/25 direct sessions',
  modes:['mixed','powered-cube','single-set','multi-set'],
  parity:{checked:0,passed:false,missing_metadata_rejected:false},waves:[],
  status:'incomplete'
};
const control=new Client({connectionString:connection,connectionTimeoutMillis:10000,
  query_timeout:15000,application_name:'pack1-selector-reference-check'});
const clients=[];
let installed=false,fixtureId=null,sqlCalls=0;
const deadline=Date.now()+150000;
const bounded=()=>{
  assert.ok(Date.now()<=deadline,'selector comparison deadline exceeded');
  assert.ok(sqlCalls<=160,'selector comparison query budget exceeded');
};
const query=async(client,text,values=[])=>{
  const result=await client.query({text,values});
  return result.rows;
};
const run=async(client,sql,actor)=>{
  sqlCalls++;bounded();
  const rows=await query(client,sql,actor.params);
  return rows[0]?.selection;
};
const requireRun=value=>{
  assert.equal(value?.ok,true,'Selector must return a successful eight-pick result');
  assert.equal(value.draws_used,16);
  assert.equal(value.selections?.length,8,'Every selection has exactly eight ordered metadata objects');
  assert.equal(new Set(value.selections.map(x=>x.source_draft_hash)).size,8,'Sources remain unique');
  for(const p of value.selections){
    assert.equal(typeof p,'object');assert.ok(p&&!Array.isArray(p));
    assert.equal(p.selected_id,p.puzzle_id);
    assert.ok(p.puzzle_id&&p.source_draft_hash&&p.set_id);
    for(const field of ['puzzle_id','set_id','corpus_version','source_draft_hash','pack_number',
      'pick_number','candidate_count','consensus_top_gap','support_entropy','difficulty_version',
      'rating','top_two_ratio','target_support_ratio','band','selected_id'])
      assert.ok(Object.hasOwn(p,field),'Missing original field: '+field);
  }
};
async function missingMetadataCase(snapshot) {
  const key='qa-selector-missing-'+randomUUID(),hashPrefix='qa-selector-empty-'+randomUUID();
  const groups=Array.from({length:8},(_,i)=>({
    set_id:'hob',pick_number:i+1,band:'medium',n:1,sources:1
  }));
  const rows=await query(control,
    'INSERT INTO draft_run_serving_snapshots(corpus_version,difficulty_version,serving_policy_version,cache_schema,revision,metadata,groups) '+
    'VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) RETURNING id',
    [key,DRAFT_RUN_DIFFICULTY_VERSION,SERVING_POLICY_VERSION,'serving-cache-v1',
      snapshot.revision,'[]',JSON.stringify(groups)]);
  fixtureId=rows[0].id;
  await query(control,
    'INSERT INTO draft_run_serving_inventory(snapshot_id,puzzle_id,set_id,pick_number,band,source_draft_hash) '+
    "SELECT $1::bigint,$2||'-'||x::text,'hob',x::smallint,'medium',$3||'-'||x::text "+
    'FROM generate_series(1,8) AS x',[fixtureId,key,hashPrefix]);
  const plan={
    selection_version:'eight-pick-v4',
    groups:groups.map(({set_id,pick_number,band,n})=>({set_id,pick_number,band,n})),
    windows:Array.from({length:8},(_,i)=>[i+1,i+1]),bands:Array(8).fill('medium'),
    required:[],forced:Array(8).fill('hob'),
    round_randoms:Array.from({length:8},()=>({set:.5,offset:.5}))
  };
  const actor={params:[fixtureId,snapshot.revision,key,DRAFT_RUN_DIFFICULTY_VERSION,
    SERVING_POLICY_VERSION,JSON.stringify(plan)]};
  const [before,after]=[await run(control,referenceSQL,actor),await run(control,currentSQL,actor)];
  assert.deepEqual(after,before,'Missing metadata must preserve corpus_changed error position');
  assert.deepEqual(after,{ok:false,error:'corpus_changed',round:0,draws_used:2},
    'Never return a shortened or null-bearing selection');
  report.parity.missing_metadata_rejected=true;
  await query(control,'DELETE FROM draft_run_serving_snapshots WHERE id=$1::bigint',[fixtureId]);
  fixtureId=null;
}
async function wave(kind,index,actors,pids){
  const sql=kind==='reference'?referenceSQL:currentSQL;
  const requested=[],start=now(),stop={done:false},observed=new Set();
  let peak=0,samples=0;
  const monitor=(async()=>{
    while(!stop.done&&samples<150){
      try{
        const active=await query(control,
          "SELECT pid FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND state='active'",[pids]);
        samples++;peak=Math.max(peak,active.length);
        for(const row of active)observed.add(Number(row.pid));
      }catch{samples++;}
      if(!stop.done)await new Promise(resolve=>setTimeout(resolve,12));
    }
  })();
  const outcomes=await Promise.all(actors.map(async(actor,i)=>{
    const t=now();requested.push(t);
    try{
      const selected=await run(clients[i],sql,actor);
      requireRun(selected);
      assert.equal(hash(JSON.stringify(selected)),actor.resultHash,
        'Same actor must retain full ordered metadata and eligibility');
      return {actor:i,mode:actor.mode,ok:true,duration_ms:round(now()-t)};
    }catch(e){return {actor:i,mode:actor.mode,ok:false,duration_ms:round(now()-t),reason:e.name||'error'};}
  }));
  stop.done=true;
  await monitor;
  assert.ok(outcomes.every(x=>x.ok),'Selector wave must not omit failed requests');
  const durations=outcomes.map(x=>x.duration_ms);
  const result={
    kind,wave:index,count:outcomes.length,
    dispatch_spread_ms:round(Math.max(...requested)-Math.min(...requested)),
    distinct_backend_sessions:new Set(pids).size,
    observed_active_peak:peak,observed_active_backends:observed.size,monitor_samples:samples,
    p50_ms:percentile(durations,.5),p95_ms:percentile(durations,.95),
    p99_ms:percentile(durations,.99),max_ms:Math.max(...durations),
    elapsed_ms:round(now()-start),requests:outcomes
  };
  assert.equal(result.count,25);
  assert.ok(result.dispatch_spread_ms<=1000,'Burst dispatch misses one-second synchronization');
  report.waves.push(result);
  bounded();
  return result;
}
try{
  await control.connect();
  await control.query(referenceDefinition);
  installed=true;
  const snapshot=await loadServingSnapshot(async(sql,params)=>({rows:await query(control,sql,params)}),version);
  const custom=customSetsFromSnapshot(snapshot,gameDateKey()).slice(0,3).map(x=>x.set_id);
  assert.equal(custom.length,3,'Need the same three eligible regular sets as the retained 25-client reference');
  report.parity.snapshot_revision=snapshot.revision;
  const actors=Array.from({length:25},(_,id)=>{
    const mode=report.modes[id%4],environment=mode==='powered-cube'?'powered-cube':'mixed',
      setIds=mode==='single-set'?custom.slice(0,1):mode==='multi-set'?custom:[];
    const seed='practice-concurrency-20261008:'+id;
    const {plan}=currentPracticeBatchPlan(snapshot,seed,environment,{day:gameDateKey(),setIds});
    assert.equal(plan.round_randoms.length,8);
    return {mode,seed,params:[snapshot.id,snapshot.revision,version,DRAFT_RUN_DIFFICULTY_VERSION,
      SERVING_POLICY_VERSION,JSON.stringify(plan)]};
  });
  report.parity.mode_counts=Object.fromEntries(report.modes.map(mode=>[mode,actors.filter(a=>a.mode===mode).length]));
  assert.deepEqual(report.parity.mode_counts,
    {'mixed':7,'powered-cube':6,'single-set':6,'multi-set':6});
  for(const actor of actors) {
    const prior=await run(control,referenceSQL,actor);
    const revised=await run(control,currentSQL,actor);
    requireRun(prior);requireRun(revised);
    assert.deepEqual(revised,prior,'Exact old/new seed, order and every metadata field');
    actor.resultHash=hash(JSON.stringify(prior));
    report.parity.checked++;bounded();
  }
  assert.equal(report.parity.checked,25);
  await missingMetadataCase(snapshot);
  report.parity.passed=true;
  const perfAuthorized=process.env.GITHUB_HEAD_REF==='fix/practice-selector-batch-metadata-20261008';
  if(perfAuthorized){
    // Previously committed old/new parity warm-up runs on the same snapshot.
    // No independent cold baseline and no extra clone, gateway or gameplay.
    for(let i=0;i<25;i++)clients.push(new Client({connectionString:connection,
      connectionTimeoutMillis:10000,query_timeout:15000,
      application_name:'pack1-paired-selector-'+i}));
    await Promise.all(clients.map(c=>c.connect()));
    const pids=(await Promise.all(clients.map(c=>query(c,'SELECT pg_backend_pid() pid')))).map(r=>Number(r[0].pid));
    assert.equal(new Set(pids).size,25,'Require real independent PostgreSQL sessions');
    await Promise.all(clients.map(c=>query(c,"SET statement_timeout='12000ms'")));
    for(const [i,variant] of ['reference','batched','batched','reference'].entries()){
      await wave(variant,i+1,actors,pids);
    }
    report.performance_measured=true;
  }else report.performance_measured=false;
  report.status='passed';
  console.log('PASS: old/new selector exact 25-seed four-mode parity, eight results, order, fields, missing metadata; '+
    JSON.stringify({parity:report.parity.checked,waves:report.waves.map(({kind,p95_ms,observed_active_peak})=>({
      kind,p95_ms,observed_active_peak})),cold_comparison:false}));
}catch(e){
  report.status='failed';
  report.error_category=e.name||'comparison_error';
  throw e;
}finally{
  try{if(fixtureId!=null)await query(control,
    'DELETE FROM draft_run_serving_snapshots WHERE id=$1::bigint',[fixtureId]);}catch{report.fixture_cleanup_failed=true;}
  try{if(installed)await query(control,
    'DROP FUNCTION IF EXISTS '+REFERENCE+'(bigint,bigint,text,text,text,jsonb)');}
  catch{report.reference_cleanup_failed=true;}
  await Promise.allSettled(clients.map(c=>c.end()));
  await control.end().catch(()=>{});
  report.sql_selector_calls=sqlCalls;
  report.finished_at=new Date().toISOString();
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
}
