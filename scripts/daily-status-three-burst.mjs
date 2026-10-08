// A single persistent runner per independent egress; 10 concurrent GETs per burst.
// All barriers use the isolated Neon SQL endpoint, never the preview gateway.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {policy as originalPolicy,coordinatorSQL} from './launch-distributed-control.mjs';
import {requestClient} from './launch-distributed-player.mjs';

export const DIAGNOSTIC=Object.freeze({
  generators:5,actors_per_generator:10,bursts:3,measured_requests:150,
  gateway_request_ceiling:300,coordinator_query_ceiling:1000,response_byte_ceiling:16*1024*1024,
  request_timeout_ms:30000,idle_ms:120000,baseline_lead_ms:5000,subsequent_lead_ms:2500,
  branch_workload_deadline_ms:20*60000,branch_delete_deadline_ms:25*60000,
  connection_min_cu:0.25,connection_max_cu:8,suspend_seconds:300,
});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const actorsForShard=(fixture,shard)=>{
  assert.ok(Number.isInteger(shard)&&shard>=0&&shard<5);
  assert.equal(fixture.users?.length,50);
  return fixture.users.slice(shard*10,(shard+1)*10).map((user,i)=>{
    assert.equal(user.id,shard*10+i);
    assert.equal(user.guest,i<5);
    assert.match(user.token,/^p1_[0-9a-f-]+\.[A-Za-z0-9_-]+$/);
    const cookies=new Map([['__Host-pack1_player',user.token]]);
    if(!user.guest) {
      assert.ok(user.account&&user.csrf);
      cookies.set('__Host-pack1_account',user.account);
      cookies.set('__Secure-pack1_csrf',user.csrf);
    }
    return {id:user.id,guest:user.guest,cookies,csrf:user.guest?null:user.csrf,request_sequence:0};
  });
};
export function sanitized(record,burst,shard,guest) {
  const gateway=record?.diagnostics?.gateway||{};
  const transport=record?.transport||{};
  const duration=(x)=>Number.isFinite(x)&&x>=0?Math.round(x*100)/100:null;
  return {generator:shard,burst,actor:record.actor,guest,dispatch_at_ms:record.dispatch_at_ms,
    status:record.status,total_ms:duration(record.ms),
    socket:['new','reused','unknown'].includes(transport.socket)?transport.socket:'unknown',
    connect_ms:duration(transport.connect_ms),
    gateway_ms:duration(gateway.duration_ms),quota_ms:duration(gateway.quota_ms),
    upstream_ms:duration(gateway.upstream_ms),
    failure:record.failure||null,
    transport_failure:record.status===0?transport.label||'unknown':null};
}
export function timingAttribution(row) {
  if(row.status!==200)return 'failed_request';
  if(row.total_ms===null||row.total_ms<=2000)return 'within_reference';
  const connection=row.connect_ms!==null&&row.connect_ms>=1000;
  const gateway=row.gateway_ms!==null&&row.gateway_ms>=1000;
  return connection&&gateway?'connection_and_gateway':connection?'substantial_connection':
    gateway?'substantial_gateway':'unattributed';
}

const elapsedOrFail=fixture=>{
  const age=Date.now()-fixture.created_at;
  if(age<0||age>DIAGNOSTIC.branch_workload_deadline_ms)throw Error('workload_20_minute_deadline');
  return age;
};
async function initialize() {
  if(process.env.PREVIEW_CREATED!=='true')throw Error('fresh_branch_required');
  const fixture=JSON.parse(fs.readFileSync(process.env.LOAD_FIXTURE_FILE,'utf8'));
  if(fixture.sha!==process.env.GITHUB_SHA||fixture.branch!==process.env.PREVIEW_BRANCH)throw Error('fixture_revision_or_branch_mismatch');
  elapsedOrFail(fixture);
  for(let shard=0;shard<5;shard++)actorsForShard(fixture,shard);
  const sql=coordinatorSQL(fixture.connection);
  await sql('CREATE TABLE pack1_load_reports_v2(stage integer NOT NULL,shard integer NOT NULL,report jsonb NOT NULL,PRIMARY KEY(stage,shard))');
  fs.mkdirSync('artifacts/daily-status-timing',{recursive:true});
  fs.writeFileSync('artifacts/daily-status-timing/init.json',JSON.stringify({
    source_revision:fixture.sha,branch_created_at:new Date(fixture.created_at).toISOString(),
    actors:50,expected_bursts:3,expected_requests:150,
    guest_count:25,signed_in_count:25,fixture_prep:'50 identities only; zero synthetic score rows; no gameplay',
    gateway_max_requests:300,coordinator_max_queries:1000,response_bytes_max:16*1024*1024,
    workload_deadline_minutes:20,branch_delete_deadline_minutes:25
  },null,2));
  console.log(JSON.stringify({event:'read_burst_barrier_initialized',actors:50,bursts:3,measured_requests:150}));
}
async function run() {
  const shard=Number(process.env.LOAD_SHARD);
  const fixture=JSON.parse(fs.readFileSync(process.env.LOAD_FIXTURE_FILE,'utf8'));
  assert.equal(fixture.sha,process.env.GITHUB_SHA,'source_sha');
  assert.equal(fixture.branch,process.env.PREVIEW_BRANCH,'branch_isolation');
  const actors=actorsForShard(fixture,shard);
  let coordinator_queries=0;
  const sql=coordinatorSQL(fixture.connection,{onQuery:()=>{
    if(++coordinator_queries>180)throw Error('coordinator_query_ceiling');
  }});
  const clientBudget={gateway_requests:0,response_bytes:0};
  // Existing transport observer, Undici dispatcher, client record and 30-second timeout.
  const client=requestClient({fixture,policy:{...originalPolicy,generators:5,maximum_requests:300,
    telemetry_preflight_requests:0,maximum_response_bytes:16*1024*1024},budget:clientBudget,
    now:Date.now,signal:new AbortController().signal,request_timeout_ms:30000});
  const records=[],bursts=[],errors=[];
  let network_tag=null;
  const folder='artifacts/daily-status-timing';fs.mkdirSync(folder,{recursive:true});
  const save=()=>fs.writeFileSync(folder+'/generator-'+shard+'.json',JSON.stringify({
    tested_revision:fixture.sha,branch_created_at:new Date(fixture.created_at).toISOString(),
    generator:shard,network_tag,read_only:true,records,bursts,errors,
    gateway_requests:clientBudget.gateway_requests,response_bytes:clientBudget.response_bytes,
    coordinator_queries,finished_at:new Date().toISOString()
  },null,2));
  const fail=x=>{const name=String(x?.message||x);errors.push(/^[a-z_0-9:-]{1,90}$/.test(name)?name:'diagnostic_failed');};
  try {
    elapsedOrFail(fixture);
    // Exactly one preview health request per generator, before the baseline burst.
    const health=await client(null,'health','/draft/health?quick=1');
    if(health.data?.release_commit!==fixture.sha||!/^[a-f0-9]{64}$/.test(health.network||''))
      throw Error('preview_revision_or_egress_invalid');
    network_tag=createHash('sha256').update(fixture.sha+health.network).digest('hex').slice(0,16);
    await sql("INSERT INTO pack1_load_reports_v2(stage,shard,report) VALUES(-1,$1::integer,jsonb_build_object('network',$2::text,'ready_at',round(extract(epoch FROM clock_timestamp())*1000)::bigint))",[shard,health.network]);

    const barrier=async(stage)=>{
      while(true) {
        elapsedOrFail(fixture);
        const before=Date.now();
        const rows=await sql("SELECT count(*)::integer n,count(DISTINCT report->>'network')::integer networks,MAX((report->>CASE WHEN $1::integer=-1 THEN 'ready_at' ELSE 'closed_at' END)::bigint) completed_max,COALESCE(SUM((report->>'errors')::integer),0)::integer errors,(extract(epoch FROM clock_timestamp())*1000)::bigint now_ms FROM pack1_load_reports_v2 WHERE stage=$1::integer",[stage]);
        const after=Date.now(),row=rows[0];
        if(Number(row.n)===5) {
          if(stage===-1&&Number(row.networks)!==5)throw Error('non_independent_egress');
          if(stage!==-1&&Number(row.errors)!==0)throw Error('earlier_burst_request_failure');
          return {done_at:Number(row.completed_max),offset:Number(row.now_ms)-(before+after)/2,query_rtt_ms:after-before};
        }
        await sleep(1250);
      }
    };
    for(let burst=0;burst<3;burst++) {
      const prior=await barrier(burst-1);
      const start=prior.done_at+(burst===0?5000:burst===1?120000+2500:2500);
      // The full idle interval starts at the LAST baseline completion among all runners.
      // Only isolated coordinator SQL polls run while waiting; no gateway GETs or warming.
      while(Date.now()+prior.offset<start) {
        elapsedOrFail(fixture);
        await sleep(Math.min(200,Math.max(1,start-(Date.now()+prior.offset))));
      }
      const phase=burst===0?'baseline':burst===1?'after_idle':'immediate_repeat';
      const report={requests:[]},issued=[];
      const settled=await Promise.allSettled(actors.map(async actor=>{
        const index=report.requests.length,dispatched=Date.now();
        issued.push(dispatched);
        try {
          const response=await client(actor,'read','/draft/v1/daily-status',undefined,{report});
          if(!response.data||response.data.player?.claimed!==!actor.guest)
            throw Error('fixture_identity_incorrect');
        } catch(e) {
          const record=report.requests[index];
          if(record)record.failure=/^[a-z_0-9:-]{1,90}$/.test(String(e?.message||''))?e.message:'request_failure';
          throw e;
        } finally {
          const record=report.requests[index];
          if(record){record.dispatch_at_ms=dispatched;record.burst=phase;}
        }
      }));
      const rows=report.requests.map(r=>sanitized(r,phase,shard,actors.find(a=>a.id===r.actor)?.guest??null));
      records.push(...rows);
      const failed=settled.filter(x=>x.status==='rejected').length+
        rows.filter(x=>x.status!==200||x.gateway_ms===null).length;
      const burstReport={burst:phase,index:burst,start_at_ms:start,
        first_dispatch_ms:Math.min(...issued),last_dispatch_ms:Math.max(...issued),
        local_dispatch_spread_ms:Math.max(...issued)-Math.min(...issued),
        completed:rows.length,failures:failed,query_clock_rtt_ms:prior.query_rtt_ms,
        ended_at_ms:Date.now()};
      bursts.push(burstReport);
      save(); // Durable sanitized evidence before any next barrier or failure.
      // Publish after all ten already-issued requests settle, even on failure.
      await sql("INSERT INTO pack1_load_reports_v2(stage,shard,report) VALUES($1::integer,$2::integer,jsonb_build_object('closed_at',round(extract(epoch FROM clock_timestamp())*1000)::bigint,'errors',$3::integer))",[burst,shard,failed]);
      if(failed)throw Error('burst_failed_no_retry');
    }
  } catch(e) {fail(e);save();process.exitCode=1;}
  finally {save();}
  if(records.length!==30||bursts.length!==3||errors.length)process.exitCode=1;
}
async function main() {
 const action=process.argv[2];
 if(action==='init')return initialize();
 if(action==='run')return run();
 throw Error('unknown_read_diagnostic_action');
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
  main().catch(error=>{console.error(JSON.stringify({event:'read_diagnostic_failed',code:/^[a-z_0-9:-]{1,90}$/.test(error.message)?error.message:'runner_failure'}));process.exitCode=1;});
