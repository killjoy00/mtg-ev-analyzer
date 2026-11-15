// Publish only predetermined, low-resolution diagnostic labels after the full
// private report has passed verified write/readback. No time ranges, paths,
// traces, network identifiers, request counts, timings, provider IDs, or
// untrusted data strings are allowed in the public classification.
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=1000000?value:null;
const band=value=>value===null?'unknown':value===0?'0':value<3?'1-2':value<10?'3-9':value<30?'10-29':'30+';
const issueWindows=[
  {issue:1272,window:'slow_requests_last_breach',kind:'requests'},
  {issue:1273,window:'slow_quota_last_breach',kind:'quota'},
];
const blank=(issue,reason='not_collected')=>({
  issue,outcome:reason,sample_band:'unknown',suspected_stage:'unknown',
  evidence:'insufficient',next_action:'await_verified_incident_evidence',
});
const stageChoice=(entries)=>{
  const sorted=[...entries].sort((a,b)=>b[1]-a[1]);
  const total=sorted.reduce((sum,[,value])=>sum+value,0);
  if(total<3||sorted[0][1]*3<total*2||sorted[0][1]===sorted[1][1])
    return 'mixed';
  return sorted[0][0];
};
// These labels report coarse association within retained slow cohorts, not
// trace-level identities, a representative latency distribution, or causality.
const trafficContext=(groups,total)=>{
  const keys=['gameplay','admin','account','other'];
  const values=keys.map(key=>count(groups?.[key]));
  if(values.some(value=>value===null))return 'unverified';
  const included=values.reduce((sum,value)=>sum+value,0);
  if(included>total||included<3||included*4<total*3)return 'unverified';
  const winner=stageChoice(keys.map((key,i)=>[key,values[i]]));
  return winner==='mixed'?'mixed':winner;
};
const quotaWaitSignal=(window,total,matched)=>{
  const retry=count(window.slow_with_retry),concurrent=count(window.matched_concurrent),
    cleanup=count(window.matched_cleanup_overlap);
  if(retry===null||concurrent===null||cleanup===null||
    retry>total||concurrent>matched||cleanup>matched)return 'unverified';
  // Retry is observed on all slow gateway calls; concurrency and cleanup
  // are only known for slow calls with matched handler completions.
  const candidates=[];
  if(retry>=3&&retry*3>=total*2)candidates.push('retry');
  if(concurrent>=3&&concurrent*3>=matched*2)candidates.push('handler_concurrency');
  if(cleanup>=3&&cleanup*3>=matched*2)candidates.push('cleanup_overlap');
  return candidates.length===1?candidates[0]:candidates.length?'multiple':'no_majority';
};
const quotaFlowProfile=(outcomes,total)=>{
  const keys=['successful_first_attempt','retried','denied_429','failed_5xx','other_or_unknown'];
  const values=keys.map(key=>count(outcomes?.[key]));
  if(values.some(value=>value===null)||values.reduce((sum,value)=>sum+value,0)!==total)return 'unverified';
  const winner=stageChoice(keys.map((key,i)=>[key,values[i]]));
  const labels={successful_first_attempt:'single_attempt_success',retried:'retries',
    denied_429:'rate_limit_denials',failed_5xx:'errors',other_or_unknown:'unverified',mixed:'mixed'};
  return labels[winner]||'unverified';
};
function classifyRequestWindow(window) {
  const issue=1272;
  if(window?.status==='skipped')return {...blank(issue),'outcome':'not_collected'};
  if(window?.status!=='collected')return blank(issue);
  const slow=window.slow_request_stages;
  const total=count(slow?.slow_retained);
  const d=slow?.dominant||{};
  const quota=count(d.quota),origin=count(d.origin),other=count(d.gateway_or_unmeasured);
  const base={...blank(issue,'insufficient_samples'),sample_band:band(total)};
  if(total===null||quota===null||origin===null||other===null||
    quota+origin+other>total)return blank(issue,'invalid_stage_evidence');
  if(total<3)return base;
  const attributable=quota+origin+other;
  if(attributable<3||attributable*4<total*3)
    return {...base,outcome:'stage_coverage_incomplete',next_action:'verify_gateway_stage_coverage'};
  const stage=stageChoice([['quota',quota],['origin',origin],['gateway_or_unmeasured',other]]);
  const traffic_context=trafficContext(slow.route_groups,total);
  if(stage==='mixed')
    return {...base,outcome:'mixed_stages',suspected_stage:'mixed',evidence:'directional',
      traffic_context,next_action:'compare_private_request_stage_cohorts'};
  const actions={quota:'inspect_quota_path',origin:'inspect_origin_backend',
    gateway_or_unmeasured:'inspect_gateway_residual'};
  return {...base,outcome:'dominant_observed_stage',suspected_stage:stage,
    evidence:total>=10?'moderate':'preliminary',traffic_context,next_action:actions[stage]};
}
function classifyQuotaWindow(window) {
  const issue=1273;
  if(window?.status==='skipped')return {...blank(issue),outcome:'not_collected'};
  if(window?.status!=='collected')return blank(issue);
  const total=count(window.slow_gateway_quota),matched=count(window.matched_slow),
    handler=count(window.slow_handler_dominant),wait=count(window.slow_residual_dominant);
  const base={...blank(issue,'insufficient_samples'),sample_band:band(total)};
  if(total===null||matched===null||handler===null||wait===null||
    matched>total||handler+wait>total)return blank(issue,'invalid_stage_evidence');
  if(total<3)return base;
  const measured=handler+wait;
  if(measured<3||measured*4<total*3)
    return {...base,outcome:'stage_coverage_incomplete',next_action:'verify_quota_handler_timing'};
  const stage=stageChoice([['quota_handler',handler],['quota_transport_wait',wait]]);
  if(stage==='mixed')
    return {...base,outcome:'mixed_stages',suspected_stage:'mixed',evidence:'directional',
      next_action:'compare_private_quota_stage_cohorts'};
  // Gateway timing may indicate the handler even without matched DO completion.
  // Only suggest a storage or dispatch investigation once enough completions
  // correlate; otherwise verify correspondence rather than blaming a provider.
  if(matched*3<total*2)
    return {...base,outcome:'correlation_incomplete',suspected_stage:stage,evidence:'preliminary',
      next_action:'verify_handler_completion_correlation'};
  let action=stage==='quota_transport_wait'?'inspect_quota_transport_dispatch':'inspect_quota_handler';
  const wait_signal=stage==='quota_transport_wait'?quotaWaitSignal(window,total,matched):undefined;
  const wait_profile=stage==='quota_transport_wait'?quotaFlowProfile(window.slow_outcomes,total):undefined;
  const traffic_context=stage==='quota_transport_wait'?trafficContext(window.slow_route_groups,total):undefined;
  if(stage==='quota_transport_wait') {
    const actions={retry:'inspect_retry_attempt_timing',
      handler_concurrency:'inspect_handler_concurrency_wait',
      cleanup_overlap:'inspect_quota_cleanup_overlap'};
    action=actions[wait_signal]||action;
    // A slow successful first attempt points to normal quota dispatch or
    // acknowledgement, not retry or 429 handling. The label remains a lead,
    // never a claim that a particular provider queue is at fault.
    if(action==='inspect_quota_transport_dispatch'&&wait_profile==='single_attempt_success')
      action='inspect_first_attempt_dispatch_or_ack';
  }
  if(stage==='quota_handler') {
    const durability=count(window.stages?.durability?.gt_1000ms);
    const transaction=count(window.stages?.transaction?.gt_1000ms);
    if(durability!==null&&transaction!==null&&durability>=2&&durability>transaction)
      action='inspect_quota_durability';
    else if(transaction!==null&&transaction>=2&&transaction>=(durability??0))
      action='inspect_quota_storage_transaction';
  }
  return {...base,outcome:'dominant_observed_stage',suspected_stage:stage,
    evidence:total>=10?'moderate':'preliminary',
    ...(wait_signal===undefined?{}:{wait_signal,wait_profile,traffic_context}),next_action:action};
}
export function publicLatencyTriage(report) {
  // Exact named incident windows only. Duplicate or malformed window names
  // must not be promoted into a confident public conclusion.
  const windows=Array.isArray(report?.windows)?report.windows:[];
  const findings=issueWindows.map(({issue,window,kind})=>{
    const candidates=windows.filter(w=>w?.window===window);
    if(candidates.length!==1)return blank(issue,'missing_or_duplicate_window');
    return kind==='requests'?classifyRequestWindow(candidates[0]):classifyQuotaWindow(candidates[0]);
  });
  return {version:1,interpretation:'observed_stages_not_root_cause',findings};
}
