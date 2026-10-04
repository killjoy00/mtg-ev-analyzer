// Reviewed main-only promotion of one exact derived draw migration.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function validateRequest(r) {
 assert.deepEqual(Object.keys(r).sort(),['load_run_id','performance_run_id','request_id','source_sha','target'].sort());
 assert.ok(['development','production'].includes(r.target));
 assert.match(r.source_sha,/^[a-f0-9]{40}$/);
 assert.match(r.request_id,/^exact-pick-889-[a-z0-9-]+$/);
 for(const id of [r.performance_run_id,r.load_run_id])assert.ok(Number.isSafeInteger(id)&&id>0);
 return r;
}
export async function verifyAcceptance(r,get) {
 for(const [id,path] of [[r.performance_run_id,'.github/workflows/practice-performance.yml'],[r.load_run_id,'.github/workflows/launch-distributed.yml']]) {
  const run=await get('/actions/runs/'+id);
  assert.equal(run.head_sha,r.source_sha,'Accepted experiment must use this exact source');
  assert.equal(run.path,path);assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
 }
 const checks=await get('/commits/'+r.source_sha+'/check-runs?per_page=100');
 for(const name of ['test','browser','backend-gate']) {
  const check=checks.check_runs.find(c=>c.head_sha===r.source_sha&&c.name===name&&c.app?.slug==='github-actions');
  assert.ok(check,'Missing exact-source '+name);assert.equal(check.status,'completed');assert.equal(check.conclusion,'success');
 }
}
export async function main() {
 const r=validateRequest(JSON.parse(fs.readFileSync('.github/practice-draw-release-request.json','utf8')));
 execFileSync('git',['merge-base','--is-ancestor',r.source_sha,'origin/main']);
 const repo=process.env.GITHUB_REPOSITORY,headers={authorization:'Bearer '+process.env.GH_TOKEN,accept:'application/vnd.github+json'};
 async function get(path) {
  const response=await fetch('https://api.github.com/repos/'+repo+path,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,'Reviewed GitHub gate must be readable');return response.json();
 }
 await verifyAcceptance(r,get);
 fs.appendFileSync(process.env.GITHUB_OUTPUT,'source_sha='+r.source_sha+'\ntarget='+r.target+'\nbranch='+(r.target==='development'?'br-twilight-hill-ayffyd2b':'br-orange-feather-ayps8kep')+'\n');
 console.log(JSON.stringify({operation:'exact-pick-draw-schema',target:r.target,source_sha:r.source_sha,performance_run_id:r.performance_run_id,load_run_id:r.load_run_id}));
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)await main();
