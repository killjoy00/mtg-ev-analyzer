import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseGatewayReleaseRequest,verifyGatewaySourceRun} from '../scripts/gateway-release-request.mjs';

const request={operation:'deploy-gateway',source_sha:'a'.repeat(40),production_run_id:'123456',reason:'Accepted v9 source'};
const run={id:123456,repository:{full_name:'killjoy00/mtg-ev-analyzer'},path:'.github/workflows/deploy-functions.yml',event:'workflow_dispatch',head_branch:'main',status:'completed',conclusion:'success',display_title:'deploy production '+request.source_sha};

test('gateway-only request refuses arbitrary targets, partial SHAs and missing evidence',()=>{
  assert.deepEqual(parseGatewayReleaseRequest(request),request);
  for(const value of [null,[],{...request,host:'other.test'},{...request,source_sha:'a'.repeat(7)},
    {...request,production_run_id:'0'},{...request,reason:''},{...request,operation:'deploy-secure-auth'}])
    assert.throws(()=>parseGatewayReleaseRequest(value));
});

test('gateway source requires successful production promotion of the exact pinned revision',()=>{
  verifyGatewaySourceRun(request,run);
  for(const changed of [{conclusion:'failure'},{status:'in_progress'},{head_branch:'feature'},
    {event:'pull_request'},{path:'.github/workflows/test.yml'},
    {repository:{full_name:'another/repository'}},{id:999999},
    {display_title:'deploy development '+request.source_sha},{display_title:'deploy production '+'b'.repeat(40)}])
    assert.throws(()=>verifyGatewaySourceRun(request,{...run,...changed}));
});

test('gateway-only promotion has no schema replay or Function upload and always revokes QA access',()=>{
  const workflow=fs.readFileSync('.github/workflows/gateway-production-release.yml','utf8');
  assert.match(workflow,/group: pack1-secure-auth-release/);
  assert.match(workflow,/ref: \$\{\{ steps.request.outputs.source_sha \}\}/);
  assert.match(workflow,/edge-production-control\.mjs preflight/);
  assert.match(workflow,/edge-production-control\.mjs deploy/);
  assert.doesNotMatch(workflow,/psql|migrations\/|functions deploy|v5-corpus-cutover|warm-practice-cache/);
  assert.match(workflow,/Remove temporary administrative access[\s\S]*?if: always\(\)/);
});
