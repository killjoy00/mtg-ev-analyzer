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
