import test from 'node:test';
import assert from 'node:assert/strict';
import {chargeNetworkQuota,gateway} from '../edge/gateway.mjs';

test('retryable quota exception recreates the broken stub, with one bounded backoff',async()=>{
  let stubs=0,calls=0;const delays=[];
  const namespace={get:id=>{assert.equal(id,'network');const stub=++stubs;return {fetch:async()=>{
    calls++;if(stub===1)throw Object.assign(Error('provider failure'),{retryable:true});
    return new Response(null,{status:204});
  }};}};
  assert.equal((await chargeNetworkQuota(namespace,'network','request',{sleep:async ms=>delays.push(ms)})).status,204);
  assert.equal(stubs,2);assert.equal(calls,2);assert.equal(delays.length,1);assert.ok(delays[0]>=50&&delays[0]<100);
});
test('overload, non-retryable failures, timeouts and HTTP responses are never retried',async()=>{
  for(const error of [Error('unknown'),Object.assign(Error('overloaded'),{retryable:true,overloaded:true}),
    Object.assign(new DOMException('timed out','TimeoutError'),{retryable:true}),Object.assign(new DOMException('aborted','AbortError'),{retryable:true})]) {
    let calls=0;const namespace={get:()=>({fetch:async()=>{calls++;throw error;}})};
    await assert.rejects(chargeNetworkQuota(namespace,'network','request'),e=>e===error);assert.equal(calls,1);
  }
  for(const status of [429,503]) {
    let calls=0;const namespace={get:()=>({fetch:async()=>{calls++;return new Response(null,{status});}})};
    assert.equal((await chargeNetworkQuota(namespace,'network','request')).status,status);assert.equal(calls,1);
  }
});
test('quota recovery stops at two attempts and respects the original shared deadline',async()=>{
  let calls=0;const error=Object.assign(Error('retryable'),{retryable:true});
  const namespace={get:()=>({fetch:async()=>{calls++;throw error;}})};
  await assert.rejects(chargeNetworkQuota(namespace,'network','request',{sleep:async()=>{}}),e=>e===error);assert.equal(calls,2);
  const controller=new AbortController();calls=0;
  await assert.rejects(chargeNetworkQuota(namespace,'network','request',{signal:controller.signal,sleep:async()=>controller.abort()}),{name:'AbortError'});
  assert.equal(calls,1);
});
test('a lost quota acknowledgement can overcount but cannot erase a debit',async()=>{
  let debits=0;
  const namespace={get:()=>({fetch:async()=>{debits++;if(debits===1)throw Object.assign(Error('lost acknowledgement'),{retryable:true});return new Response(null,{status:204});}})};
  assert.equal((await chargeNetworkQuota(namespace,'network','request',{sleep:async()=>{}})).status,204);assert.equal(debits,2);
});
test('gateway quota recovery never duplicates an upstream application mutation',async()=>{
  let quotaCalls=0,upstreamCalls=0;
  const env={MODE:'preview',NEON_BRANCH_ID:'br-isolated-preview',ORIGIN_SECRET:'a'.repeat(64),PREVIEW_KEY:'b'.repeat(64),QUOTA_KEY:'c'.repeat(64),
    NETWORK_QUOTA:{idFromName:id=>id,get:()=>({fetch:async()=>{quotaCalls++;if(quotaCalls===1)throw Object.assign(Error('transient'),{retryable:true});return new Response(null,{status:204});}})}};
  const result=await gateway(new Request('https://api-preview.packone.pro/draft/v1/runs',{
    method:'POST',body:'{}',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.1','x-pack1-preview-key':env.PREVIEW_KEY},
  }),env,async()=>{upstreamCalls++;return Response.json({ok:true});});
  assert.equal(result.status,200);assert.equal(quotaCalls,2);assert.equal(upstreamCalls,1);
});
test('failed preview quota checks expose bounded stage evidence with no upstream call',async()=>{
  const env={MODE:'preview',NEON_BRANCH_ID:'br-isolated-preview',ORIGIN_SECRET:'a'.repeat(64),PREVIEW_KEY:'b'.repeat(64),QUOTA_KEY:'c'.repeat(64),
    NETWORK_QUOTA:{idFromName:id=>id,get:()=>({fetch:async()=>{throw Object.assign(Error('private-provider-message'),{retryable:true,overloaded:true});}})}};
  const result=await gateway(new Request('https://api-preview.packone.pro/draft/v1/daily-status',{
    headers:{'cf-connecting-ip':'192.0.2.1','x-pack1-preview-key':env.PREVIEW_KEY},
  }),env,()=>{throw Error('upstream must not execute');});
  assert.equal(result.status,503);const evidence=JSON.parse(result.headers.get('x-pack1-gateway-timing'));
  assert.equal(evidence.quota_attempts,1);assert.equal(evidence.quota_overloaded,true);assert.equal(evidence.upstream_calls,0);
  assert.doesNotMatch(JSON.stringify(evidence),/private-provider-message|192\.0\.2/);
});
