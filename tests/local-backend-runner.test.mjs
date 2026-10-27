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
