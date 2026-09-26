import test from 'node:test';
import assert from 'node:assert/strict';
import {gateway} from '../edge/gateway.mjs';

const base='/draft/v1/admin/corpus/readiness';
function environment(preview=false) {
 return {MODE:preview?'preview':'production',NEON_BRANCH_ID:preview?'br-isolated-readiness':'br-orange-feather-ayps8kep',
  QUOTA_KEY:'1'.repeat(64),...(preview?{ORIGIN_SECRET:'2'.repeat(64),PREVIEW_KEY:'3'.repeat(64)}:{}),
  NETWORK_QUOTA:{idFromName:name=>name,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
}
async function call(path,{method='GET',headers={},preview=false,status=200}={}) {
 const calls=[];
 const request=new Request(`https://${preview?'api-preview':'api'}.packone.pro${path}`,{
  method,headers:{origin:'https://packone.pro','cf-connecting-ip':'192.0.2.9',
   ...(method==='POST'?{'content-type':'application/json'}:{}),...headers},
  ...(method==='POST'?{body:'{}'}:{})});
 const result=await gateway(request,environment(preview),async(url,options)=>{
  calls.push({url,options});return Response.json({ready:false,state:'warming'},{status});
 });
 return {result,calls};
}

test('readiness GET and retry POST reach only the existing production draft admin surface',async()=>{
 for(const [path,method] of [[base,'GET'],[base+'?operation=42','GET'],[base+'/42/retry','POST']]) {
  const {result,calls}=await call(path,{method,headers:{cookie:'__Host-pack1_account=fixture; __Secure-pack1_csrf=csrf','x-pack1-csrf':'csrf'}});
  assert.equal(result.status,200);assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://br-orange-feather-ayps8kep-draftrunapi.compute.c-5.us-east-2.aws.neon.tech'+path.replace('/draft',''));
  assert.equal(calls[0].options.headers.get('x-pack1-csrf'),'csrf');
  assert.match(calls[0].options.headers.get('cookie'),/__Host-pack1_account=fixture/);
  assert.equal(result.headers.get('cache-control'),'no-store');
  assert.equal(result.headers.get('access-control-allow-origin'),'https://packone.pro');
  assert.equal(result.headers.get('access-control-allow-credentials'),'true');
 }
});

test('readiness route rejects alternate methods, malformed IDs, service aliases and preview access',async()=>{
 for(const [path,method] of [[base,'POST'],[base+'/42/retry','GET'],[base+'/0/retry','POST'],[base+'/01/retry','POST'],
  [base+'/-1/retry','POST'],[base+'/x/retry','POST'],[base+'/12345678901234567890/retry','POST'],
  [base+'/42/retry/extra','POST'],[base.replace('/draft','/growth'),'GET']]) {
  const {result,calls}=await call(path,{method});assert.equal(result.status,404,path);assert.equal(calls.length,0);
 }
 const {result,calls}=await call(base,{preview:true,headers:{'x-pack1-preview-key':'3'.repeat(64)}});
 assert.equal(result.status,404);assert.equal(calls.length,0);
});

test('mobile credentials and hostile browser origins cannot access admin readiness',async()=>{
 for(const headers of [
  {'x-pack1-mobile-session':'p1_00000000-0000-4000-8000-000000000000.'+'x'.repeat(43)},
  {'x-pack1-mobile-account':'x'.repeat(43)},
  {origin:'https://untrusted.invalid'}
 ])for(const [path,method] of [[base,'GET'],[base+'/42/retry','POST']]) {
  const {result,calls}=await call(path,{method,headers});assert.equal(result.status,403);assert.equal(calls.length,0);
 }
});

test('gateway preserves backend authorization failures and never replays readiness retries',async()=>{
 for(const status of [401,403,409,503]) {
  const {result,calls}=await call(base+'/42/retry',{method:'POST',status,headers:{authorization:'Bearer caller-controlled'}});
  assert.equal(result.status,status);assert.equal(calls.length,1);
  assert.equal(calls[0].options.headers.get('authorization'),null,'arbitrary bearer must not be forwarded');
 }
});

test('existing shared-run reads remain routed while adding admin readiness',async()=>{
 const {result,calls}=await call('/draft/v1/shared-runs/'+'a'.repeat(24));
 assert.equal(result.status,200);assert.equal(calls.length,1);
});
