import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

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
  const {backendExecutionPlan}=await import('../scripts/backend-gate-scope.mjs');
  assert.deepEqual(backendExecutionPlan({fullSuite:false,domains:['account']}),{localDomains:['account'],neonDomains:[]});
  assert.deepEqual(backendExecutionPlan({fullSuite:false,domains:['account','daily']}),{localDomains:['account'],neonDomains:['daily']});
  for(const result of [{},{fullSuite:true,domains:['account']},{fullSuite:false,domains:[]},
    {fullSuite:false,domains:['unknown']},{fullSuite:false,domains:['account','account']}])
    assert.equal(backendExecutionPlan(result).neonDomains.length,6);
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
