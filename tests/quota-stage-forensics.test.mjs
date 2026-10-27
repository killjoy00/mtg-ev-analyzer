import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeQuotaStages} from '../scripts/quota-stage-forensics.mjs';
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
