import test from 'node:test';
import assert from 'node:assert/strict';
import {gateway,routeFamily} from '../edge/gateway.mjs';

const RUN='a0000000-0000-4000-8000-000000000001';
const PATH='/draft/v1/runs/'+RUN+'/stats';
function environment() {
 return {MODE:'production',NEON_BRANCH_ID:'br-orange-feather-ayps8kep',QUOTA_KEY:'1'.repeat(64),
  NETWORK_QUOTA:{idFromName:name=>name,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
}
async function route(path,{method='GET',headers={},status=401}={}) {
 const calls=[];
 const request=new Request('https://api.packone.pro'+path,{
  method,headers:{origin:'https://packone.pro','cf-connecting-ip':'192.0.2.10',...headers},
  ...(method==='POST'?{body:'{}'}:{})
 });
 const result=await gateway(request,environment(),async(url,options)=>{
  calls.push({url,options});
  return Response.json({error:'Unauthorized'},{status});
 });
 return {result,calls};
}
test('Daily stats GET is routed to Draft for browser and both native identity modes',async()=>{
 for(const headers of [
  {cookie:'__Host-pack1_player=browser-fixture'},
  {'x-pack1-mobile-session':'p1_00000000-0000-4000-8000-000000000000.'+'x'.repeat(43)},
  {'x-pack1-mobile-account':'x'.repeat(43)},
 ]) {
  const {result,calls}=await route(PATH+'?round=1',{headers});
  assert.equal(result.status,401,'backend controls auth, not gateway 404');
  assert.equal(calls.length,1,'gateway must route rather than reject stats');
  assert.equal(calls[0].url,'https://br-orange-feather-ayps8kep-draftrunapi.compute.c-5.us-east-2.aws.neon.tech/v1/runs/'+RUN+'/stats?round=1');
  assert.equal(calls[0].options.method,'GET');
 }
 assert.equal(routeFamily(PATH),'draft_stats_read');
});
test('gateway does not widen stats beyond GET valid run IDs or draft service',async()=>{
 for(const [path,method] of [
  [PATH,'POST'],[PATH+'/extra','GET'],['/growth/v1/runs/'+RUN+'/stats','GET'],
  ['/draft/v1/runs/invalid!id/stats','GET'],
 ]) {
  const {result,calls}=await route(path,{method});
  assert.equal(result.status,404,path+' '+method);
  assert.equal(calls.length,0,'blocked request must never reach backend');
 }
});
