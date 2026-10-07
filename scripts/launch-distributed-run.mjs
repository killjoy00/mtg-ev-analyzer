import fs from 'node:fs';
import assert from 'node:assert/strict';
import {fingerprint,evaluateStage,timing,stageFailureEvidence} from './launch-distributed-core.mjs';
import {policy,verifyFixture,coordinatorSQL,heartbeat,storeReport,readReports,usageGate} from './launch-distributed-control.mjs';
import {seal} from './launch-distributed-bundle.mjs';
import {requestClient,runPlayerStage,wait} from './launch-distributed-player.mjs';
import {settlePreviewTelemetry,previewAccount,previewTelemetryFailure} from './launch-distributed-telemetry.mjs';

async function main() {
  const shard=Number(process.env.LOAD_SHARD),fixture=JSON.parse(fs.readFileSync(process.env.LOAD_FIXTURE_FILE,'utf8')),scope=fixture.scope;
  assert.ok(Number.isInteger(shard)&&shard>=0&&shard<policy.generators,'invalid_shard');
  assert.equal(scope.run_id,process.env.GITHUB_RUN_ID);assert.equal(scope.attempt,process.env.GITHUB_RUN_ATTEMPT);
  assert.equal(scope.policy_hash,fingerprint(policy));assert.equal(scope.sha,fixture.sha);
  await verifyFixture(fixture);
  const budget={gateway_requests:0,response_bytes:0,coordinator_queries:0},directory='artifacts/launch-load';fs.mkdirSync(directory,{recursive:true});
  const controller=new AbortController(),message={scope,shard,nonce:crypto.randomUUID(),ready:0,ack:null,done:null};
  let state=null,offset=0,clockReady=false,finished=false;
  const now=()=>Date.now()+offset;
  const sql=coordinatorSQL(fixture.connection,{onQuery:()=>{if(++budget.coordinator_queries>policy.maximum_coordinator_queries/policy.generators)throw Error('coordinator_query_ceiling');}});
  const client=requestClient({fixture,policy,budget,now,signal:controller.signal});
  const checkNetwork=async()=>{
    const {data,network}=await client(null,'health','/draft/health?quick=1');
    assert.equal(data.release_commit,scope.sha,'preview_release_changed');assert.match(network||'',/^[a-f0-9]{64}$/,'real_egress_missing');
    if(message.network)assert.equal(network,message.network,'real_egress_changed');else message.network=network;
  };
  await checkNetwork();
  const account=shard===0?await previewAccount():null;
  const failed=failure=>{if(!message.failure)message.failure=failure;controller.abort();};
  const saveReport=r=>fs.writeFileSync(`${directory}/distributed-${r.stage}-${shard}.json`,JSON.stringify({...r,network:undefined,egress:seal({network:r.network}),budget:{...budget}},null,2));
  const loop=(async()=>{
    while(!finished) {
      try {
        state=await heartbeat(sql,message,{onClock:({server,before,after})=>{
          if(after-before>2000)throw Error('coordinator_clock_uncertain');
          const next=server-(before+after)/2;
          if(clockReady&&Math.abs(next-offset)>1000)throw Error('coordinator_clock_shift');
          offset=next;clockReady=true;
        }});
        if(state.phase==='armed')message.ack=state.stage;
        if(state.phase==='aborted'){failed(state.failure);break;}
        if(state.phase==='complete')break;
      } catch {failed({category:'generator',reason:'coordinator_or_clock_failed'});break;}
      await wait(policy.heartbeat_seconds*1000);
    }
  })();
  const evidence=[];
  try {
    for(let stage=0;stage<policy.stages.length;stage++) {
      message.ready=stage;message.ack=null;message.done=null;delete message.decision;
      while(!state||state.stage!==stage||state.phase!=='released')await wait(100,controller.signal);
      const start=state.start_at;
      await checkNetwork();
      const report=await runPlayerStage({fixture,policy,scope,stage,shard,start_at:start,network:message.network,now,signal:controller.signal,client,onFailure:failed});
      saveReport(report);
      if(report.failures.length)throw Error('stage_failed');
      await checkNetwork();await storeReport(sql,report);message.done=stage;
      while(state.phase!=='checking')await wait(100,controller.signal);
      if(shard===0) {
        const reports=await readReports(sql,stage),networks=Object.fromEntries(Object.entries(state.cohort).map(([id,r])=>[id,r.network]));
        const summary=evaluateStage(reports,{scope,stage,start_at:start,networks},policy);
        if(summary.passed) {
          const end=timing(start,policy.stages[stage],policy).end;
          try {summary.telemetry=await settlePreviewTelemetry({reports,sha:scope.sha,from:start,to:end,policy,account,sleep:ms=>wait(ms,controller.signal)});}
          catch(error) {summary.telemetry={passed:false,reason:'retained_preview_api_or_schema_unavailable',detail:previewTelemetryFailure(error)};}
          try {summary.usage=await usageGate(fixture.usage_baseline);}
          catch {summary.usage={passed:false,reason:'provider_usage_unavailable'};}
          if(!summary.telemetry.passed)summary.reasons.push({category:'telemetry',reason:'retained_preview_coverage_failed'});
          if(!summary.usage.passed)summary.reasons.push({category:'cost',reason:'reported_project_usage_gate'});
        }
        summary.passed=summary.passed&&summary.reasons.length===0;
        console.log(JSON.stringify({stage_gate:stageFailureEvidence(summary)}));
        fs.writeFileSync(`${directory}/distributed-stage-${policy.stages[stage].players}.json`,JSON.stringify(summary,null,2));evidence.push(summary);
        message.decision={stage,passed:summary.passed,telemetry_passed:summary.telemetry?.passed===true,usage_passed:summary.usage?.passed===true,
          digest:fingerprint(summary),category:summary.reasons[0]?.category,reason:summary.reasons[0]?.reason};
      }
      while(state.stage===stage&&state.phase!=='aborted')await wait(100,controller.signal);
    }
    while(state?.phase!=='complete')await wait(100,controller.signal);
  } catch(e) {if(!message.failure)failed({category:'generator',reason:'runner_or_evidence_failed'});}
  finally {
    // Publish local failure once without retrying application mutations. A dead
    // transport is independently detected by the other runners' heartbeat lease.
    if(message.failure)try{state=await heartbeat(sql,message);}catch{}
    finished=true;await loop;
    fs.writeFileSync(`${directory}/cohort-${shard}.json`,JSON.stringify({scope,shard,budget,phase:state?.phase,history:state?.history||[],failure:message.failure||state?.failure||null,passed:state?.phase==='complete'},null,2));
  }
  if(state?.phase!=='complete')process.exitCode=1;
}
main().catch(error=>{console.error(JSON.stringify({error:'isolated_generator_setup_failed',code:error.code||null,line:String(error.stack).match(/launch-distributed-[a-z]+\.mjs:(\d+)/)?.[0]||null}));process.exitCode=1;});
