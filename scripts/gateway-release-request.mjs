import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const repository='killjoy00/mtg-ev-analyzer';
export function parseGatewayReleaseRequest(value) {
  assert.ok(value&&!Array.isArray(value)&&typeof value==='object','Gateway request must be an object.');
  assert.deepEqual(Object.keys(value).sort(),['operation','production_run_id','reason','source_sha']);
  assert.equal(value.operation,'deploy-gateway');
  assert.match(value.source_sha||'',/^[a-f0-9]{40}$/);
  assert.match(value.production_run_id||'',/^[1-9][0-9]{4,20}$/);
  assert.ok(typeof value.reason==='string'&&value.reason.trim(),'Reviewed release reason is required.');
  return value;
}

export function verifyGatewaySourceRun(request,run) {
  assert.equal(run.id.toString(),request.production_run_id);
  assert.equal(run.repository?.full_name,repository);
  assert.equal(run.path,'.github/workflows/deploy-functions.yml');
  assert.equal(run.event,'workflow_dispatch');
  assert.equal(run.head_branch,'main');
  assert.equal(run.status,'completed');
  assert.equal(run.conclusion,'success');
  assert.equal(run.display_title,'deploy production '+request.source_sha);
}

async function main() {
  assert.equal(process.env.GITHUB_REPOSITORY,repository);
  const request=parseGatewayReleaseRequest(JSON.parse(fs.readFileSync('.github/gateway-release-request.json','utf8')));
  execFileSync('git',['merge-base','--is-ancestor',request.source_sha,'origin/main']);
  const source=execFileSync('git',['show',request.source_sha+':draft-run.mjs'],{encoding:'utf8'});
  assert.match(source,/DRAFT_RUN_CORPUS_VERSION = 'elite-trophy-colour-stage-v9'/,'Gateway promotion must retain the deployed v9 runtime.');
  const response=await fetch(`https://api.github.com/repos/${repository}/actions/runs/${request.production_run_id}`,{
    headers:{authorization:'Bearer '+process.env.GH_TOKEN,accept:'application/vnd.github+json'},
    redirect:'error',signal:AbortSignal.timeout(30000),
  });
  assert.equal(response.status,200,'Require accessible production deployment evidence.');
  verifyGatewaySourceRun(request,await response.json());
  fs.appendFileSync(process.env.GITHUB_OUTPUT,'source_sha='+request.source_sha+'\n');
  console.log('Reviewed gateway source has successful exact-revision production deployment evidence.');
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
