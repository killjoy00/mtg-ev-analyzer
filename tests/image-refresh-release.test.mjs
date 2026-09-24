import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyImageRefreshRelease} from '../scripts/verify-image-refresh-release.mjs';
const revision='a'.repeat(40);
test('image refresh only reads quick health and requires one marked revision on all six functions',async()=>{
  const calls=[];
  const commit=await verifyImageRefreshRelease(async(url,options)=>{
    calls.push(url);assert.ok(options.signal instanceof AbortSignal);
    assert.match(url,/^https:\/\/br-(twilight-hill-ayffyd2b|orange-feather-ayps8kep)-(draftrunapi|pack1growth|pack1api)\.compute\.c-5\.us-east-2\.aws\.neon\.tech\/health\?quick=1$/);
    return Response.json({ok:true,release_commit:revision});
  });
  assert.equal(commit,revision);assert.equal(new Set(calls).size,6);
});
test('image refresh can require the exact promoted revision',async()=>{
  assert.equal(await verifyImageRefreshRelease(async()=>Response.json({ok:true,release_commit:revision}),revision),revision);
  await assert.rejects(
    verifyImageRefreshRelease(async()=>Response.json({ok:true,release_commit:revision}),'b'.repeat(40)),
    /does not match the requested release/,
  );
  await assert.rejects(
    verifyImageRefreshRelease(async()=>Response.json({ok:true,release_commit:revision}),'main'),
    /invalid expected release commit/,
  );
});
test('image refresh rejects unavailable, unmarked and mixed deployments before maintenance',async()=>{
  for(const health of [{ok:true,release_commit:null},{ok:false,release_commit:revision},{ok:true,release_commit:'main'}]) {
    await assert.rejects(verifyImageRefreshRelease(async()=>Response.json(health)),/no verified release marker/);
  }
  await assert.rejects(verifyImageRefreshRelease(async()=>new Response('',{status:503})),/health HTTP 503/);
  let calls=0;
  await assert.rejects(verifyImageRefreshRelease(async()=>Response.json({ok:true,release_commit:calls++<5?revision:'b'.repeat(40)})),/same revision/);
});
test('image maintenance cannot deploy functions and checks revisions before remote updates',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/refresh-powered-cube-images.yml',import.meta.url),'utf8');
  assert.doesNotMatch(workflow,/functions deploy|NEON_API_KEY|build-neon-functions/);
  assert.ok(workflow.indexOf('node scripts/verify-image-refresh-release.mjs')<workflow.indexOf('bash scripts/r2_replay_shards.sh upload'));
  assert.match(workflow,/name: Normalize all served cards to deterministic main art\s+run: python scripts\/refresh_card_images.py/);
  assert.match(workflow,/name: Publish normalized replay shards to R2\s+run: bash scripts\/r2_replay_shards.sh upload/);
  assert.match(workflow,/name: Refresh production Draft Run image metadata\s+run: \|\s+node scripts\/verify-image-refresh-release.mjs "\$\{\{ inputs\.code_commit \}\}"\s+node scripts\/refresh_card_backend_images.mjs/);
  assert.match(workflow,/pull-requests: write/);
  assert.match(workflow,/gh pr create/);
  assert.doesNotMatch(workflow,/push origin HEAD:main/);
  const publication=fs.readFileSync(new URL('../.github/workflows/publish-card-image-source.yml',import.meta.url),'utf8');
  assert.match(publication,/\[publish-card-image-source\]/);
  assert.match(publication,/bash scripts\/r2_replay_shards.sh hydrate/);
  assert.match(publication,/python scripts\/refresh_card_images.py/);
  assert.match(publication,/npm test/);
  assert.match(publication,/gh pr create/);
  const acceptance=fs.readFileSync(new URL('./release-functions-smoke.mjs',import.meta.url),'utf8');
  assert.equal((acceptance.match(/await verifyMarkers\(/g)||[]).length,2,'Release acceptance checks markers before and after gameplay');
  // The closing check is the one that catches a redeploy landing underneath an
  // acceptance run, so it must never wait for the revision to become right.
  assert.match(acceptance.slice(acceptance.lastIndexOf('await verifyMarkers(')),/^await verifyMarkers\(\)/,
    'The closing marker check must not be given a settle window');
});
