import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyResultsEmailLive,verifyResultsEmailDevelopment} from '../scripts/verify-results-email-release.mjs';
const commit='a'.repeat(40);
const before={active:true,launchAt:'2026-11-16 15:33:12.134982+00',firstPublicationAt:'2026-11-30 15:33:12.134982+00'};
function fetcher({launch=before,revision=commit,ready=true,enabled=true,admin=401,webhook=401,internal=404}={}){
 return async(url)=>{
  const path=new URL(url).pathname;
  const body=path.endsWith('/launch')?launch:path.endsWith('/health')?{release_commit:revision,results_email_ready:ready,results_email_enabled:enabled}:{};
  const status=path.endsWith('/launch')||path.endsWith('/health')?200:path.endsWith('/results-campaigns')?admin:path.endsWith('/provider-event')?webhook:path.endsWith('/internal/results-email')?internal:401;
  return Response.json(body,{status,headers:{'cache-control':'no-store'}});
 };
}
test('live release proves routes and exact notice timestamps without claiming delivered email',async()=>{
 const result=await verifyResultsEmailLive({commit,before,fetcher:fetcher()});
 assert.deepEqual(result,{controlsVerified:true,deliveryProofRequired:true,...before});
});
test('a shifted cutoff, stale revision or incomplete private configuration cannot pass release acceptance',async()=>{
 for(const changes of [{launch:{...before,firstPublicationAt:'2026-11-30 15:33:12.135+00'}},{revision:'b'.repeat(40)},{ready:false},{enabled:false}]){
  await assert.rejects(verifyResultsEmailLive({commit,before,fetcher:fetcher(changes)}));
 }
});
test('a missing or unprotected owner, webhook or internal gateway route fails acceptance',async()=>{
 for(const changes of [{admin:404},{admin:200},{webhook:200},{webhook:404},{internal:200}]){
  await assert.rejects(verifyResultsEmailLive({commit,before,fetcher:fetcher(changes)}));
 }
});
test('an explicitly disabled release can prove the kill switch without claiming sender readiness',async()=>{
 const result=await verifyResultsEmailLive({commit,before,expectedEnabled:false,fetcher:fetcher({ready:false,enabled:false,webhook:503})});
 assert.equal(result.controlsVerified,true);assert.equal(result.deliveryProofRequired,true);
});
test('development is accepted only with the exact revision and no delivery-check credentials',async()=>{
 const branch='br-twilight-hill-ayffyd2b';
 const get=overrides=>async()=>Response.json({release_commit:commit,results_email_ready:false,results_email_enabled:false,...overrides});
 assert.deepEqual(await verifyResultsEmailDevelopment({branch,commit,fetcher:get({})}),{developmentSendingDisabled:true});
 for(const changes of [{release_commit:'b'.repeat(40)},{results_email_ready:true},{results_email_enabled:true}])await assert.rejects(verifyResultsEmailDevelopment({branch,commit,fetcher:get(changes)}));
 await assert.rejects(verifyResultsEmailDevelopment({branch:'br-orange-feather-ayps8kep',commit,fetcher:get({})}));
});
