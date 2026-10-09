import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyFixed8Compute} from '../scripts/verify-fixed-8cu-compute.mjs';

const branch='br-fixture-fixed-eight',start=Date.parse('2026-10-08T16:00:00Z');
const b={id:branch,parent_id:'br-orange-feather-ayps8kep',
  created_at:new Date(start).toISOString(),expires_at:new Date(start+75*60000).toISOString()};
const endpoint={id:'ep-fixed-eight',branch_id:branch,type:'read_write',
  autoscaling_limit_min_cu:8,autoscaling_limit_max_cu:8,suspend_timeout_seconds:300,
  current_state:'active',pending_state:null};
function mock({endpoints=[endpoint],branchData=b}={}) {
  const paths=[];
  const fetcher=async(url,options)=>{
    paths.push({url,method:options.method||'GET'});
    if(url.endsWith('/endpoints'))return Response.json({endpoints});
    if(url.endsWith('/branches/'+branch))return Response.json({branch:branchData});
    throw Error('unexpected_control_path');
  };
  return {paths,fetcher};
}
test('exact 8/8 endpoint, 300s suspension, isolated parent and ready read-back',async()=>{
  const m=mock(),result=await verifyFixed8Compute({branch,created:'true',
    token:'fixture',fetcher:m.fetcher,now:()=>start+1000,maxWaitMs:2000});
  assert.deepEqual([result.min_cu,result.max_cu,result.suspend_seconds],[8,8,300]);
  assert.equal(result.current_state,'active');
  assert.equal(m.paths.length,2);
  assert.ok(m.paths.every(x=>x.method==='GET'&&x.url.startsWith('https://console.neon.tech/')));
});
test('mismatched or missing compute settings fail before ANY gameplay or SQL',async()=>{
  for(const patch of [
    {autoscaling_limit_min_cu:.25},{autoscaling_limit_max_cu:7},
    {suspend_timeout_seconds:60},{branch_id:'br-other'},{type:'read_only'}
  ]) {
    const m=mock({endpoints:[{...endpoint,...patch}]});
    await assert.rejects(verifyFixed8Compute({branch,created:'true',token:'fixture',
      fetcher:m.fetcher,now:()=>start+1000,maxWaitMs:0}),/mismatch/);
    assert.ok(m.paths.every(x=>x.method==='GET'),'Must never send writes or gateway calls');
  }
  for(const result of [{...b,parent_id:'br-other'}, {...b,expires_at:new Date(start+76*60000).toISOString()}]) {
    const m=mock({branchData:result});
    await assert.rejects(verifyFixed8Compute({branch,created:'true',token:'fixture',fetcher:m.fetcher}),
      /disposable_scope_or_expiry/);
  }
});
test('transitional endpoint state waits using control-plane GET only, then fails closed',async()=>{
  const m=mock({endpoints:[{...endpoint,current_state:'init'}]});
  let ms=0;
  await assert.rejects(verifyFixed8Compute({branch,created:'true',token:'fixture',fetcher:m.fetcher,
    now:()=>start+ms,sleep:async delta=>{ms+=delta;},maxWaitMs:2500}),/not_ready/);
  assert.ok(m.paths.length>=2&&m.paths.every(x=>x.method==='GET'));
  const m2=mock();let waiting=0;
  const change=async(url,o)=>{
    if(url.endsWith('/endpoints')&&waiting===0) {
      waiting++;return Response.json({endpoints:[{...endpoint,current_state:'init'}]});
    }
    return m2.fetcher(url,o);
  };
  let ticks=0;
  const ok=await verifyFixed8Compute({branch,created:'true',token:'fixture',
    fetcher:change,now:()=>start+ticks,sleep:async delta=>{ticks+=delta;}});
  assert.equal(ok.current_state,'active');
});
test('fixed 8-CU launch workflow guard excludes normal acceptance and metadata batching',async()=>{
  const fs=await import('node:fs');
  const child=fs.readFileSync('.github/workflows/launch-distributed-preview.yml','utf8');
  const once=fs.readFileSync('.github/workflows/launch-full-100-once.yml','utf8');
  assert.match(child,/CI_BRANCH_FIXED_CU:.*inputs.capacity_target == '100'/);
  assert.match(child,/node scripts\/verify-fixed-8cu-compute\.mjs/);
  assert.ok(child.indexOf('verify-fixed-8cu-compute.mjs') <
    child.indexOf('Prepare isolated schema and exact revision'));
  assert.match(once,/diagnostic\/fixed8-direct100-once-20261008-r1/);
  assert.match(once,/types: \[opened\]/);
  assert.doesNotMatch(once,/synchronize|workflow_dispatch/);
  const manifest=JSON.parse(fs.readFileSync('migrations/manifest.json','utf8'));
  assert.equal(manifest.ordered.at(-1),'0058_owner_guard_admin_deletion.sql');
  assert.ok(!manifest.ordered.some(x=>x.startsWith('0059_')));
});
