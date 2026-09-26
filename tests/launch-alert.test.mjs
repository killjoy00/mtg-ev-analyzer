import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluate,inspectGatewayCoverage,parseGatewayEvent,parseNeonUsage,queryEvents,routeAlert,
} from '../scripts/launch-alert.mjs';
import {
  WINDOW_MS,coverageTarget,mergeCoverageState,parseCoverageState,renderCoverageState,
} from '../launch-monitoring.mjs';

const baseEvent=(overrides={})=>({id:crypto.randomUUID(),status:200,sample_rate:.1,duration_ms:100,quota_ms:5,release:'a'.repeat(40),...overrides});
const state=({floor,through,alerts={}}={})=>({version:1,coverage_floor:floor?new Date(floor).toISOString():null,covered_through:through?new Date(through).toISOString():null,alerted_windows:alerts,updated_at:null});

test('sample weights prevent treating fully retained errors as a raw error percentage',()=>{
 const success={status:200,sample_rate:.1,duration_ms:100,quota_ms:5,release:'a'.repeat(40)};
 const bad={...success,status:503,sample_rate:1};
 assert.equal(evaluate([...Array(100).fill(success),...Array(5).fill(bad)],{}).alerts.length,0);
 assert.ok(evaluate([...Array(10).fill(success),...Array(5).fill(bad)],{}).alerts.includes('gateway_5xx'));
 assert.ok(evaluate(Array(10).fill({...bad,status:429}),{}).alerts.includes('network_or_application_429'));
});

test('event parser drops identity and arbitrary strings',()=>{
 const e=parseGatewayEvent({$metadata:{id:'event'},source:{event:'gateway_request',status:200,sample_rate:.1,duration_ms:20,route:'/profile/secret',cookie:'secret',release:'a'.repeat(40)}});
 assert.equal(e.route,'other');assert.equal(e.cookie,undefined);
 assert.equal(parseGatewayEvent({source:{event:'different'}}),null);
});

test('usage aggregates billing periods with explicit units',()=>{
 const p={consumption:[{metrics:[{metric_name:'compute_unit_seconds',value:3600},{metric_name:'public_network_transfer_bytes',value:42}]}]};
 assert.deepEqual(parseNeonUsage({projects:[{project_id:'patient-shadow-91417882',periods:[p,p]}]}),{compute_cu_hours:2,egress_bytes:84});
 assert.throws(()=>parseNeonUsage({projects:[]}));
});

test('existing incident is deduplicated without comments',async()=>{
 let calls=0;const action=await routeAlert(async()=>{calls++;return Response.json([{title:'[launch alert] Production capacity needs attention (slow_requests)',number:9}]);},{GITHUB_REPOSITORY:'owner/repo',GITHUB_TOKEN:'token'},{alerts:['slow_requests']});
 assert.equal(action,'existing');assert.equal(calls,1);
});

test('an existing usage incident does not suppress a new service failure',async()=>{
 const writes=[];const fetcher=async(url,options)=>{
  if(options.method==='POST'){writes.push(JSON.parse(options.body));return Response.json({number:10});}
  return Response.json([{title:'[launch alert] Production capacity needs attention',body:'"neon_egress_billing_period_usage"',number:9}]);
 };
 assert.equal(await routeAlert(fetcher,{GITHUB_REPOSITORY:'owner/repo',GITHUB_TOKEN:'token'},{alerts:['neon_egress_billing_period_usage','gateway_5xx']}),'created');
 assert.equal(writes.length,1);assert.match(writes[0].title,/gateway_5xx/);
});

test('two-hour scheduling gap is caught up as short windows and finds a middle 5xx/429 burst',async()=>{
 const now=Date.parse('2026-09-26T12:32:00Z'),target=coverageTarget(now),covered=target-2*60*60_000;
 const burstAt=covered+60*60_000,calls=[];
 const burst=[...Array.from({length:5},(_,i)=>baseEvent({id:'five-'+i,status:503,sample_rate:1})),...Array.from({length:10},(_,i)=>baseEvent({id:'limit-'+i,status:429,sample_rate:1}))];
 const result=await inspectGatewayCoverage({
  state:state({floor:covered-60*60_000,through:covered}),now,
  loadWindow:async(from,to)=>{calls.push([from,to]);return from<=burstAt&&burstAt<=to?burst:[];},
 });
 assert.equal(result.failed,null);
 assert.equal(result.unrecoverable,false);
 assert.equal(result.state.covered_through,new Date(target).toISOString());
 assert.ok(result.alerts.includes('gateway_5xx'));
 assert.ok(result.alerts.includes('network_or_application_429'));
 assert.ok(calls.length>=24);
 assert.ok(calls.every(([from,to])=>to-from===WINDOW_MS),'catch-up must preserve 15-minute alert windows');
});

test('partial catch-up failure advances only through the last completely inspected new window',async()=>{
 const now=Date.parse('2026-09-26T12:32:00Z'),target=coverageTarget(now),covered=target-60*60_000,failEnd=covered+15*60_000;
 const calls=[];
 const result=await inspectGatewayCoverage({
  state:state({floor:covered-60*60_000,through:covered}),now,
  loadWindow:async(from,to)=>{calls.push(to);if(to===failEnd)throw Error('fixture interval unavailable');return [];},
 });
 assert.equal(result.failed.to,new Date(failEnd).toISOString());
 assert.equal(result.state.covered_through,new Date(covered+10*60_000).toISOString());
 assert.equal(calls.some(end=>end>failEnd),false,'no interval after the failure may be inspected or marked covered');
});

test('late-arriving events are detected by replay without moving an already-current watermark',async()=>{
 const now=Date.parse('2026-09-26T12:32:00Z'),target=coverageTarget(now),burstAt=target-20*60_000;
 const burst=Array.from({length:10},(_,i)=>baseEvent({id:'late-'+i,status:429,sample_rate:1}));
 const result=await inspectGatewayCoverage({
  state:state({floor:target-2*60*60_000,through:target}),now,
  loadWindow:async(from,to)=>from<=burstAt&&burstAt<=to?burst:[],
 });
 assert.equal(result.plan.newEnds.length,0);
 assert.ok(result.plan.replayEnds.length>0);
 assert.ok(result.alerts.includes('network_or_application_429'));
 assert.equal(result.state.covered_through,new Date(target).toISOString());
});

test('recorded replay evidence never suppresses re-routing after a prior route failure',async()=>{
 const now=Date.parse('2026-09-26T12:32:00Z'),target=coverageTarget(now),end=new Date(target).toISOString();
 const burst=Array.from({length:10},(_,i)=>baseEvent({id:'retry-'+i,status:429,sample_rate:1}));
 const result=await inspectGatewayCoverage({
  state:state({floor:target-2*60*60_000,through:target,alerts:{[end]:['network_or_application_429']}}),now,
  loadWindow:async(from,to)=>to===target?burst:[],
 });
 assert.ok(result.alerts.includes('network_or_application_429'));
});

test('duplicate telemetry IDs are counted once',async()=>{
 const row={$metadata:{id:'same'},source:{event:'gateway_request',status:503,sample_rate:1,duration_ms:20,route:'draft',release:'a'.repeat(40)}};
 const events=await queryEvents(async()=>Response.json({result:{events:{events:[row,row]}}}),'token','a'.repeat(32),0,1000);
 assert.equal(events.length,1);
 assert.equal(events[0].id,'same');
});

test('overlapping stale state writers cannot regress coverage or erase alert-window dedupe',()=>{
 const newer=state({floor:Date.parse('2026-09-26T10:00:00Z'),through:Date.parse('2026-09-26T12:00:00Z'),alerts:{'2026-09-26T11:55:00.000Z':['gateway_5xx']}});
 const stale=state({floor:Date.parse('2026-09-26T10:00:00Z'),through:Date.parse('2026-09-26T11:30:00Z'),alerts:{'2026-09-26T11:25:00.000Z':['network_or_application_429']}});
 const merged=mergeCoverageState(newer,stale,{now:Date.parse('2026-09-26T12:01:00Z')});
 assert.equal(merged.covered_through,'2026-09-26T12:00:00.000Z');
 assert.deepEqual(merged.alerted_windows['2026-09-26T11:55:00.000Z'],['gateway_5xx']);
 assert.deepEqual(merged.alerted_windows['2026-09-26T11:25:00.000Z'],['network_or_application_429']);
});

test('retention expiry reports unrecoverable coverage and never advances or queries the missing interval',async()=>{
 const now=Date.parse('2026-09-26T12:32:00Z'),target=coverageTarget(now),covered=target-4*24*60*60_000;let calls=0;
 const result=await inspectGatewayCoverage({
  state:state({floor:covered-60*60_000,through:covered}),now,
  loadWindow:async()=>{calls++;return [];},
 });
 assert.equal(result.unrecoverable,true);
 assert.equal(calls,0);
 assert.equal(result.state.covered_through,new Date(covered).toISOString());
});

test('first-run bootstrap inspects two hours of 15-minute windows and persists a stable floor',async()=>{
 const now=Date.parse('2026-09-26T12:32:00Z'),target=coverageTarget(now),calls=[];
 const blank={version:1,coverage_floor:null,covered_through:null,alerted_windows:{},updated_at:null};
 const result=await inspectGatewayCoverage({state:blank,now,loadWindow:async(from,to)=>{calls.push([from,to]);return [];}});
 assert.equal(result.plan.bootstrap,true);
 assert.equal(result.plan.newEnds.length,22);
 assert.equal(result.state.covered_through,new Date(target).toISOString());
 assert.equal(result.state.coverage_floor,new Date(target-2*60*60_000).toISOString());
 assert.ok(calls.every(([from,to])=>to-from===WINDOW_MS));
});

test('coverage state round-trips only the sanitized machine marker',()=>{
 const original=state({floor:Date.parse('2026-09-26T10:00:00Z'),through:Date.parse('2026-09-26T12:00:00Z'),alerts:{'2026-09-26T11:55:00.000Z':['gateway_5xx']}});
 const body=renderCoverageState(original),parsed=parseCoverageState(body);
 assert.deepEqual(parsed.alerted_windows,original.alerted_windows);
 assert.equal(parsed.covered_through,original.covered_through);
 assert.doesNotMatch(body,/token|cookie|ip_address/i);
});
