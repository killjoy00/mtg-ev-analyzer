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
  assert.ok(workflow.indexOf('node scripts/verify-image-refresh-release.mjs')<workflow.indexOf('aws s3 sync'));
  assert.match(workflow,/name: Refresh production Draft Run image metadata\s+run: \|\s+node scripts\/verify-image-refresh-release.mjs\s+node scripts\/refresh_powered_cube_backend_images.mjs/);
  const acceptance=fs.readFileSync(new URL('./release-functions-smoke.mjs',import.meta.url),'utf8');
  assert.equal((acceptance.match(/await verifyMarkers\(\)/g)||[]).length,2,'Release acceptance checks markers before and after gameplay');
});
