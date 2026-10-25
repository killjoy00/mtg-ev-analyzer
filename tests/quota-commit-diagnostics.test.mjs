import test from 'node:test';
import assert from 'node:assert/strict';
import {NetworkQuota,chargeNetworkQuota,gateway} from '../edge/gateway.mjs';
import {TRACE_HEADER,REASON_HEADER,providerFailureCode,providerRay} from '../edge/private-diagnostics.mjs';
import {observedRoute} from '../worker/backend-diagnostics.mjs';

const trace='a'.repeat(32),tag='b'.repeat(32);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const request=()=>new Request('https://quota/request',{method:'POST',headers:{[TRACE_HEADER]:trace,'x-pack1-quota-tag':tag}});
async function capture(run) {
 const rows=[],old=console.log;console.log=line=>rows.push(JSON.parse(line));
 try{return await run(rows);}finally{console.log=old;}
}
function bufferedQuota(sync) {
 let buckets,puts=0;
 const tx={get:async key=>Array.isArray(key)?new Map():buckets,put:async(key,value)=>{buckets=value;puts++;},getAlarm:async()=>1};
 return {quota:new NetworkQuota({storage:{transaction:fn=>fn(tx),sync}}),puts:()=>puts,buckets:()=>buckets};
}

test('quota success and its completion record wait for durable acknowledgement',async()=>capture(async rows=>{
 const commit=deferred(),waiting=deferred();let completed=false;
 const f=bufferedQuota(()=>{waiting.resolve();return commit.promise;});
 const pending=f.quota.fetch(request()).then(result=>{completed=true;return result;});
 await waiting.promise;
 assert.equal(f.puts(),1);assert.equal(completed,false);
 assert.deepEqual(rows.map(r=>r.event),['quota_handler_start','quota_commit_wait']);
 commit.resolve();assert.equal((await pending).status,204);
 assert.equal(rows.at(-1).event,'quota_handler');assert.equal(rows.at(-1).durability_confirmed,true);
 assert.equal(rows.at(-1).phase,'complete');assert.equal(rows.at(-1).timing_version,2);
 assert.equal(f.buckets().request.count,1);
}));

test('a durability failure is recorded at its real phase and never reports success',async()=>capture(async rows=>{
 const error=Error('Internal error in Durable Object storage caused object to be reset; reference = private-reference');
 const f=bufferedQuota(async()=>{throw error;});
 await assert.rejects(f.quota.fetch(request()),e=>e===error);
 const result=rows.at(-1);
 assert.equal(result.status,503);assert.equal(result.phase,'durability');assert.equal(result.durability_confirmed,false);
 assert.equal(result.failure_code,'storage_reset');assert.equal(result.provider_reset,true);
 assert.equal(f.puts(),1);assert.doesNotMatch(JSON.stringify(rows),/private-reference/);
}));

test('deadline during acknowledgement neither recharges quota nor authorizes a backend mutation',async()=>capture(async rows=>{
 const commit=deferred(),waiting=deferred(),controller=new AbortController();let attempts=0,upstream=0;
 const f=bufferedQuota(()=>{waiting.resolve();return commit.promise;});
 const namespace={get:()=>({fetch:r=>{attempts++;return f.quota.fetch(r);}})};
 const pending=chargeNetworkQuota(namespace,'opaque','request',{trace,objectTag:tag,signal:controller.signal}).then(()=>{upstream++;});
 await waiting.promise;
 controller.abort(Object.assign(new DOMException('timed out','TimeoutError'),{retryable:true}));
 await assert.rejects(pending,{name:'TimeoutError'});
 assert.equal(attempts,1);assert.equal(upstream,0);assert.equal(f.puts(),1);
 commit.resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(attempts,1);assert.equal(upstream,0);assert.equal(f.buckets().request.count,1);
 assert.equal(rows.at(-1).durability_confirmed,true,'late acknowledgement does not reopen the gateway attempt');
}));

test('provider classifications are allowlisted and do not grant retry permission',()=>{
 assert.equal(providerFailureCode(Error('out of memory: SQLITE_NOMEM')),'sqlite_out_of_memory');
 assert.equal(providerFailureCode(Error('internal error; reference = private-id')),'provider_internal');
 assert.equal(providerFailureCode(Error('private arbitrary response')),null);
 assert.equal(providerRay('0123456789abcdef-ORD'),'0123456789abcdef-ORD');
 for(const value of ['private secret','0123456789abcdef-ORD extra','https://example.test/id',null])assert.equal(providerRay(value),null);
});

test('backend acknowledgement preserves intentional reasons and safe Postgres failure codes',async()=>capture(async rows=>{
 const req=new Request('https://fixture/v1/runs',{headers:{[TRACE_HEADER]:trace}});
 const response=await observedRoute(req,'draft',async()=>new Response(null,{status:503,headers:{[REASON_HEADER]:'practice_refreshing'}}));
 assert.equal(response.headers.get(TRACE_HEADER),trace);assert.equal(response.headers.get(REASON_HEADER),'practice_refreshing');
 assert.equal(rows.at(-1).reason,'practice_refreshing');
 await assert.rejects(observedRoute(req,'growth',async()=>{throw Object.assign(Error('private SQL detail'),{pgCode:'57014'});}));
 assert.equal(rows.at(-1).failure_code,'57014');assert.doesNotMatch(JSON.stringify(rows),/private SQL detail/);
}));

test('backend acknowledgement preserves immutable redirects and response cookies',async()=>capture(async()=>{
 const req=new Request('https://fixture/v1/account',{headers:{[TRACE_HEADER]:trace}});
 const redirect=await observedRoute(req,'growth',async()=>Response.redirect('https://packone.pro/',302));
 assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'https://packone.pro/');assert.equal(redirect.headers.get(TRACE_HEADER),trace);
 const headers=new Headers();headers.append('set-cookie','first=fixture; Secure');headers.append('set-cookie','second=fixture; Secure');
 const response=await observedRoute(req,'growth',async()=>new Response('fixture',{headers}));
 assert.deepEqual(response.headers.getSetCookie(),headers.getSetCookie());assert.equal(await response.text(),'fixture');
}));

test('upstream 520 retains only a bounded private reference and never retries creation',async()=>capture(async rows=>{
 let calls=0;
 const env={MODE:'production',NEON_BRANCH_ID:'br-orange-feather-ayps8kep',QUOTA_KEY:'1'.repeat(64),NETWORK_QUOTA:{idFromName:x=>x,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
 const result=await gateway(new Request('https://api.packone.pro/growth/v1/player/session',{method:'POST',body:'{}',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.1'}}),env,async()=>{
   calls++;return new Response('private provider body',{status:520,headers:{'cf-ray':'0123456789abcdef-ORD',[TRACE_HEADER]:'c'.repeat(32)}});
 });
 assert.equal(result.status,520);assert.equal(calls,1);
 assert.equal(rows[0].upstream_ray,'0123456789abcdef-ORD');assert.equal(rows[0].upstream_backend_ack,false);
 assert.equal(result.headers.get('cf-ray'),null);assert.equal(result.headers.get(TRACE_HEADER),null);
 assert.doesNotMatch(JSON.stringify(rows),/private provider body|192\.0\.2/);
}));

test('an acknowledged refresh cannot label a subsequent failed creation as acknowledged',async()=>capture(async rows=>{
 let calls=0;
 const env={MODE:'production',NEON_BRANCH_ID:'br-orange-feather-ayps8kep',QUOTA_KEY:'1'.repeat(64),NETWORK_QUOTA:{idFromName:x=>x,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
 const result=await gateway(new Request('https://api.packone.pro/growth/v1/player/session',{method:'POST',body:'{}',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.1',cookie:'__Host-pack1_player=browser-fixture'}}),env,async(url,options)=>{
   calls++;
   if(calls===1)return new Response(null,{status:401,headers:{'x-pack1-session-state':'missing',[TRACE_HEADER]:options.headers.get(TRACE_HEADER),'cf-ray':'0123456789abcdef-ORD'}});
   throw Object.assign(Error('private socket details'),{code:'ECONNRESET'});
 });
 assert.equal(result.status,503);assert.equal(calls,2);
 assert.equal(rows[0].upstream_backend_ack,false);assert.equal(rows[0].upstream_ray,null);assert.equal(rows[0].upstream_status,null);
 assert.equal(rows[0].upstream_failure_code,'transport_reset');assert.doesNotMatch(JSON.stringify(rows),/private socket details/);
}));
