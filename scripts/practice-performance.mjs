// SQL/selector baseline or derived-cache comparison on a verified disposable clone. This does not measure Function/browser latency.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {checkBranch} from './edge-control.mjs';
import {selectDatabaseRun,loadCustomSetMetadata,loadPuzzleMetadata,selectCachedDatabaseRun,loadCachedCustomSetMetadata,loadServingSnapshot} from '../worker/draft-run-selection.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_SELECTION_VERSION} from '../draft-run-policy.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';
import {SERVING_POLICY_VERSION} from '../serving-quality.mjs';
import {gameDateKey} from '../game-date.mjs';

const PROJECT='patient-shadow-91417882';
const PRODUCTION='br-orange-feather-ayps8kep';
const elapsed=start=>Math.round((performance.now()-start)*100)/100;
const errorCode=error=>Number.isInteger(error?.status)?'http_'+error.status:
  error?.name==='TimeoutError'?'timeout':'query_or_selection_failed';

export function queryFamily(sql) {
  if(/pack1_serving_snapshot/.test(sql))return 'serving_snapshot';
  if(/draft_run_serving_revision/.test(sql))return 'revision_check';
  if(/count\(DISTINCT p\.source_draft_hash\)/i.test(sql))return 'custom_coverage';
  if(/GROUP BY p\.set_id,p\.pick_number,r\.band/i.test(sql))return 'group_counts';
  if(/WITH chosen AS/i.test(sql))return 'candidate_and_trajectory';
  if(/p\.puzzle_id=ANY/i.test(sql))return 'metadata_reload';
  if(/FROM draft_run_environment_policy p JOIN corpus_set_versions/i.test(sql))return 'live_set_metadata';
  return 'other';
}

export function summarize(values) {
  if(!values.length)return {samples:0,p50_ms:null,p95_ms:null,p99_ms:null};
  const sorted=[...values].sort((a,b)=>a-b),pct=p=>sorted[Math.ceil(sorted.length*p)-1];
  return {samples:sorted.length,p50_ms:pct(.5),p95_ms:pct(.95),p99_ms:pct(.99)};
}

export function recordQueries(query,{clock=()=>performance.now()}={}) {
  const records=[],statements=new Map();
  return {records,statements,query:async(sql,params=[])=>{
    const family=queryFamily(sql),started=clock();
    if(!statements.has(family))statements.set(family,{sql,params:[...params]});
    try {
      const result=await query(sql,params);
      records.push({family,ms:Math.round((clock()-started)*100)/100,rows:result.rows.length,ok:true});
      return result;
    } catch(error) {
      records.push({family,ms:Math.round((clock()-started)*100)/100,ok:false,error:errorCode(error)});
      throw error;
    }
  }};
}

// A caller-supplied branch label alone is not sufficient: verify the connection
// against control-plane endpoint ownership before any SQL is sent.
export function verifyTarget({branch,connection,branchRecord,endpoints}) {
  checkBranch(branch);
  const url=new URL(connection);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname.endsWith('.neon.tech')||url.pathname!=='/pack1')throw Error('Invalid benchmark database.');
  if(branchRecord?.id!==branch||branchRecord.parent_id!==PRODUCTION)throw Error('Require a disposable production clone.');
  const host=url.hostname.replace('-pooler.','.');
  const endpoint=endpoints.find(e=>e.branch_id===branch&&e.type==='read_write'&&e.host===host);
  if(!endpoint)throw Error('Database endpoint does not belong to the disposable branch.');
  return endpoint;
}

function sqlQuery(connection) {
  const url=new URL(connection),parts=url.hostname.split('.');parts[0]='api';
  const endpoint='https://'+parts.join('.')+'/sql';
  return async(sql,params=[])=>{
    // All statements are repository-owned SELECTs, or EXPLAINs of those SELECTs.
    if(!/^(SELECT\b|WITH chosen AS\b|EXPLAIN \(ANALYZE, BUFFERS, FORMAT JSON\) (SELECT\b|WITH chosen AS\b))/i.test(sql.trim()))throw Error('Benchmark only permits read queries.');
    const response=await fetch(endpoint,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
      headers:{'content-type':'application/json','Neon-Connection-String':connection,'Neon-Raw-Text-Output':'true','Neon-Array-Mode':'true'},
      body:JSON.stringify({query:sql,params:params.map(value=>value==null?null:String(value))}),
    });
    if(!response.ok)throw Object.assign(Error('Benchmark SQL request failed.'),{status:response.status});
    const data=await response.json(),names=(data.fields||[]).map(field=>field.name);
    return {rows:(data.rows||[]).map(row=>Object.fromEntries(row.map((value,i)=>[names[i],value])))};
  };
}

export async function main() {
  const branch=process.env.PACK1_BENCHMARK_BRANCH,connection=process.env.DATABASE_URL,key=process.env.NEON_API_KEY;
  checkBranch(branch);
  if(!connection||!key)throw Error('Benchmark credentials are missing.');
  const repetitions=Number(process.env.PACK1_BENCHMARK_SAMPLES||3);
  if(!Number.isInteger(repetitions)||repetitions<1||repetitions>10)throw Error('Choose 1 to 10 repetitions.');
  const root=path.resolve('artifacts/practice-performance');fs.mkdirSync(root,{recursive:true});
  const control=async route=>{
    const response=await fetch('https://console.neon.tech/api/v2/projects/'+PROJECT+route,{
      headers:{authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(30000),
    });
    if(!response.ok)throw Error('Benchmark target verification failed.');
    return response.json();
  };
  const [branchData,endpointData]=await Promise.all([control('/branches/'+branch),control('/branches/'+branch+'/endpoints')]);
  const endpoint=verifyTarget({branch,connection,branchRecord:branchData.branch,endpoints:endpointData.endpoints||[]});
  const cached=process.env.PACK1_BENCHMARK_CACHE==='1';
  if(cached)for(const migration of ['0039_practice_serving_cache.sql','0041_corpus_source_snapshots.sql','0042_serving_revision_snapshot_staging.sql'])execFileSync('psql',['-X','-d',connection,'-v','ON_ERROR_STOP=1','-f','migrations/'+migration],{
    env:process.env,stdio:['ignore','ignore','pipe'],timeout:120000,
  });
  const query=sqlQuery(connection),day=gameDateKey();
  const report={schema_version:1,scope:'serial SQL-over-HTTP selector and metadata reload; not API, browser, cold-start or capacity evidence',
    code_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),head_sha:process.env.PACK1_BENCHMARK_HEAD_SHA||null,
    branch,source_branch:PRODUCTION,started_at:new Date().toISOString(),day,
    versions:{corpus:DRAFT_RUN_CORPUS_VERSION,selection:DRAFT_RUN_SELECTION_VERSION,difficulty:DRAFT_RUN_DIFFICULTY_VERSION,serving:SERVING_POLICY_VERSION},
    compute:{autoscaling_limit_min_cu:endpoint.autoscaling_limit_min_cu,autoscaling_limit_max_cu:endpoint.autoscaling_limit_max_cu,suspend_timeout_seconds:endpoint.suspend_timeout_seconds??endpoint.suspend_timeout??null},
    cached,repetitions,discovery:null,cases:[],plans:[],ok:false};
  const plans=new Map();
  const capture=(prefix,recorder)=>{
    for(const [family,statement] of recorder.statements)if(['group_counts','custom_coverage','candidate_and_trajectory'].includes(family))plans.set(prefix+'-'+family,statement);
  };
  try {
    report.database=(await query("SELECT current_setting('server_version') server_version,current_setting('work_mem') work_mem,current_database() database")).rows[0];
    // Activity counters reset on a fresh Neon branch. Planner reltuples survive
    // the clone and are the useful estimate; keep zeroed counters separately.
    report.table_estimates=(await query("SELECT s.relname,c.reltuples::bigint::text estimated_rows,s.n_live_tup::text branch_activity_live_rows,s.last_analyze::text,s.last_autoanalyze::text FROM pg_stat_user_tables s JOIN pg_class c ON c.oid=s.relid WHERE s.schemaname='public' AND s.relname IN ('draft_run_verified_puzzles','draft_run_puzzle_ratings','corpus_components','corpus_source_exclusions') ORDER BY s.relname")).rows;
    if(cached) {
      const start=performance.now(),snapshot=await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION);
      report.cache_build={ms:elapsed(start),id:snapshot.id,revision:snapshot.revision,groups:snapshot.groups.length};
      report.cache_storage=(await query("SELECT pg_total_relation_size('draft_run_serving_inventory')::text inventory_bytes,(SELECT count(*) FROM draft_run_serving_inventory)::text rows")).rows[0];
    }
    const discovery=recordQueries(query),started=performance.now();
    const custom=await (cached?loadCachedCustomSetMetadata:loadCustomSetMetadata)(discovery.query,DRAFT_RUN_CORPUS_VERSION,day);
    const discoveryMs=elapsed(started);
    if(cached) {
      const original=await loadCustomSetMetadata(query,DRAFT_RUN_CORPUS_VERSION,day);
      assert.deepEqual(custom,original,'Cached custom-set metadata differs.');
    }
    report.discovery={ms:discoveryMs,set_ids:custom.map(s=>s.set_id),queries:discovery.records};capture('practice-sets',discovery);
    if(custom.length<2)throw Error('Need two eligible custom sets to cover all benchmark cases.');
    const cases=[{name:'mixed',environment:'mixed',setIds:[]},{name:'powered-cube',environment:'powered-cube',setIds:[]},
      {name:'custom-single',environment:'mixed',setIds:[custom[0].set_id]},
      {name:'custom-multi',environment:'mixed',setIds:custom.slice(0,3).map(s=>s.set_id)}];
    // One first-observed sample plus repeated serial samples. No idle claim:
    // target checks/discovery have already touched compute before these samples.
    for(const configuration of cases) {
      const entry={...configuration,samples:[]};report.cases.push(entry);
      for(let i=0;i<=repetitions;i++) {
        const seed='practice-baseline-v1:'+configuration.name+':'+i,recorder=recordQueries(query),start=performance.now();
        const sample={seed,phase:i===0?'first_observed':'repeat',queries:recorder.records,ok:false};entry.samples.push(sample);
        try {
          const selected=await (cached?selectCachedDatabaseRun:selectDatabaseRun)(recorder.query,DRAFT_RUN_CORPUS_VERSION,seed,configuration.environment,{day,setIds:configuration.setIds});
          sample.selection_ms=elapsed(start);
          const ids=selected.map(p=>p.puzzle_id),reloaded=cached?selected:await loadPuzzleMetadata(recorder.query,DRAFT_RUN_CORPUS_VERSION,ids);
          sample.selection_and_reload_ms=elapsed(start);
          if(ids.length!==8||new Set(selected.map(p=>p.source_draft_hash)).size!==8||reloaded.some(p=>!p))throw Error('Invalid benchmark selection.');
          sample.puzzle_ids=ids;sample.selection_fingerprint=createHash('sha256').update(JSON.stringify(ids)).digest('hex');sample.ok=true;
          if(i===0)capture(configuration.name,recorder);
          if(cached) {
            const baselineStart=performance.now();
            const baseline=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seed,configuration.environment,{day,setIds:configuration.setIds});
            sample.live_selection_ms=elapsed(baselineStart);
            sample.exact_parity=JSON.stringify(baseline)===JSON.stringify(selected);
            if(!sample.exact_parity)throw Error('Cached selection metadata or RNG parity mismatch.');
          }
        } catch(error) {sample.error=errorCode(error);throw error;}
        finally {sample.elapsed_ms=elapsed(start);}
      }
      entry.repeat_summary=summarize(entry.samples.filter(s=>s.phase==='repeat').map(s=>s.selection_and_reload_ms));
    }
    // Plans run after the timing samples, so EXPLAIN ANALYZE does not prime them.
    for(const [name,{sql,params}] of plans) {
      const result=await query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,params);
      const raw=result.rows[0]?.['QUERY PLAN'];
      const plan=typeof raw==='string'?JSON.parse(raw):raw;
      fs.writeFileSync(path.join(root,name+'.plan.json'),JSON.stringify(plan,null,2)+'\n');
      report.plans.push(name+'.plan.json');
    }
    report.ok=true;
  } catch(error) {report.error=errorCode(error);throw error;}
  finally {
    report.finished_at=new Date().toISOString();
    fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2)+'\n');
  }
  console.log('Practice SQL baseline saved; '+report.cases.length+' cases, '+report.plans.length+' plans.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{
  // Provider errors may contain connection details. The artifact contains only
  // coarse error classes, and credentials are never written to logs or artifacts.
  console.error('Practice benchmark failed; inspect the sanitized report and target configuration.');process.exitCode=1;
});
