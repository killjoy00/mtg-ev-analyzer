// Fixed A/A + A/B confirmation. Only the disposable authenticated probe is used.
import {randomBytes} from 'node:crypto';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {runProbe,summarizeSamples,tailsImprove} from './quota-benchmark.mjs';
const assert=(ok,code)=>{if(!ok)throw Error(code);};
export const CONFIRMATION_PLAN=Object.freeze(['aa','ab','ab','aa']);
const COHORTS=8,CHUNKS=16,WIDTH=8,EXPECTED_CALLS=8256,MAX_CALLS=10000;
const METRICS=['client_p95','client_p99','handler_p95','handler_p99'];
const value=(row,key)=>{const [scope,p]=key.split('_');return row[scope][p+'_ms'];};
const stats=rows=>({client:summarizeSamples(rows.map(r=>r.client)),handler:summarizeSamples(rows.map(r=>r.handler))});
const difference=(left,right)=>Math.round((right-left)*100)/100;
const delta=(left,right)=>Object.fromEntries(METRICS.map(key=>[key,difference(value(left,key),value(right,key))]));
const quantile=(values,p)=>values.toSorted((a,b)=>a-b)[Math.max(0,Math.ceil(p*values.length)-1)];
function spread(values) {
  return {cohorts:values.length,median_delta_ms:quantile(values,.5),
    p95_absolute_delta_ms:quantile(values.map(Math.abs),.95),max_absolute_delta_ms:Math.max(...values.map(Math.abs)),
    apparent_regression_cohorts:values.filter(n=>n>0).length};
}
export function analyzeConfirmation(repeats) {
  assert(Array.isArray(repeats)&&repeats.length===4,'incomplete_confirmation_plan');
  for(let i=0;i<repeats.length;i++) {
    const row=repeats[i];assert(row.comparison===CONFIRMATION_PLAN[i]&&row.repeat===i+1&&row.cohorts?.length===COHORTS,'invalid_confirmation_sequence');
    assert(row.baseline.client.samples===1024&&row.right.client.samples===1024&&row.baseline.handler.samples===1024&&row.right.handler.samples===1024,'incomplete_confirmation_coverage');
    for(const cohort of row.cohorts)for(const side of ['baseline','right']) {
      assert(cohort[side].client.samples===128&&cohort[side].handler.samples===128,'incomplete_confirmation_coverage');
      for(const metric of METRICS)assert(Number.isFinite(value(cohort[side],metric))&&value(cohort[side],metric)>=0,'invalid_confirmation_metric');
    }
    for(const side of ['baseline','right'])for(const metric of METRICS)
      assert(Number.isFinite(value(row[side],metric))&&value(row[side],metric)>=0,'invalid_confirmation_metric');
  }
  const controls=repeats.filter(r=>r.comparison==='aa'),comparisons=repeats.filter(r=>r.comparison==='ab');
  const byMetric={};
  for(const metric of METRICS) {
    const aa=controls.flatMap(r=>r.cohorts.map(c=>difference(value(c.baseline,metric),value(c.right,metric))));
    const ab=comparisons.flatMap(r=>r.cohorts.map(c=>difference(value(c.baseline,metric),value(c.right,metric))));
    const noise=spread(aa);
    byMetric[metric]={control:noise,candidate:spread(ab),candidate_regressions_within_observed_control_p95:
      ab.filter(n=>n>0&&n<=noise.p95_absolute_delta_ms).length};
  }
  const originalGate=comparisons.map(r=>({repeat:r.repeat,improving_cohorts:r.cohorts.filter(c=>tailsImprove(c.baseline,c.right)).length,
    aggregate_tails_improve:tailsImprove(r.baseline,r.right)}));
  return {by_metric:byMetric,original_gate_per_ab_repeat:originalGate,
    latency_confirmation_passed:originalGate.every(r=>r.improving_cohorts>=6&&r.aggregate_tails_improve),
    production_ready:false,
    interpretation:'A/A measures observed variation, not improvement. Its expected failure to improve is not evidence that the old gate is invalid. Ranges are descriptive, not confidence bounds or permission to waive a regression. Every A/B repeat must independently meet the unchanged six-of-eight rule before full gameplay rehearsal.'};
}
export async function confirmQuotaLatency({url,key,fetcher=fetch,clock=performance.now.bind(performance),onRepeat=()=>{}}={}) {
  let requests=0;
  const repeats=[];
  const call=async(mode,cohort)=>{
    assert(++requests<=MAX_CALLS,'confirmation_request_budget_exceeded');
    const start=clock();let response;
    try {response=await fetcher(url+'/request',{method:'POST',redirect:'error',
      headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({mode,cohort,paired:true}),signal:AbortSignal.timeout(5000)});}
    catch(error){throw Error('confirmation_'+mode+'_'+(error?.name==='TimeoutError'?'deadline':error?.name==='AbortError'?'aborted':'transport'));}
    if(response.status!==204) {
      const raw=response.headers.get('x-quota-probe-denial'),cause=response.headers.get('x-quota-probe-auth')==='required'?
        (['key_unavailable','key_mismatch','expiry_unavailable','expired'].includes(raw)?raw:'probe_guard'):'edge';
      await response.body?.cancel();throw Error('confirmation_'+mode+'_http_'+response.status+(response.status===403?'_'+cause:''));
    }
    const client=clock()-start,header=name=>response.headers.get(name),handler=Number(header('x-pack1-quota-handler-ms')),
      writes=Number(header('x-quota-counter-write-total')),instance=header('x-quota-instance'),implementation=header('x-quota-implementation'),actor=header('x-quota-actor-instance');
    assert(header('x-pack1-quota-handler-ms')!==null&&Number.isFinite(handler)&&handler>=0&&Number.isFinite(client)&&client>=0&&
      header('x-quota-counter-write-total')!==null&&Number.isSafeInteger(writes)&&writes>=0&&/^[a-f0-9]{32}$/.test(instance||'')&&/^[a-f0-9]{32}$/.test(actor||''),'missing_confirmation_evidence');
    assert(implementation===(mode==='candidate'?'coalesced-preview':'per-request'),'wrong_confirmation_implementation');
    await response.body?.cancel();return {client,handler,writes,instance,actor};
  };
  for(let repeat=0;repeat<CONFIRMATION_PLAN.length;repeat++) {
    const comparison=CONFIRMATION_PLAN[repeat],right=comparison==='aa'?'control':'candidate',modes=['baseline',right],
      rows={baseline:[],right:[]},cold={baseline:[],right:[]},cohorts=[];
    let baselineWrites=0,rightWrites=0;
    for(let cohortIndex=0;cohortIndex<COHORTS;cohortIndex++) {
      const cohort=randomBytes(16).toString('hex'),local={baseline:[],right:[]},instances={},actors={},last={};
      const order=(cohortIndex+repeat)%2?[...modes].reverse():modes;
      for(const mode of order) {
        const row=await call(mode,cohort),slot=mode==='baseline'?'baseline':'right';
        assert(row.writes===1,'confirmation_cold_counter_mismatch');cold[slot].push(row.client);
        instances[mode]=row.instance;actors[mode]=row.actor;last[mode]=1;
      }
      assert(instances.baseline!==instances[right],'confirmation_wrappers_not_distinct');
      assert(actors.baseline===actors[right],'confirmation_actor_not_shared');
      for(let chunk=0;chunk<CHUNKS;chunk++)for(const mode of (chunk%2?[...order].reverse():order)) {
        const batch=await Promise.all(Array.from({length:WIDTH},()=>call(mode,cohort))),slot=mode==='baseline'?'baseline':'right';
        assert(batch.every(r=>r.instance===instances[mode]&&r.actor===actors.baseline),'confirmation_instance_restarted');
        const total=Math.max(...batch.map(r=>r.writes)),admissions=1+(chunk+1)*WIDTH;
        assert(total>=last[mode]&&total<=admissions,'confirmation_write_evidence_invalid');
        if(mode!=='candidate')assert(total===admissions,'confirmation_baseline_policy_mismatch');
        last[mode]=total;local[slot].push(...batch);rows[slot].push(...batch);
      }
      if(comparison==='ab')assert(last[right]<last.baseline/2,'confirmation_write_reduction_unverified');
      baselineWrites+=last.baseline;rightWrites+=last[right];
      const baseline=stats(local.baseline),rightStats=stats(local.right);
      cohorts.push({cohort:cohortIndex+1,baseline,right:rightStats,delta_ms:delta(baseline,rightStats)});
    }
    const row={repeat:repeat+1,comparison,right_implementation:comparison==='aa'?'per-request':'coalesced-preview',
      baseline:stats(rows.baseline),right:stats(rows.right),cold:{baseline:summarizeSamples(cold.baseline),right:summarizeSamples(cold.right)},
      counter_write_decisions:{baseline:baselineWrites,right:rightWrites},cohorts};
    repeats.push(row);onRepeat(structuredClone(row));
  }
  assert(requests===EXPECTED_CALLS,'confirmation_request_count_mismatch');
  return {source:'synthetic-quota-only',profile:'fixed-aa-ab-crossover-v2',placement:'same-actor-shared-counter',plan:[...CONFIRMATION_PLAN],requests,
    repetitions:repeats,analysis:analyzeConfirmation(repeats),production_ready:false,
    limitation:'Fixed same-actor crossover from one client region. Both modes share the unchanged quota counter; no resets or separated key spaces are used. P99 per cohort has 128 warm samples and is noisy. Control spread is descriptive and cannot establish the cause of an individual A/B regression. No thresholds or production settings are changed.'};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  try {
    console.log('SYNTHETIC_QUOTA_CONFIRMATION_PLAN '+JSON.stringify({sequence:CONFIRMATION_PLAN,cohorts_per_repeat:COHORTS,warm_per_side_per_cohort:CHUNKS*WIDTH,measured_calls:EXPECTED_CALLS,maximum_calls:MAX_CALLS}));
    let report;
    await runProbe(process.env,async options=>report=await confirmQuotaLatency({...options,onRepeat:row=>console.log('SYNTHETIC_QUOTA_CONFIRMATION_REPEAT '+JSON.stringify(row))}),'SYNTHETIC_QUOTA_CONFIRMATION');
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'latency_confirmation_passed='+String(report.analysis.latency_confirmation_passed)+'\n');
  } catch(error){console.error('Synthetic quota confirmation failed: '+(/^[a-z0-9_]+$/.test(error.message)?error.message:'details_withheld'));process.exitCode=1;}
}
