// Read-only public acceptance. Never logs account data or request credentials.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
export async function verifyResultsLaunch({expectedActive,expectedDate=null,fetcher=fetch}={}){
 assert.equal(typeof expectedActive,'boolean','Expected activation state required');
 const response=await fetcher('https://api.packone.pro/growth/v1/results/launch',{
  headers:{origin:'https://packone.pro',accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000),
 });
 assert.equal(response.status,200,'Public results launch route must be available');
 assert.equal(response.headers.get('cache-control'),'no-store','Launch state must not be cached');
 const data=await response.json();
 assert.equal(data.active,expectedActive,'Actual production launch state');
 if(expectedActive){
  assert.ok(Number.isFinite(Date.parse(data.launchAt)),'Actual launch timestamp required');
  assert.ok(Date.parse(data.firstPublicationAt)-Date.parse(data.launchAt)>=14*86400000,'At least fourteen days of notice required');
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date(data.launchAt));
  if(expectedDate)assert.equal(date,expectedDate,'Policy date must match actual activation date');
  for(const path of ['/growth/v1/account/results','/growth/v1/mobile/account/results','/growth/v1/admin/results']){
   const guarded=await fetcher('https://api.packone.pro'+path,{headers:{origin:'https://packone.pro'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
   assert.equal(guarded.status,401,'Results control route must reach account authentication');
  }
 }
 return {active:data.active,launchAt:data.launchAt,firstPublicationAt:data.firstPublicationAt};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const state=process.argv[2];assert.ok(['--expect-active','--expect-inactive'].includes(state),'Explicit expected state required');
 const verified=await verifyResultsLaunch({expectedActive:state==='--expect-active'});
 console.log(JSON.stringify({event:'results_privacy_launch_verified',...verified}));
}
