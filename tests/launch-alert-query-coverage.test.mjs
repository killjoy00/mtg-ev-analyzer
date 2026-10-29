import test from 'node:test';
import assert from 'node:assert/strict';
import {queryEvents,inspectGatewayCoverage} from '../scripts/launch-alert.mjs';
import {coverageTarget,STEP_MS} from '../launch-monitoring.mjs';
const row=id=>({$metadata:{id},source:{event:'gateway_request',status:503,sample_rate:1,duration_ms:5000,quota_ms:5000,upstream_calls:0,route:'draft_view',release:'a'.repeat(40)}});
const page=(events,level)=>Response.json({result:{events:{events},statistics:{abr_level:level}}});
test('launch collection discards a coarse short page and recovers errors without changing alert criteria',async()=>{
  let calls=0;
  const events=await queryEvents(async(url,request)=>{
    calls++;const q=JSON.parse(request.body);
    if(q.timeframe.to-q.timeframe.from>120000)return page([row('coarse-only')],10);
    return page(q.timeframe.from===0?Array.from({length:5},(_,i)=>row('recovered-'+i)):[],1);
  },'fixture','a'.repeat(32),0,240000);
  assert.equal(calls,3);assert.equal(events.length,5);assert.ok(events.every(e=>e.id.startsWith('recovered-')));
});
test('unverified query sampling cannot advance the existing coverage watermark',async()=>{
  const now=Date.parse('2026-10-29T19:00:00Z'),target=coverageTarget(now),through=target-STEP_MS;
  const initial={version:1,coverage_floor:new Date(target-3600000).toISOString(),covered_through:new Date(through).toISOString(),alerted_windows:{},updated_at:null};
  const inspected=await inspectGatewayCoverage({state:initial,now,loadWindow:(from,to)=>queryEvents(async()=>page([],10),'fixture','a'.repeat(32),from,to)});
  assert.ok(inspected.failed);assert.match(inspected.failed.error,/sampling remains unresolved/);
  assert.equal(inspected.state.covered_through,initial.covered_through);
});
test('missing sampling metadata fails closed rather than reporting an empty successful window',async()=>{
  await assert.rejects(queryEvents(async()=>Response.json({result:{events:{events:[]}}}),'fixture','a'.repeat(32),0,1000),/sampling coverage unavailable/);
});
