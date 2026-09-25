import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,parseGatewayEvent,parseNeonUsage,routeAlert} from '../scripts/launch-alert.mjs';
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
