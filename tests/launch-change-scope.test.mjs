import test from 'node:test';
import assert from 'node:assert/strict';
import {adminOnlyGatewayPatch,classifyLaunchChange} from '../scripts/launch-change-scope.mjs';

const patch=lines=>[
  'diff --git a/edge/gateway.mjs b/edge/gateway.mjs',
  '--- a/edge/gateway.mjs',
  '+++ b/edge/gateway.mjs',
  '@@ -1,0 +1,'+lines.length+' @@',
  ...lines.map(line=>'+'+line),
].join('\n');

test('admin-only gateway route changes skip the production-like load rehearsal',()=>{
  const gatewayPatch=patch([
    "    if(mode==='production'&&method==='POST'&&path==='/v1/admin/campaign-links/publish')return true;",
    "  if(path==='/growth/v1/admin/campaign-links/publish')return 'admin_campaign_publish';",
  ]);
  assert.equal(adminOnlyGatewayPatch(gatewayPatch),true);
  assert.deepEqual(classifyLaunchChange({files:['edge/gateway.mjs'],gatewayPatch}),{runLoad:false,reason:'admin_only_gateway'});
});

test('admin regex additions inside the isolated admin route matcher can skip the load rehearsal',()=>{
  const gatewayPatch=patch([
    "  if(/^\\/v1\\/admin\\/corpus\\/[a-z0-9-]+\\/status$/.test(path)&&method==='POST')return true;",
  ]);
  assert.equal(adminOnlyGatewayPatch(gatewayPatch),true);
});

test('shared, gameplay, quota and ambiguous gateway edits still require the full load rehearsal',()=>{
  for(const line of [
    "    if(method==='POST'&&path==='/v1/runs')return true;",
    "    const limits=[['request',7200,60000]];",
    "    if(origin&&!ORIGINS.has(origin))return finish(response(403,'Origin not allowed.'));",
    "    if(path==='/v1/runs'||path==='/v1/admin/example')return true;",
  ]) {
    const gatewayPatch=patch([line]);
    assert.equal(classifyLaunchChange({files:['edge/gateway.mjs'],gatewayPatch}).runLoad,true,line);
  }
});

test('capacity-sensitive application and harness paths always require the load rehearsal',()=>{
  for(const file of [
    'worker/draft-run-function.mjs',
    'worker/draft-run-selection.mjs',
    'worker/draft-start-timing.mjs',
    'migrations/0045_batched_practice_selector.sql',
    'scripts/edge-control.mjs',
    'scripts/launch-distributed-run.mjs',
    'scripts/launch-distributed-policy.json',
  ])assert.equal(classifyLaunchChange({files:[file]}).runLoad,true,file);
});

test('workflow, classifier and test-only changes stay on fast regression coverage',()=>{
  assert.deepEqual(classifyLaunchChange({files:[
    '.github/workflows/launch-distributed.yml',
    'scripts/launch-change-scope.mjs',
    'tests/launch-change-scope.test.mjs',
    'tests/launch-distributed-capacity.test.mjs',
  ]}),{runLoad:false,reason:'meta_or_test_only'});
});

test('missing gateway diff evidence fails safe into the full rehearsal',()=>{
  assert.deepEqual(classifyLaunchChange({files:['edge/gateway.mjs'],gatewayPatch:''}),{runLoad:true,reason:'shared_or_gameplay_gateway'});
});
