import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';

test('local domain runner rejects nonlocal database addresses before starting a suite',()=>{
  for(const connection of ['postgresql://pack1_ci:fixture@remote.invalid/pack1','postgresql://owner:fixture@127.0.0.1/pack1',
    'postgresql://pack1_ci:fixture@127.0.0.1/production']) {
    const result=spawnSync(process.execPath,['scripts/run-local-backend-domain.mjs','account'],{
      encoding:'utf8',env:{...process.env,PACK1_TEST_DATABASE_URL:connection},timeout:10000,
    });
    assert.notEqual(result.status,0);assert.match(result.stderr,/Database fixtures require a local pack1 database/);
    assert.doesNotMatch(result.stdout,/Local PostgreSQL integration suite/);
  }
});

test('local qualification cannot run an unreviewed domain or arbitrary imported suite',()=>{
  for(const args of [['scripts/run-local-backend-domain.mjs','corpus'],['tests/support/local-backend-suite.mjs','worker/index.js']]) {
    const result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Only (the account domain|reviewed account suites)/);
  }
});

test('only qualified narrow account scope can omit a Neon branch; broad and invalid scope fail closed',async()=>{
  const {backendExecutionPlan,loadBackendMap}=await import('../scripts/backend-gate-scope.mjs');
  const allDomains=Object.keys(loadBackendMap().domains);
  assert.ok(allDomains.includes('corpus_readiness'),'slow corpus tests must remain a required domain');
  assert.deepEqual(backendExecutionPlan({fullSuite:false,domains:['account']}),{localDomains:['account'],neonDomains:[]});
  assert.deepEqual(backendExecutionPlan({fullSuite:false,domains:['account','daily']}),{localDomains:['account'],neonDomains:['daily']});
  for(const result of [{},{fullSuite:true,domains:['account']},{fullSuite:false,domains:[]},
    {fullSuite:false,domains:['unknown']},{fullSuite:false,domains:['account','account']}])
    assert.equal(backendExecutionPlan(result).neonDomains.length,allDomains.length);
  assert.ok(backendExecutionPlan({fullSuite:true,domains:['account']}).neonDomains.includes('corpus_readiness'));
});

test('aggregate cannot accept a missing local contract, skipped required Neon domain or inconsistent classification',async()=>{
  const {verifyBackendExecution}=await import('../scripts/verify-backend-execution.mjs');
  const local={precheck:'success',postgres:'success',neon:'skipped',full:false,domains:['account'],neonDomains:[]};
  assert.doesNotThrow(()=>verifyBackendExecution(local));
  for(const bad of [{postgres:'failure'},{postgres:'skipped'},{neon:'failure'},{neonDomains:['account']},
    {full:true},{domains:['account','daily']},{domains:[]}])assert.throws(()=>verifyBackendExecution({...local,...bad}));
  assert.doesNotThrow(()=>verifyBackendExecution({...local,domains:['account','daily'],neonDomains:['daily'],neon:'success'}));
  assert.throws(()=>verifyBackendExecution({...local,precheck:'failure'}));
  assert.doesNotThrow(()=>verifyBackendExecution({...local,precheck:'failure',neon:'success'}));
});

test('draft PRs defer required Neon domains but never pass without them',async()=>{
  const {verifyBackendExecution}=await import('../scripts/verify-backend-execution.mjs');
  const draft={precheck:'success',postgres:'success',neon:'skipped',full:false,domains:['account','daily'],neonDomains:['daily'],draft:true};
  assert.throws(()=>verifyBackendExecution(draft),/deferred while this PR is a draft \(daily\)/);
  assert.throws(()=>verifyBackendExecution({...draft,precheck:'failure'}),/deferred while this PR is a draft/);
  assert.throws(()=>verifyBackendExecution({...draft,postgres:'failure'}),/Real PostgreSQL contracts/);
  // Account-only scope needs no Neon branch, so a draft passes as before.
  assert.doesNotThrow(()=>verifyBackendExecution({...draft,domains:['account'],neonDomains:[]}));
  // Not a draft: a skipped required domain is still a plain failure.
  assert.throws(()=>verifyBackendExecution({...draft,draft:false}),/Required Neon domains must pass/);
});

test('backend gate skips Neon branches on draft PRs and reruns when marked ready',()=>{
  const flow=fs.readFileSync('.github/workflows/backend-gate.yml','utf8');
  assert.match(flow,/  pull_request:\n    types: \[opened, synchronize, reopened, ready_for_review\]\n    paths:/);
  const domain=flow.split('\n  backend-domain:\n')[1].split('\n  backend-gate:\n')[0];
  assert.match(domain,/if: \$\{\{ !cancelled\(\)[^\n]*&& github\.event\.pull_request\.draft != true \}\}/);
  assert.match(flow,/PR_DRAFT: \$\{\{ github\.event\.pull_request\.draft == true \}\}\n        run: node scripts\/verify-backend-execution\.mjs/);
});
