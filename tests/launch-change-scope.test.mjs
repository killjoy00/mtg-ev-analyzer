import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {adminOnlyGatewayPatch,classifyLaunchChange,requiresPracticePerformance} from '../scripts/launch-change-scope.mjs';

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
    '.github/scripts/maintain-serving-indexes.sql',
    'worker/draft-run-function.mjs',
    'worker/draft-run-selection.mjs',
    'worker/draft-start-timing.mjs',
    'migrations/0045_batched_practice_selector.sql',
    'migrations/0050_practice_recency_bias.sql',
    'migrations/0056_snapshot_aware_reroll_covering_index.sql',
    'scripts/edge-control.mjs',
    'scripts/create-ci-neon-branch.mjs',
    'scripts/control-read.mjs',
    '.github/preview-dns-recovery.json',
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


test('distributed load waits for practice baseline only when that workflow is actually triggered',()=>{
  for(const file of [
    'worker/draft-run-selection.mjs',
    'migrations/0045_batched_practice_selector.sql',
    'migrations/0050_practice_recency_bias.sql',
    'migrations/0051_exact_pick_draw_index.sql',
    'scripts/practice-performance.mjs',
    '.github/workflows/practice-performance.yml',
  ])assert.equal(requiresPracticePerformance([file]),true,file);
  for(const file of [
    'worker/draft-run-function.mjs',
    'worker/draft-start-timing.mjs',
    'edge/gateway.mjs',
    'scripts/edge-control.mjs',
    '.github/workflows/launch-distributed.yml',
  ])assert.equal(requiresPracticePerformance([file]),false,file);
  assert.equal(requiresPracticePerformance(['edge/gateway.mjs','worker/draft-run-selection.mjs']),true);
});


test('production-like load harnesses replay current serving schema before verification',()=>{
  for(const path of ['.github/workflows/launch-load.yml','.github/workflows/launch-distributed.yml']){
    const workflow=fs.readFileSync(path,'utf8');
    const i42=workflow.indexOf('migrations/0042_serving_revision_snapshot_staging.sql');
    const i43=workflow.indexOf('migrations/0043_corpus_activation_readiness.sql');
    const i44=workflow.indexOf('migrations/0044_snapshot_scoped_puzzle_uniqueness.sql');
    const i48=workflow.indexOf('migrations/0048_uncapped_v5_components.sql');
    const i49=workflow.indexOf('migrations/0049_cross_version_corpus_cutover.sql');
    const verify=workflow.indexOf('node scripts/verify-neon-schema.mjs');
    assert.ok(i42>=0&&i43>i42&&i44>i43&&i48>i44&&i49>i48&&verify>i49,path);
  }
});


test('production-like load harnesses warm readiness before fixture generation',()=>{
  for(const path of ['.github/workflows/launch-load.yml','.github/workflows/launch-distributed.yml']){
    const workflow=fs.readFileSync(path,'utf8');
    const verify=workflow.indexOf('node scripts/verify-neon-schema.mjs');
    const warm=workflow.indexOf('node scripts/warm-practice-cache.mjs');
    const fixture=workflow.indexOf('launch-load-fixtures.mjs')>=0
      ?workflow.indexOf('launch-load-fixtures.mjs')
      :workflow.indexOf('launch-distributed-fixtures.mjs');
    assert.ok(verify>=0&&warm>verify&&fixture>warm,path);
  }
});
