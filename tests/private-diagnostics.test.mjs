import test from 'node:test';
import assert from 'node:assert/strict';
import {NetworkQuota,chargeNetworkQuota,gateway} from '../edge/gateway.mjs';
import {TRACE_HEADER,REASON_HEADER} from '../edge/private-diagnostics.mjs';
import {observedRoute,tagBackendResponse} from '../worker/backend-diagnostics.mjs';
import {servingCacheUnavailable} from '../worker/draft-run-selection.mjs';
const trace='a'.repeat(32),tag='b'.repeat(32);
async function logs(fn){const old=console.log,rows=[];console.log=s=>rows.push(JSON.parse(s));try{return {result:await fn(),rows};}finally{console.log=old;}}
test('quota handler correlates bounded operation timings without input identities',async()=>{
 let buckets,alarm=null;const tx={get:async k=>Array.isArray(k)?new Map():buckets,put:async(k,v)=>{buckets=v;},getAlarm:async()=>alarm,setAlarm:async v=>{alarm=v;}};
 const quota=new NetworkQuota({storage:{transaction:fn=>fn(tx)}});
 const {result,rows}=await logs(()=>quota.fetch(new Request('https://quota/session',{method:'POST',headers:{[TRACE_HEADER]:trace,'x-pack1-quota-tag':tag}})));
 assert.equal(result.status,204);assert.equal(buckets.request.count,1);assert.equal(buckets.session.count,1);
 assert.equal(rows.length,2);const metric=rows[1];assert.equal(metric.trace,trace);assert.equal(metric.object_tag,tag);assert.equal(metric.concurrency,1);
 for(const key of ['handler_ms','transaction_ms','get_ms','put_ms','alarm_get_ms','alarm_set_ms'])assert.ok(Number.isFinite(metric[key]));
 assert.equal(metric.transaction_callbacks,1);assert.doesNotMatch(JSON.stringify(rows),/buckets|until|count|secret|session_id|192\.0\.2/);
});
test('a committed debit whose acknowledgement hangs times out once and never reaches application code',async()=>{
 let debits=0;const controller=new AbortController();
 const pending=chargeNetworkQuota({get:()=>({fetch:async()=>{debits++;await new Promise(()=>{});}})},'opaque','request',{signal:controller.signal});
 await new Promise(r=>setTimeout(r,5));controller.abort(Object.assign(new DOMException('timeout','TimeoutError'),{retryable:true}));
 await assert.rejects(pending,{name:'TimeoutError'});assert.equal(debits,1);
});
test('gateway replaces caller correlation, strips private headers, classifies failures without reading bodies or retrying mutations',async()=>{
 for(const status of [503,520,522]){
 let upstream=0;const env={MODE:'production',NEON_BRANCH_ID:'br-orange-feather-ayps8kep',QUOTA_KEY:'1'.repeat(64),NETWORK_QUOTA:{idFromName:x=>x,get:()=>({fetch:async r=>{assert.match(r.headers.get(TRACE_HEADER),/^[a-f0-9]{32}$/);return new Response(null,{status:204,headers:{'x-pack1-quota-handler-ms':'1'}});}})}};
 const {result,rows}=await logs(()=>gateway(new Request('https://api.packone.pro/growth/v1/player/session',{method:'POST',body:'{}',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.1',[TRACE_HEADER]:trace}}),env,async(url,options)=>{
 upstream++;assert.notEqual(options.headers.get(TRACE_HEADER),trace);return new Response('private arbitrary response',{status,headers:{[REASON_HEADER]:status===503?'practice_refreshing':'private-cause'}});
 }));
 assert.equal(upstream,1);assert.equal(result.status,status);assert.equal(result.headers.get(REASON_HEADER),null);assert.equal(result.headers.get(TRACE_HEADER),null);
 assert.equal(rows[0].backend_reason,status===503?'practice_refreshing':null);assert.doesNotMatch(JSON.stringify(rows),/private-cause|arbitrary response|192\.0\.2/);
 }
});
test('backend readiness reason is finite and correlated across the intentional 503',async()=>{
 const error=servingCacheUnavailable();
 const {rows}=await logs(async()=>{await assert.rejects(observedRoute(new Request('https://fixture/v1/runs',{headers:{[TRACE_HEADER]:trace}}),'draft',async()=>{throw error;}));});
 assert.equal(rows[1].reason,'practice_refreshing');assert.equal(rows[1].trace,trace);
 assert.equal(tagBackendResponse(new Response(null,{status:503}),error).headers.get(REASON_HEADER),'practice_refreshing');
});
