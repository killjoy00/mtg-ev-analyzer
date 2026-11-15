import test from 'node:test';
import assert from 'node:assert/strict';
import {publicLatencyTriage} from '../scripts/quota-forensic-triage.mjs';

const requestWindow=(slow,dominant,extra={})=>({
  window:'slow_requests_last_breach',status:'collected',
  slow_request_stages:{slow_retained:slow,dominant,...extra},
});
const quotaWindow=(slow,handler,transport,matched,extra={})=>({
  window:'slow_quota_last_breach',status:'collected',
  slow_gateway_quota:slow,matched_slow:matched,
  slow_handler_dominant:handler,slow_residual_dominant:transport,
  stages:{durability:{gt_1000ms:0},transaction:{gt_1000ms:0}},...extra,
});
const read=windows=>publicLatencyTriage({windows}).findings;
test('request diagnosis is conservative and chooses quota, origin and gateway bottlenecks only with verified stage coverage',()=>{
  for(const [stage,dominant,action] of [
    ['quota',{quota:8,origin:1,gateway_or_unmeasured:1},'inspect_quota_path'],
    ['origin',{quota:1,origin:8,gateway_or_unmeasured:1},'inspect_origin_backend'],
    ['gateway_or_unmeasured',{quota:1,origin:1,gateway_or_unmeasured:8},'inspect_gateway_residual'],
  ]){
    const f=read([requestWindow(10,dominant)])[0];
    assert.deepEqual([f.outcome,f.suspected_stage,f.next_action,f.evidence,f.sample_band],
      ['dominant_observed_stage',stage,action,'moderate','10-29']);
  }
  const low=read([requestWindow(3,{quota:2,origin:1,gateway_or_unmeasured:0})])[0];
  assert.equal(low.evidence,'preliminary');
  assert.equal(low.suspected_stage,'quota');
  const mixed=read([requestWindow(6,{quota:2,origin:2,gateway_or_unmeasured:2})])[0];
  assert.equal(mixed.outcome,'mixed_stages');assert.equal(mixed.suspected_stage,'mixed');
});
test('no slow events, missing timings, underfilled coverage and malformed measurements never imply a fix',()=>{
  const variants=[
    [requestWindow(0,{quota:0,origin:0,gateway_or_unmeasured:0}),'insufficient_samples'],
    [requestWindow(4,{quota:1,origin:1,gateway_or_unmeasured:0}),'stage_coverage_incomplete'],
    [requestWindow(3,{quota:3,origin:1,gateway_or_unmeasured:0}),'invalid_stage_evidence'],
    [requestWindow(5,{quota:-1,origin:2,gateway_or_unmeasured:3}),'invalid_stage_evidence'],
    [requestWindow('5',{quota:5,origin:0,gateway_or_unmeasured:0}),'invalid_stage_evidence'],
    [requestWindow(4,{quota:4,origin:null,gateway_or_unmeasured:0}),'invalid_stage_evidence'],
  ];
  for(const [window,outcome] of variants){
    const f=read([window])[0];
    assert.equal(f.outcome,outcome);assert.equal(f.suspected_stage,'unknown');
  }
});
test('quota diagnosis attributes gateway timing but requires matched completions for targeted actions',()=>{
  const h=read([quotaWindow(9,7,2,7)])[1];
  assert.equal(h.suspected_stage,'quota_handler');assert.equal(h.evidence,'preliminary');
  assert.equal(h.next_action,'inspect_quota_handler');
  const t=read([quotaWindow(10,1,9,9)])[1];
  assert.equal(t.suspected_stage,'quota_transport_wait');
  assert.equal(t.next_action,'inspect_quota_transport_dispatch');
  const partial=read([quotaWindow(9,7,2,2)])[1];
  assert.equal(partial.outcome,'correlation_incomplete');
  assert.equal(partial.next_action,'verify_handler_completion_correlation');
  const mixed=read([quotaWindow(6,3,3,6)])[1];
  assert.equal(mixed.suspected_stage,'mixed');
  assert.equal(mixed.next_action,'compare_private_quota_stage_cohorts');
  const uncovered=read([quotaWindow(8,2,1,3)])[1];
  assert.equal(uncovered.outcome,'stage_coverage_incomplete');
  assert.equal(uncovered.next_action,'verify_quota_handler_timing');
});
test('matched durable-object stages distinguish durability and transaction, not arbitrary data',()=>{
  const d=read([quotaWindow(10,9,1,9,{stages:{durability:{gt_1000ms:5},transaction:{gt_1000ms:1}}})])[1];
  assert.equal(d.next_action,'inspect_quota_durability');
  const t=read([quotaWindow(10,9,1,9,{stages:{durability:{gt_1000ms:1},transaction:{gt_1000ms:6}}})])[1];
  assert.equal(t.next_action,'inspect_quota_storage_transaction');
  const invalid=read([quotaWindow(10,9,1,9,{stages:{durability:{gt_1000ms:'100'},transaction:{gt_1000ms:-1}}})])[1];
  assert.equal(invalid.next_action,'inspect_quota_handler');
  const bad=read([quotaWindow(3,3,1,3)])[1];
  assert.equal(bad.outcome,'invalid_stage_evidence');
});
test('skipped, duplicated and absent windows never read as recovered or dominant',()=>{
  const skip=read([{window:'slow_requests_last_breach',status:'skipped',reason:'outside_configured_retention'},
    {window:'slow_quota_last_breach',status:'skipped',reason:'incident_closed'}]);
  assert.ok(skip.every(f=>f.outcome==='not_collected'));
  const missing=read([]);
  assert.ok(missing.every(f=>f.outcome==='missing_or_duplicate_window'));
  const duplicate=read([requestWindow(3,{quota:3,origin:0,gateway_or_unmeasured:0}),
    requestWindow(3,{quota:3,origin:0,gateway_or_unmeasured:0})]);
  assert.equal(duplicate[0].outcome,'missing_or_duplicate_window');
  const malformed=read([quotaWindow(3,3,0,4)])[1];
  assert.equal(malformed.outcome,'invalid_stage_evidence');
});
test('public output is fixed, bounded, safe and never reflects private identifiers or timestamps',()=>{
  const privateFields={
    trace:'deadbeef'.repeat(4),account:'secret-account',ip_address:'192.0.2.55',
    user_id:'private-user',network_key:'network-secret',route:'/private/card/123',
    private_url:'https://private.invalid/path',someDangerousString:'injection',
  };
  const first=requestWindow(16,{quota:15,origin:0,gateway_or_unmeasured:1},privateFields);
  const second=quotaWindow(16,16,0,16,{...privateFields});
  const report={windows:[first,second,{window:'evil-actor-controlled-window',...privateFields}],...privateFields};
  const text=JSON.stringify(publicLatencyTriage(report));
  for(const secret of Object.values(privateFields))assert.ok(!text.includes(secret),secret);
  assert.deepEqual(publicLatencyTriage(report).findings.map(f=>f.issue),[1272,1273]);
  assert.ok(text.length<950);
  assert.equal(publicLatencyTriage(report).interpretation,'observed_stages_not_root_cause');
  assert.ok(!/\d{4}-\d\d-\d\d|p95|samples_count|url|trace|route/.test(text));
});

test('slow request traffic classification distinguishes admin from gameplay only with credible coverage',()=>{
  for(const [name,groups] of [
    ['admin',{gameplay:1,admin:8,account:1,other:0}],
    ['gameplay',{gameplay:8,admin:1,account:1,other:0}],
    ['account',{gameplay:1,admin:0,account:8,other:1}],
    ['other',{gameplay:1,admin:1,account:0,other:8}],
    ['mixed',{gameplay:4,admin:4,account:1,other:1}],
  ]) {
    const found=read([requestWindow(10,{origin:8,quota:1,gateway_or_unmeasured:1},{route_groups:groups})])[0];
    assert.equal(found.traffic_context,name,name);
    assert.equal(found.next_action,'inspect_origin_backend');
  }
  const incomplete=read([requestWindow(10,{origin:9,quota:1,gateway_or_unmeasured:0},
    {route_groups:{gameplay:1,admin:4,account:0,other:0}})])[0];
  assert.equal(incomplete.traffic_context,'unverified');
  const bad=read([requestWindow(10,{origin:9,quota:1,gateway_or_unmeasured:0},
    {route_groups:{gameplay:1,admin:100,account:0,other:0}})])[0];
  assert.equal(bad.traffic_context,'unverified');
});
test('observed quota wait correlations prioritize retry, handler concurrency or cleanup, never assert cause',()=>{
  const cases=[
    [{slow_with_retry:9,matched_concurrent:1,matched_cleanup_overlap:0},'retry','inspect_retry_attempt_timing'],
    [{slow_with_retry:0,matched_concurrent:9,matched_cleanup_overlap:0},'handler_concurrency','inspect_handler_concurrency_wait'],
    [{slow_with_retry:0,matched_concurrent:1,matched_cleanup_overlap:8},'cleanup_overlap','inspect_quota_cleanup_overlap'],
    [{slow_with_retry:9,matched_concurrent:9,matched_cleanup_overlap:0},'multiple','inspect_quota_transport_dispatch'],
    [{slow_with_retry:2,matched_concurrent:2,matched_cleanup_overlap:2},'no_majority','inspect_quota_transport_dispatch'],
    [{slow_with_retry:99,matched_concurrent:2,matched_cleanup_overlap:0},'unverified','inspect_quota_transport_dispatch'],
    [{slow_with_retry:'9',matched_concurrent:2,matched_cleanup_overlap:0},'unverified','inspect_quota_transport_dispatch'],
    [{slow_with_retry:0,matched_concurrent:99,matched_cleanup_overlap:0},'unverified','inspect_quota_transport_dispatch'],
  ];
  for(const [extra,signal,action] of cases){
    const result=read([quotaWindow(10,1,9,9,extra)])[1];
    assert.equal(result.suspected_stage,'quota_transport_wait');
    assert.equal(result.wait_signal,signal);
    assert.equal(result.next_action,action);
    assert.equal(result.evidence,'moderate');
    assert.equal(result.outcome,'dominant_observed_stage');
  }
  const low=read([quotaWindow(2,0,2,2,{slow_with_retry:2,matched_concurrent:2,matched_cleanup_overlap:0})])[1];
  assert.equal(low.outcome,'insufficient_samples');
  assert.ok(!Object.hasOwn(low,'wait_signal'));
  const noMatch=read([quotaWindow(10,1,9,2,{slow_with_retry:9,matched_concurrent:2,matched_cleanup_overlap:2})])[1];
  assert.equal(noMatch.outcome,'correlation_incomplete');
  assert.ok(!Object.hasOwn(noMatch,'wait_signal'));
});

test('quota transport wait classifies first-attempt successes and affected traffic conservatively',()=>{
  const base={slow_outcomes:{successful_first_attempt:8,retried:1,denied_429:0,failed_5xx:0,other_or_unknown:1},
    slow_route_groups:{gameplay:8,account:1,admin:1,other:0},
    slow_with_retry:1,matched_concurrent:1,matched_cleanup_overlap:0};
  const found=read([quotaWindow(10,1,9,9,base)])[1];
  assert.equal(found.suspected_stage,'quota_transport_wait');
  assert.equal(found.wait_signal,'no_majority');
  assert.equal(found.wait_profile,'single_attempt_success');
  assert.equal(found.traffic_context,'gameplay');
  assert.equal(found.next_action,'inspect_first_attempt_dispatch_or_ack');

  const noEvidence=read([quotaWindow(10,1,9,9,{...base,slow_outcomes:{...base.slow_outcomes,successful_first_attempt:'8'}})])[1];
  assert.equal(noEvidence.wait_profile,'unverified');
  assert.equal(noEvidence.next_action,'inspect_quota_transport_dispatch');
  const invalidTotal=read([quotaWindow(10,1,9,9,{...base,slow_outcomes:{...base.slow_outcomes,retried:20}})])[1];
  assert.equal(invalidTotal.wait_profile,'unverified');
  const mixed=read([quotaWindow(10,1,9,9,{...base,slow_outcomes:{
    successful_first_attempt:4,retried:3,denied_429:2,failed_5xx:1,other_or_unknown:0}})])[1];
  assert.equal(mixed.wait_profile,'mixed');
  assert.equal(mixed.next_action,'inspect_quota_transport_dispatch');
  const denied=read([quotaWindow(10,1,9,9,{...base,slow_outcomes:{
    successful_first_attempt:1,retried:0,denied_429:9,failed_5xx:0,other_or_unknown:0}})])[1];
  assert.equal(denied.wait_profile,'rate_limit_denials');
  assert.equal(denied.next_action,'inspect_quota_transport_dispatch');

  const incomplete=read([quotaWindow(10,1,9,3,base)])[1];
  assert.equal(incomplete.outcome,'correlation_incomplete');
  assert.ok(!Object.hasOwn(incomplete,'wait_profile'));
  const low=read([quotaWindow(2,0,2,2,base)])[1];
  assert.equal(low.outcome,'insufficient_samples');
  assert.ok(!Object.hasOwn(low,'wait_profile'));
  const payload=JSON.stringify(found);
  assert.ok(payload.length<700);
  assert.ok(!/secret|trace|route|\\d{4}-\\d\\d-\\d\\d/.test(payload));
});
