import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyFixed8Compute} from '../scripts/verify-fixed-8cu-compute.mjs';
const start=Date.parse('2026-10-08T16:00:00Z'),branch='br-fixture-eight-cu';
const b={id:branch,parent_id:'br-orange-feather-ayps8kep',
 created_at:new Date(start).toISOString(),expires_at:new Date(start+75*60000).toISOString()};
const original={id:'ep-owned-compute',branch_id:branch,type:'read_write',
 autoscaling_limit_min_cu:0.25,autoscaling_limit_max_cu:8,
 suspend_timeout_seconds:300,current_state:'active',pending_state:null};
function api({base=original,owned=b,apply=true}={}) {
 let endpoint={...base};const calls=[];
 const fetcher=async(url,options={})=>{
  const method=options.method||'GET';
  calls.push({url,method,body:options.body});
  if(url.endsWith('/branches/'+branch)&&method==='GET')return Response.json({branch:owned});
  if(url.endsWith('/branches/'+branch+'/endpoints')&&method==='GET')
    return Response.json({endpoints:[endpoint]});
  if(url.endsWith('/endpoints/'+endpoint.id)&&method==='PATCH') {
    assert.deepEqual(JSON.parse(options.body),{endpoint:{
      autoscaling_limit_min_cu:8,autoscaling_limit_max_cu:8}});
    if(apply)endpoint={...endpoint,autoscaling_limit_min_cu:8,autoscaling_limit_max_cu:8};
    return Response.json({endpoint});
  }
  assert.fail('unexpected API path '+url);
 };
 return {calls,fetcher};
}
const opts=(a,clock=()=>start+1000)=>({branch,created:'true',token:'fixture',
 fetcher:a.fetcher,now:clock,sleep:async()=>{},maxWaitMs:0});
test('disposable endpoint is changed to fixed 8 CU once and read back before any SQL',async()=>{
 const a=api();
 const out=await verifyFixed8Compute(opts(a));
 assert.deepEqual([out.min_cu,out.max_cu,out.suspend_seconds],[8,8,300]);
 assert.equal(out.patch_issued,true);
 assert.equal(a.calls.filter(x=>x.method==='PATCH').length,1);
 assert.equal(a.calls.filter(x=>x.method==='GET').length,3);
 assert.ok(a.calls.every(x=>x.url.startsWith('https://console.neon.tech/api/v2/projects/')));
});
test('already-fixed endpoint needs no extra configuration',async()=>{
 const a=api({base:{...original,autoscaling_limit_min_cu:8}});
 const out=await verifyFixed8Compute(opts(a));
 assert.equal(out.patch_issued,false);
 assert.ok(a.calls.every(x=>x.method==='GET'));
});
test('configuration failure or stale control-plane readback rejects; never reports fixed 8 CU',async()=>{
 const a=api({apply:false});
 await assert.rejects(verifyFixed8Compute(opts(a)),/not_8_cu_or_not_ready/);
 assert.equal(a.calls.filter(x=>x.method==='PATCH').length,1);
 const wrong=api({base:{...original,branch_id:'br-unowned'}});
 await assert.rejects(verifyFixed8Compute(opts(wrong)),/endpoint_ownership_mismatch/);
 assert.equal(wrong.calls.filter(x=>x.method==='PATCH').length,0);
 const bad=api({base:{...original,suspend_timeout_seconds:60}});
 await assert.rejects(verifyFixed8Compute(opts(bad)),/suspension_mismatch/);
 assert.equal(bad.calls.filter(x=>x.method==='PATCH').length,0);
});
test('only a freshly created owned clone with a 75-minute expiry can be configured',async()=>{
 for(const changed of [{...b,parent_id:'br-other'},
   {...b,expires_at:new Date(start+76*60000).toISOString()}]) {
  const a=api({owned:changed});
  await assert.rejects(verifyFixed8Compute(opts(a)),/disposable_scope_or_expiry_mismatch/);
  assert.equal(a.calls.filter(x=>x.method==='PATCH').length,0);
 }
 const a=api();
 await assert.rejects(verifyFixed8Compute({...opts(a),created:'false'}),/fresh disposable clone/);
 assert.equal(a.calls.length,0);
});
test('transitional compute is never configured before it is ready',async()=>{
 const a=api({base:{...original,current_state:'init'}});
 await assert.rejects(verifyFixed8Compute(opts(a)),/not_ready_for_config/);
 assert.equal(a.calls.filter(x=>x.method==='PATCH').length,0);
});
test('workflow is guarded, excludes 0059, checks fixed 8 before schema and preserves 334 budget',()=>{
 const child=fs.readFileSync('.github/workflows/launch-distributed-preview.yml','utf8');
 const once=fs.readFileSync('.github/workflows/launch-full-100-once.yml','utf8');
 const manifest=JSON.parse(fs.readFileSync('migrations/manifest.json','utf8'));
 assert.match(child,/run: node scripts\/create-ci-neon-branch\.mjs/);
 assert.match(child,/node scripts\/verify-fixed-8cu-compute\.mjs/);
 assert.ok(child.indexOf('verify-fixed-8cu-compute.mjs')<
   child.indexOf('Prepare isolated schema and exact revision'));
 assert.match(once,/diagnostic\/fixed8-direct100-once-20261008-r1/);
 assert.match(once,/types: \[opened\]/);assert.doesNotMatch(once,/synchronize|workflow_dispatch/);
 assert.equal(manifest.ordered.at(-1),'0058_owner_guard_admin_deletion.sql');
 assert.equal(manifest.ordered.some(x=>x.startsWith('0059_')),false);
 const planned=2*(8+2+30+3+8)+(9+15+5*30+7);
 assert.equal(planned,283);assert.ok(planned<=334);
});
