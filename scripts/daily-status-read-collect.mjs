// Read only the sanitized five cohort artifacts. Never unpack credential bundles.
import fs from 'node:fs';
import path from 'node:path';
import {quantiles} from './launch-distributed-core.mjs';
import {timingAttribution} from './daily-status-three-burst.mjs';

const ROOT='artifacts/daily-status-collected',OUT='artifacts/daily-status-timing';
const byBurst=['baseline','after_idle','immediate_repeat'];
function main() {
  fs.mkdirSync(OUT,{recursive:true});
  const files=fs.existsSync(ROOT)?fs.readdirSync(ROOT,{recursive:true})
    .filter(x=>/generator-[0-4]\.json$/.test(x)).map(x=>path.join(ROOT,x)):[];
  const reports=[],problems=[];
  for(const file of files) {
    const r=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!Number.isInteger(r.generator)||r.generator<0||r.generator>4||
       reports.some(x=>x.generator===r.generator))problems.push('duplicate_or_invalid_generator');
    else reports.push(r);
  }
  if(reports.length!==5)problems.push('incomplete_generators');
  const records=reports.flatMap(x=>x.records||[]);
  const networks=reports.map(x=>x.network_tag).filter(Boolean);
  if(new Set(networks).size!==5)problems.push('non_independent_egress');
  const requestCount=reports.reduce((n,x)=>n+(x.gateway_requests||0),0);
  const coordinatorCount=reports.reduce((n,x)=>n+(x.coordinator_queries||0),0);
  const responseBytes=reports.reduce((n,x)=>n+(x.response_bytes||0),0);
  // Edge readiness is bounded by its fixed 3-minute deadline / 2-second
  // interval: no more than 91 GETs. Each shard makes one health request.
  if(requestCount+91>300)problems.push('gateway_request_ceiling');
  if(coordinatorCount+15>1000)problems.push('coordinator_query_ceiling');
  if(responseBytes>16*1024*1024)problems.push('decoded_response_ceiling');
  if(reports.some(x=>(x.errors||[]).length))problems.push('runner_error');
  const groups=byBurst.map((name,index)=>{
    const rows=records.filter(x=>x.burst===name),
      times=rows.map(x=>x.dispatch_at_ms).filter(Number.isFinite),
      latencies=rows.filter(x=>x.status===200).map(x=>x.total_ms).filter(Number.isFinite),
      socket_counts=Object.fromEntries(['new','reused','unknown'].map(socket=>[socket,rows.filter(x=>x.socket===socket).length]));
    if(rows.length!==50)problems.push('incomplete_burst_'+index);
    if(rows.some(x=>x.status!==200||x.gateway_ms===null))problems.push('failed_or_missing_timing_'+index);
    return {burst:name,attempts:rows.length,successful:rows.filter(x=>x.status===200).length,
      dispatch_spread_ms:times.length===50?Math.max(...times)-Math.min(...times):null,
      synchronized_within_one_second:times.length===50&&Math.max(...times)-Math.min(...times)<=1000,
      start_ms:times.length?Math.min(...times):null,
      end_ms:rows.length?Math.max(...rows.map(x=>x.completed_at_ms||0)):null,
      latency_ms:quantiles(latencies),socket_counts};
  });
  const actualIdleMs=groups[0].end_ms&&groups[1].start_ms?groups[1].start_ms-groups[0].end_ms:null;
  const repeatGapMs=groups[1].end_ms&&groups[2].start_ms?groups[2].start_ms-groups[1].end_ms:null;
  if(actualIdleMs!==null&&actualIdleMs<120000)problems.push('idle_shorter_than_120_seconds');
  const branchCreated=reports.length?Date.parse(reports[0].branch_created_at):null;
  const finished=reports.length?Math.max(...reports.map(x=>Date.parse(x.finished_at)||0)):null;
  if(Number.isFinite(branchCreated)&&Number.isFinite(finished)&&finished-branchCreated>20*60000)
    problems.push('workload_deadline_exceeded');
  const slow=records.filter(x=>x.status===200&&x.total_ms>2000)
    .map(x=>({generator:x.generator,burst:x.burst,actor:x.actor,guest:x.guest,
      total_ms:x.total_ms,socket:x.socket,connect_ms:x.connect_ms,gateway_ms:x.gateway_ms,
      quota_ms:x.quota_ms,upstream_ms:x.upstream_ms,attribution:timingAttribution(x)}));
  const result={
    source_revision:process.env.GITHUB_SHA,
    run_id:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,
    result:problems.length?'incomplete_or_failed':slow.length?'slow_success_reproduced':'not reproduced',
    qualification:'none',prior_50_player_acceptance:'unchanged',players_100_qualified:false,
    differences:'50 isolated actor identities and three Daily-status GET bursts only; no game starts, eight-pick gameplay, read mix, scores, rerolls, or full acceptance workload',
    hard_limits:{measured_requests:150,total_gateway_max:300,coordinator_queries_max:1000,
      decoded_response_bytes_max:16*1024*1024,workload_minutes:20,branch_delete_minutes:25,
      runner_minutes_including_cleanup:57},
    usage:{measured_attempts:records.length,known_gateway_requests:requestCount,
      conservative_gateway_request_upper_bound:requestCount+91,coordinator_queries:coordinatorCount,
      coordinator_queries_upper_bound:coordinatorCount+15,decoded_response_bytes:responseBytes},
    bursts:groups,actual_idle_ms:actualIdleMs,immediate_repeat_gap_ms:repeatGapMs,
    dispatch_synchronization_missed:groups.some(x=>!x.synchronized_within_one_second),
    slow_successes:slow,errors:problems,
    samples:records,
    note:'Client total minus gateway duration is not a precise connection measurement. Gateway duration includes request handling only. Socket timing is measured only for new sockets.',
  };
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({event:'read_diagnostic_collected',result:result.result,
    measured:records.length,slow_successes:slow.length,errors:problems,
    dispatch_spreads:groups.map(x=>x.dispatch_spread_ms),known_gateway_requests:requestCount}));
  if(problems.length)process.exitCode=1;
}
try{main();}catch(error){
 fs.mkdirSync(OUT,{recursive:true});
 fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify({result:'collector_failed',error:'sanitized_collection_error'}));
 console.error(JSON.stringify({event:'read_diagnostic_collection_failed'}));process.exitCode=1;
}
