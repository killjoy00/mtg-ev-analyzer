import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,parseGatewayEvent,quotaStageSummary} from '../scripts/launch-alert.mjs';

const event=(id,quota_ms,handler,residual,extra={})=>parseGatewayEvent({
  $metadata:{id},source:{event:'gateway_request',status:200,route:'draft_start',
    release:'a'.repeat(40),sample_rate:1,tail_sampling_version:1,
    duration_ms:quota_ms+20,quota_ms,quota_handler_ms:handler,
    quota_transport_wait_ms:residual,trace:'private-should-not-escape',
    object_tag:'private-should-not-escape',...extra},
});
test('slow-quota diagnosis counts actual retained slow events by stage, never guesses missing timings',()=>{
  const a=event('a',1501,1100,401);
  const b=event('b',1500,190,1310,{quota_attempts:2});
  const c=event('c',1150,null,null);
  const d=event('d',200,120,80);
  assert.deepEqual(quotaStageSummary([a,b,c,d]),{
    slow_events:3,timing_available:2,handler_dominant:1,residual_dominant:1,
    missing_timing:1,retried:1,quota_failures:0,
  });
  const result=evaluate([a,b,c,d],{});
  assert.ok(result.alerts.includes('slow_quota'));
  assert.equal(result.quota_stage_summary.slow_events,3);
  assert.equal(a.trace,undefined);
  assert.equal(a.object_tag,undefined);
});
test('untrusted stage values cannot be copied into the public summary or classified as durations',()=>{
  const bad=event('bad',1250,'1200','0',{status:503,quota_attempts:3});
  assert.equal(bad.quota_handler_ms,null);
  assert.equal(bad.quota_transport_wait_ms,null);
  assert.deepEqual(quotaStageSummary([bad]),{
    slow_events:1,timing_available:0,handler_dominant:0,residual_dominant:0,
    missing_timing:1,retried:1,quota_failures:1,
  });
  assert.doesNotMatch(JSON.stringify(evaluate([bad],{})),/private-should-not-escape/);
});
test('fast events and legacy events cannot be mistaken for slow, attributable quota work',()=>{
  const fast=event('fast',300,200,100);
  const legacy=event('legacy',1800,null,null,{tail_sampling_version:0});
  assert.deepEqual(quotaStageSummary([fast,legacy]),{
    slow_events:1,timing_available:0,handler_dominant:0,residual_dominant:0,
    missing_timing:1,retried:0,quota_failures:0,
  });
});
