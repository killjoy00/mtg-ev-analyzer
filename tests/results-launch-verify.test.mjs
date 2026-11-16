import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyResultsLaunch} from '../scripts/verify-results-launch.mjs';
import {gateway} from '../edge/gateway.mjs';
const launched={active:true,launchAt:'2026-11-16T15:00:00Z',firstPublicationAt:'2026-11-30T15:00:00Z'};
const fixture=(data=launched,status=200)=>async url=>String(url).endsWith('/launch')?Response.json(data,{status,headers:{'cache-control':'no-store'}}):Response.json({}, {status:401});
test('live release acceptance verifies actual launch, notice period, dated policy and protected routes',async()=>{
 assert.deepEqual(await verifyResultsLaunch({expectedActive:true,expectedDate:'2026-11-16',fetcher:fixture()}),launched);
 assert.equal((await verifyResultsLaunch({expectedActive:false,fetcher:fixture({active:false,launchAt:null,firstPublicationAt:null})})).active,false);
 await assert.rejects(verifyResultsLaunch({expectedActive:false,fetcher:fixture()}));
 await assert.rejects(verifyResultsLaunch({expectedActive:true,expectedDate:'2026-11-17',fetcher:fixture()}));
 await assert.rejects(verifyResultsLaunch({expectedActive:true,fetcher:fixture(launched,404)}));
 await assert.rejects(verifyResultsLaunch({expectedActive:true,fetcher:fixture({...launched,firstPublicationAt:launched.launchAt})}));
});
test('one-click form POST from the API origin reaches only the unsubscribe route',async()=>{
 const env={MODE:'production',NEON_BRANCH_ID:'br-orange-feather-ayps8kep',QUOTA_KEY:'a'.repeat(64),ORIGIN_SECRET:'b'.repeat(64),NETWORK_QUOTA:{idFromName:value=>value,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
 let calls=0;
 const fetcher=async(url,options)=>{calls++;assert.equal(new URL(url).pathname,'/v1/results/unsubscribe');assert.equal(options.method,'POST');return new Response('Unsubscribed');};
 const request=(path,origin)=>new Request('https://api.packone.pro/growth'+path,{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded','cf-connecting-ip':'192.0.2.1'},body:'List-Unsubscribe=One-Click'});
 const response=await gateway(request('/v1/results/unsubscribe?token=fixture','https://api.packone.pro'),env,fetcher);
 assert.equal(response.status,200);assert.equal(calls,1);
 assert.equal((await gateway(request('/v1/results/unsubscribe?token=fixture','https://untrusted.invalid'),env,fetcher)).status,403);
 assert.equal((await gateway(request('/v1/account/results','https://api.packone.pro'),env,fetcher)).status,404);
 assert.equal(calls,1);
});
