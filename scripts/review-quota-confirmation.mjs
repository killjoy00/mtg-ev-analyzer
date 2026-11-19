// Offline only. Review retained synthetic results without issuing probe calls.
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {analyzeConfirmation,CONFIRMATION_PLAN} from './quota-latency-confirmation.mjs';
const assert=(ok,reason)=>{if(!ok)throw Error(reason);};
const rules=[
  {name:'client_p95',scope:'client',key:'p95_ms',strict:true},
  {name:'client_p99',scope:'client',key:'p99_ms',strict:false},
  {name:'handler_p95',scope:'handler',key:'p95_ms',strict:true},
  {name:'handler_p99',scope:'handler',key:'p99_ms',strict:false},
];
function failureReasons(baseline,right){
  return rules.flatMap(rule=>{
    const left=baseline[rule.scope][rule.key],candidate=right[rule.scope][rule.key];
    if(rule.strict?candidate<left:candidate<=left)return [];
    return [{metric:rule.name,baseline_ms:left,right_ms:candidate,
      delta_ms:Math.round((candidate-left)*100)/100,
      reason:candidate===left?'strict_improvement_tied':'measured_regression'}];
  });
}
export function reviewQuotaConfirmation(report){
  assert(report?.source==='synthetic-quota-only'&&report.profile==='fixed-aa-ab-crossover-v2'&&report.placement==='same-actor-shared-counter',
    'Unsupported retained experiment');
  assert(report.requests===8256&&JSON.stringify(report.plan)===JSON.stringify(CONFIRMATION_PLAN),'Incomplete retained request plan');
  const recomputed=analyzeConfirmation(report.repetitions);
  const retainedGate=report.analysis?.original_gate_per_ab_repeat;
  assert(report.production_ready===false&&report.analysis?.production_ready===false&&
    report.analysis?.latency_confirmation_passed===recomputed.latency_confirmation_passed&&
    Array.isArray(retainedGate)&&retainedGate.length===2&&recomputed.original_gate_per_ab_repeat.every((r,i)=>
      ['repeat','improving_cohorts','aggregate_tails_improve'].every(key=>retainedGate[i]?.[key]===r[key])),
    'Retained decision does not match the unchanged gate');
  const comparisons=report.repetitions.map(repeat=>{
    assert(new Set(repeat.cohorts.map(c=>c.cohort)).size===8&&repeat.cohorts.every(c=>Number.isInteger(c.cohort)&&c.cohort>=1&&c.cohort<=8),
      'Duplicate or invalid retained cohort identity');
    const writes=repeat.counter_write_decisions;
    assert(writes?.baseline===1032&&Number.isSafeInteger(writes.right)&&writes.right>0&&writes.right<=1032&&
      (repeat.comparison!=='aa'||writes.right===1032),'Invalid retained write decisions');
    const cohorts=repeat.cohorts.map(c=>({cohort:c.cohort,failed_criteria:failureReasons(c.baseline,c.right)}));
    return {repeat:repeat.repeat,comparison:repeat.comparison,improving_cohorts:cohorts.filter(c=>!c.failed_criteria.length).length,
      failed_cohorts:cohorts.filter(c=>c.failed_criteria.length),
      aggregate_failed_criteria:failureReasons(repeat.baseline,repeat.right),
      reported_counter_write_decisions:writes,
      reported_counter_write_reduction:repeat.comparison==='ab'?1-writes.right/writes.baseline:null};
  });
  return {schema:'offline-quota-confirmation-review-v1',source_profile:report.profile,requests_reexecuted:0,
    comparisons,unchanged_gate:recomputed.original_gate_per_ab_repeat,
    latency_confirmation_passed:recomputed.latency_confirmation_passed,production_ready:false,
    observed_control_spread:recomputed.by_metric,
    limitations:[
      'Ties fail a strict improvement criterion but are not measured regressions.',
      'Observed A/A spread is not a confidence interval and cannot waive a failed A/B criterion.',
      'Per-cohort p99 is based on 128 warm samples. The retained quantiles cannot reconstruct individual slow requests.',
      'The confirmation report does not retain per-request refill/credit, queue or durability decomposition; it cannot identify the cause of an individual regression.',
      'Counter-write decisions are synthetic measurements, not total billed operations, production CU-hours or verified cost savings.',
      'Passing this review never authorizes production activation; the original latency gate and subsequent correctness/gameplay protections remain required.',
    ]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const [input,output,...extra]=process.argv.slice(2);
    assert(input&&output&&!extra.length&&input!==output,'Provide distinct input and private output paths');
    const body=readFileSync(input);assert(body.length<=5*1024*1024,'Retained report exceeds review bound');
    const result=reviewQuotaConfirmation(JSON.parse(body.toString('utf8')));
    writeFileSync(output,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
    console.log('Offline quota confirmation review saved. No probe requests were issued; production remains disabled.');
  } catch {console.error('Offline quota review unavailable; private input and provider details withheld.');process.exitCode=1;}
}
