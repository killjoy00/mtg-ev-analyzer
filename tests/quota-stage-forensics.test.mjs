import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeQuotaStages,summarizeSlowRequestStages} from '../scripts/quota-stage-forensics.mjs';
const trace=c=>c.repeat(32);
const row=(event,p,id)=>({$metadata:{id},source:{event,...p}});
const gateway=(c,ms,extra={})=>row('gateway_request',{trace:trace(c),quota_ms:ms,
  quota_handler_ms:300,quota_transport_wait_ms:ms-300,
  sample_rate:1,status:200,upstream_calls:1,secret:'private',...extra},'g'+c);
const handler=(c,extra={})=>row('quota_handler',{trace:trace(c),attempt:1,
  concurrency:1,cleanup_inflight:false,status:204,state_layout:'current',
  phase:'complete',durability_confirmed:true,transaction_ms:150,
  durability_ms:550,get_ms:5,put_ms:140,alarm_get_ms:10,alarm_set_ms:0,
  handler_ms:750,secret:'private',...extra},'h'+c);
test('aggregate correlation identifies slow storage stages without leaking trace or other fields',()=>{
  const s=summarizeQuotaStages(
    [gateway('a',1800),gateway('b',200),gateway('c',1500,{status:503,upstream_calls:0})],
    [handler('a',{concurrency:2,cleanup_inflight:true}),handler('c',{durability_ms:1300,transaction_ms:100})],[]);
  assert.equal(s.gateway_records,3);
  assert.equal(s.slow_gateway_quota,2);
  assert.equal(s.matched_slow,2);
  assert.equal(s.missing_handler_completion,0);
  assert.equal(s.gateway_5xx_before_upstream,1);
  assert.equal(s.matched_concurrent,1);
  assert.equal(s.matched_cleanup_overlap,1);
  assert.equal(s.stages.durability.gt_1000ms,1);
  assert.equal(s.stages.transaction.gt_500ms,0);
  assert.equal(s.stages.handler_total.p95_ms,750);
  assert.doesNotMatch(JSON.stringify(s),/private|aaaaaaaa|cccccccc/);
});
test('unsampled anomalies and missing handler completions remain unverified',()=>{
  const s=summarizeQuotaStages(
    [gateway('a',1600,{sample_rate:.1}),gateway('b',1700),gateway('c',1050)],
    [handler('b',{status:503,phase:'durability',durability_confirmed:false})],
    [row('quota_handler_start',{trace:trace('c')},'s1')]);
  assert.equal(s.slow_gateway_quota,2);
  assert.equal(s.missing_handler_completion,1);
  assert.equal(s.missing_handler_with_start,1);
  assert.equal(s.matched_handler_503,1);
  assert.equal(s.phase.durability,1);
  assert.equal(s.matched_durability_confirmed,0);
});
test('malformed or stringified storage timings are never treated as successful fast stages',()=>{
  const s=summarizeQuotaStages([gateway('d',1800)],
    [handler('d',{durability_ms:'unknown',transaction_ms:-1})],[]);
  assert.equal(s.stages.durability.observed,0);
  assert.equal(s.stages.transaction.observed,0);
});


const slowGateway=(trace,quota,duration,origin,other={})=>gateway(trace,quota,{
  duration_ms:duration,upstream_ms:origin,tail_sampling_version:1,route:'draft_pick',...other,
});
test('slow-request forensics separates quota, origin and gateway stages without sensitive data',()=>{
  const s=summarizeSlowRequestStages([
    slowGateway('a',1500,6000,4000),
    slowGateway('b',6200,7000,100,{route:'player_session',status:503,upstream_calls:0}),
    slowGateway('c',150,7600,7100,{route:'profile'}),
    slowGateway('d',150,8200,200,{route:'admin_users'}),
    slowGateway('e',150,6100,6100,{route:'draft_view'}), // inconsistent sum
    slowGateway('f',150,6400,null,{route:'other'}), // missing origin
    slowGateway('g',150,7100,100,{tail_sampling_version:undefined}),
    slowGateway('h',150,8000,100,{sample_rate:.1}),
    slowGateway('i',150,4000,100),
  ]);
  assert.equal(s.gateway_records,9);
  assert.equal(s.slow_retained,6);
  assert.equal(s.slow_unverified_retention,2);
  assert.equal(s.slow_5xx,1);
  assert.equal(s.slow_5xx_before_origin,1);
  assert.equal(s.slow_quota_overlap,2);
  assert.equal(s.slow_origin_over_5s,2);
  assert.deepEqual(s.route_groups,{gameplay:3,account:1,admin:1,other:1});
  assert.equal(s.missing_stages,1);
  assert.equal(s.inconsistent_stages,1);
  assert.deepEqual(s.dominant,{quota:1,origin:2,gateway_or_unmeasured:1});
  assert.equal(s.stages_of_attributable_slow.total.observed,4);
  assert.equal(s.stages_of_attributable_slow.total.p95_ms,8200);
  assert.doesNotMatch(JSON.stringify(s),/private|aaaaaaaa|bbbbbbbb|trace|ip_address/);
});
test('exact five seconds is not slow; unverified tails and invalid rows do not imply stage evidence',()=>{
  const s=summarizeSlowRequestStages([
    slowGateway('a',1200,5000,3000),
    slowGateway('b',1000,5001,3000,{tail_sampling_version:0}),
    slowGateway('c',1000,5002,3000,{sample_rate:.1}),
    slowGateway('d',1000,-5,3000),
    row('quota_handler',{duration_ms:6000,quota_ms:3000,upstream_ms:0},'h'),
    slowGateway('e',1000,6001,3000,{status:'503'}),
  ]);
  assert.equal(s.gateway_records,4);
  assert.equal(s.slow_retained,0);
  assert.equal(s.slow_unverified_retention,2);
  assert.deepEqual(s.dominant,{quota:0,origin:0,gateway_or_unmeasured:0});
  assert.equal(s.stages_of_attributable_slow.total.observed,0);
});
