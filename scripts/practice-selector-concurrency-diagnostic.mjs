// Disposable-branch-only current Practice selector concurrency diagnosis.
// Exactly 25 independent SQL selections per wave, at most two waves.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import pg from 'pg';
import {verifyTarget} from './practice-performance.mjs';
import {loadServingSnapshot,customSetsFromSnapshot,currentPracticeBatchPlan,selectBatchedDatabaseRun} from '../worker/draft-run-selection.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';
import {SERVING_POLICY_VERSION} from '../serving-quality.mjs';
import {gameDateKey} from '../game-date.mjs';

const {Client}=pg;
const PROJECT='patient-shadow-91417882';
const PARENT='br-orange-feather-ayps8kep';
const SIGNATURE='pack1_select_serving_run_v1(bigint,bigint,text,text,text,jsonb)';
const SELECT_SQL='SELECT pack1_select_serving_run_v1($1::bigint,$2::bigint,$3,$4,$5,$6::jsonb) selection';
const LIMIT=25;
const DIR='artifacts/practice-selector-concurrency';
const sha=value=>createHash('sha256').update(value).digest('hex');
const stamp=()=>new Date().toISOString();
const ms=()=>performance.now();
const safeError=e=>e?.code==='57014'?'db_timeout':e?.code==='ETIMEDOUT'?'transport_timeout':e?.code==='53300'?'connection_limit':e?.name==='AssertionError'?'assertion_failed':e?.code==='ECONNRESET'?'transport_reset':'query_failed';
const quantile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]:null;
const round=v=>Math.round(v*100)/100;
const summarize=rows=>{const a=rows.filter(x=>x.ok).map(x=>x.sql_ms);return {observations:a.length,p50_ms:quantile(a,.5),p95_ms:quantile(a,.95),p99_ms:quantile(a,.99),min_ms:a.length?Math.min(...a):null,max_ms:a.length?Math.max(...a):null};};

function actors(snapshot,day) {
  const custom=customSetsFromSnapshot(snapshot,day).slice(0,3).map(s=>s.set_id);
  assert.equal(custom.length,3,'At least three currently eligible custom Practice sets required');
  const modes=['mixed','powered-cube','single-set','multi-set'];
  return Array.from({length:LIMIT},(_,id)=>{
    const mode=modes[id%4], environment=mode==='powered-cube'?'powered-cube':'mixed';
    const setIds=mode==='single-set'?custom.slice(0,1):mode==='multi-set'?custom:[];
    const seed=`practice-concurrency-20261008:${id}`;
    const {plan}=currentPracticeBatchPlan(snapshot,seed,environment,{day,setIds});
    assert.equal(plan.selection_version,'eight-pick-v4');
    assert.equal(plan.round_randoms.length,8);
    return {id,mode,environment,setIds,seed,plan_hash:sha(JSON.stringify(plan)),plan_json:JSON.stringify(plan)};
  });
}

async function preflight() {
  assert.ok(Number(process.versions.node.split('.')[0])>=24,'Runner requires Node 24');
  assert.equal(typeof Client,'function');
  assert.ok(selectBatchedDatabaseRun.toString().includes(SELECT_SQL),'Application SQL must match');
  // Run the actual application planner on a synthetic, memory-only fixture.
  const groups=[],metadata=[];
  for(const set_id of ['hob','msh','sos','powered-cube']) {
    metadata.push({set_id,status:'Live',regular_run:set_id!=='powered-cube',release_date:'2026-01-01',set_name:set_id});
    for(let i=1;i<=11;i++)for(const band of ['easy','medium','hard'])groups.push({set_id,pick_number:i,band,n:60,sources:60});
  }
  const planned=actors({groups,metadata},'2026-10-08');
  assert.equal(planned.length,25);
  assert.deepEqual(planned.map(x=>x.mode).reduce((o,x)=>(o[x]=(o[x]||0)+1,o),{}),{'mixed':7,'powered-cube':6,'single-set':6,'multi-set':6});
  assert.equal(new Set(planned.map(x=>x.plan_hash)).size,25,'Distinct deterministic plans required');
  // Verify exact SQL and parameter construction against the application wrapper.
  const example=planned[0],sentinel=new Error('expected_fake_query');
  await assert.rejects(selectBatchedDatabaseRun(async(sql,params)=>{
    assert.equal(sql,SELECT_SQL);
    assert.deepEqual(params,[undefined,undefined,DRAFT_RUN_CORPUS_VERSION,
      DRAFT_RUN_DIFFICULTY_VERSION,SERVING_POLICY_VERSION,example.plan_json]);
    throw sentinel;
  },DRAFT_RUN_CORPUS_VERSION,example.seed,example.environment,
  {snapshot:{groups,metadata},day:'2026-10-08',setIds:example.setIds}),e=>e===sentinel);
  // Independent client instances are used, not a pooled queue or single connection.
  const clients=Array.from({length:25},()=>new Client({connectionString:'postgres://fixture@localhost/example'}));
  assert.equal(new Set(clients).size,25);
  let simultaneous=0,peak=0;
  await Promise.all(clients.map(async()=>{simultaneous++;peak=Math.max(peak,simultaneous);await new Promise(resolve=>setImmediate(resolve));simultaneous--;}));
  assert.equal(peak,25,'Concurrent promise scheduling preflight failed');
  console.log(JSON.stringify({preflight:'passed',node:process.versions.node,independent_clients:25,planned_modes:4,source:'current_app_planner',database_connections:0}));
}

async function control(route,key,{method='GET'}={}) {
  const res=await fetch('https://console.neon.tech/api/v2/projects/'+PROJECT+route,{method,headers:{authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw Error('Neon control request failed: HTTP '+res.status);
  return res.json();
}
function openClient(connection,name) {
  return new Client({connectionString:connection,connectionTimeoutMillis:8000,query_timeout:15000,
    application_name:'pack1-selector-'+name});
}
async function pgQuery(client,sql,params=[]) {return (await client.query({text:sql,values:params})).rows;}
function lineSummary(raw) {
  return raw.filter(x=>x.exec_stmts!=null&&Number(x.exec_stmts)>0).map(x=>({line:Number(x.lineno),
    source:String(x.source||'').trim().slice(0,165),executions:Number(x.exec_stmts),
    total_ms:round(Number(x.total_time||0)),avg_ms:round(Number(x.avg_time||0))}));
}
function isLoop(line) {return line.source.includes('FOR round_index IN 0..7 LOOP');}
async function profileRows(client) {
  const raw=await pgQuery(client,'SELECT lineno,source,exec_stmts,total_time,avg_time FROM plpgsql_profiler_function_tb($1::regprocedure)',[SIGNATURE]);
  return lineSummary(raw);
}
async function profileReset(client) {await pgQuery(client,'SELECT plpgsql_profiler_reset($1::regprocedure)',[SIGNATURE]);}
async function getProfile(controlClient,clients) {
  const shared=await profileRows(controlClient);
  const sharedCalls=shared.find(isLoop)?.executions||0;
  if(sharedCalls===LIMIT)return {scope:'shared',calls:sharedCalls,statements:shared};
  if(sharedCalls!==0)throw Error('Profiler shared-call count differs from 25');
  const parts=await Promise.all(clients.map(c=>profileRows(c)));
  const calls=parts.reduce((s,lines)=>s+(lines.find(isLoop)?.executions||0),0);
  if(calls!==LIMIT)throw Error('Profiler session-call count differs from 25');
  const merged=new Map();
  for(const lines of parts)for(const row of lines){const old=merged.get(row.line)||{...row,executions:0,total_ms:0,avg_ms:0};old.executions+=row.executions;old.total_ms+=row.total_ms;old.avg_ms=old.executions?old.total_ms/old.executions:0;merged.set(row.line,old);}
  return {scope:'session',calls,statements:[...merged.values()].map(x=>({...x,total_ms:round(x.total_ms),avg_ms:round(x.avg_ms)}))};
}
async function monitor(watched,stop) {
  const samples=[],seen=new Set(),query_ms=[];let maxActive=0;
  while(!stop.done && samples.length<220){
    const start=ms();
    try{
      const result=await pgQuery(watched.client,`SELECT pid,query_start::text started FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND state='active' AND query LIKE 'SELECT pack1_select_serving_run_v1%'`,[watched.pids]);
      const current=result.map(x=>Number(x.pid));current.forEach(x=>seen.add(x));maxActive=Math.max(maxActive,current.length);
      samples.push({t:stamp(),active:current.length,pids:current});
    }catch{samples.push({t:stamp(),error:'monitor_read_failed'});}
    query_ms.push(round(ms()-start));
    if(!stop.done)await new Promise(resolve=>setTimeout(resolve,15));
  }
  return {samples,maxActive,observed_backends:seen.size,monitor_calls:query_ms.length,
    monitor_query_ms:round(query_ms.reduce((x,y)=>x+y,0)),monitor_max_query_ms:Math.max(0,...query_ms)};
}

async function runWave(n,actorsList,clients,controlClient,monitorClient,backendIds,snapshot,day,write) {
  await profileReset(controlClient);
  await Promise.all(clients.map(c=>profileReset(c)));
  const startWall=stamp(),start=ms();
  const stop={done:false};
  const poll=monitor({client:monitorClient,pids:backendIds},stop);
  const launches=[];
  const tasks=actorsList.map((actor,index)=>{
    const dispatched=ms();
    launches.push(dispatched);
    const record={wave:n,actor:actor.id,mode:actor.mode,environment:actor.environment,
      sets:actor.setIds,seed:actor.seed,plan_sha256:actor.plan_hash,backend_pid:backendIds[index],
      dispatched_at:stamp()};
    // Planner output was materialized with actual app code before the burst.
    // Parameter types, order and SQL are identical to selectBatchedDatabaseRun.
    const params=[snapshot.id,snapshot.revision,DRAFT_RUN_CORPUS_VERSION,
      DRAFT_RUN_DIFFICULTY_VERSION,SERVING_POLICY_VERSION,actor.plan_json];
    return (async()=>{
      try{
        const began=ms();let result;
        try {result=await clients[index].query({text:SELECT_SQL,values:params});}
        finally {record.sql_ms=round(ms()-began);}
        const selection=result.rows[0]?.selection;
        assert.equal(selection?.ok,true,'Selection must succeed');
        assert.equal(selection?.draws_used,16);
        assert.equal(selection?.selections?.length,8);
        assert.equal(new Set(selection.selections.map(x=>x.source_draft_hash)).size,8);
        record.ok=true;record.result_sha256=sha(JSON.stringify(selection.selections.map(x=>x.puzzle_id)));
      }catch(e){record.ok=false;record.error=safeError(e);}
      finally{record.completed_at=stamp();record.client_ms=round(ms()-dispatched);write(record);}
      return record;
    })();
  });
  const results=await Promise.all(tasks);
  stop.done=true;
  const observed=await poll;
  const profile=await getProfile(controlClient,clients);
  const elapsed=round(ms()-start);
  const wave={wave:n,started_at:startWall,elapsed_with_monitor_and_profiler_ms:elapsed,
    dispatch_span_ms:round(Math.max(...launches)-Math.min(...launches)),
    counts:{dispatched:tasks.length,successes:results.filter(x=>x.ok).length,errors:results.filter(x=>!x.ok).length},
    backend_distinct:new Set(backendIds).size,latency:summarize(results),monitor:observed,profiler:profile,
    valid_concurrency:observed.maxActive>=10&&observed.observed_backends>=10&&new Set(backendIds).size===25&&results.length===25&&Math.max(...launches)-Math.min(...launches)<250};
  write({event:'wave_complete',wave:n,valid_concurrency:wave.valid_concurrency,max_db_overlap:observed.maxActive});
  return wave;
}

async function run() {
  fs.mkdirSync(DIR,{recursive:true});
  const events=path.join(DIR,'events.ndjson'),reportPath=path.join(DIR,'report.json');
  const fd=fs.openSync(events,'w',0o600); const write=record=>{fs.writeSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);};
  const report={schema:1,scope:'SQL-only 2x25 current Practice selector concurrency, not HTTP or capacity acceptance',
    started_at:stamp(),code_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    source_head:process.env.GITHUB_HEAD_SHA||null,waves:[],valid:false,selection_calls:0};
  const clients=[];let controlClient=null,monitorClient=null;
  try {
    const branch=process.env.PACK1_BENCHMARK_BRANCH,connection=process.env.DATABASE_URL,key=process.env.NEON_API_KEY;
    assert.ok(branch&&connection&&key&&process.env.PACK1_CLONE_CREATED==='true','Fresh verified clone only');
    const [record,endpoints]=await Promise.all([control('/branches/'+branch,key),control('/branches/'+branch+'/endpoints',key)]);
    const endpoint=verifyTarget({branch,connection,branchRecord:record.branch,endpoints:endpoints.endpoints||[]});
    const settings={min_cu:Number(endpoint.autoscaling_limit_min_cu),max_cu:Number(endpoint.autoscaling_limit_max_cu),
      suspend_seconds:Number(endpoint.suspend_timeout_seconds??endpoint.suspend_timeout)};
    assert.deepEqual(settings,{min_cu:.25,max_cu:8,suspend_seconds:300},'Exact 50-player compute settings required');
    assert.ok(!new URL(connection).hostname.includes('-pooler.'),'Direct session connection required');
    const created=Date.parse(record.branch.created_at),expiry=Date.parse(record.branch.expires_at);
    assert.ok(created>0&&expiry>created&&expiry-created<=11*60*1000,'Short-lived branch required');
    const diagnosticDeadline=created+7*60*1000;report.compute=settings;report.branch=branch;report.source_branch=PARENT;
    const remaining=()=>{if(Date.now()>diagnosticDeadline)throw Error('diagnostic_deadline_exceeded');};
    controlClient=openClient(connection,'control');monitorClient=openClient(connection,'monitor');
    await Promise.all([controlClient.connect(),monitorClient.connect()]);remaining();
    await pgQuery(controlClient,'CREATE EXTENSION IF NOT EXISTS plpgsql_check');
    const ext=await pgQuery(controlClient,"SELECT extversion FROM pg_extension WHERE extname='plpgsql_check'");
    assert.equal(ext.length,1,'Supported profiler required');
    const version=await pgQuery(controlClient,"SELECT current_setting('server_version') server_version,current_setting('work_mem') work_mem");
    report.database={...version[0],profiler_version:ext[0].extversion};
    const snapshot=await loadServingSnapshot(async(sql,params)=>({rows:await pgQuery(controlClient,sql,params)}),DRAFT_RUN_CORPUS_VERSION);
    assert.ok(snapshot?.id&&snapshot?.revision);
    const day=gameDateKey(),planned=actors(snapshot,day);
    report.input={snapshot_id:snapshot.id,revision:snapshot.revision,day,modes:planned.map(x=>({id:x.id,mode:x.mode,seed:x.seed,set_ids:x.setIds,plan_sha256:x.plan_hash}))};
    for(let i=0;i<LIMIT;i++)clients.push(openClient(connection,'actor-'+i));
    await Promise.all(clients.map(c=>c.connect()));
    const pids=(await Promise.all(clients.map(c=>pgQuery(c,'SELECT pg_backend_pid() pid')))).map(x=>Number(x[0].pid));
    assert.equal(new Set(pids).size,25,'Require 25 distinct PostgreSQL backend sessions');
    await Promise.all(clients.map(c=>pgQuery(c,"SET plpgsql_check.profiler='on'")));
    await Promise.all(clients.map(c=>pgQuery(c,"SET statement_timeout='12000ms'")));
    await Promise.all(clients.map(c=>pgQuery(c,"SELECT current_setting('plpgsql_check.profiler') enabled")));
    remaining();
    for(let n=1;n<=2;n++){
      report.selection_calls+=LIMIT; // fail-closed count even if later profiler retrieval fails
      const wave=await runWave(n,planned,clients,controlClient,monitorClient,pids,snapshot,day,write);
      report.waves.push(wave);
      fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
      if(!wave.valid_concurrency||wave.counts.errors)break;
      remaining();
    }
    report.valid=report.waves.length===2&&report.selection_calls===50&&report.waves.every(x=>x.valid_concurrency&&!x.counts.errors&&x.profiler.calls===25);
    report.finished_at=stamp();
    if(!report.valid)process.exitCode=1;
    console.log(JSON.stringify({valid:report.valid,selector_calls:report.selection_calls,
      waves:report.waves.map(x=>({n:x.wave,successes:x.counts.successes,p95_ms:x.latency.p95_ms,max_active:x.monitor.maxActive}))}));
  }catch(e){report.error=safeError(e);report.finished_at=stamp();process.exitCode=1;
    console.error(JSON.stringify({event:'diagnostic_stopped',category:report.error,selection_calls:report.selection_calls}));
  }finally{
    await Promise.allSettled([...clients,controlClient,monitorClient].filter(Boolean).map(c=>c.end()));
    report.finished_at=stamp();fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');fs.closeSync(fd);
  }
}
if(process.argv[2]==='--preflight')preflight().catch(e=>{console.error('Preflight failed: '+safeError(e));process.exitCode=1;});
else if(process.argv[2]==='--run')run();
else{console.error('Expected --preflight or --run');process.exitCode=1;}
