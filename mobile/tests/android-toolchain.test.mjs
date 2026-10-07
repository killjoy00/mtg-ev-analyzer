import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('Android dependency preparation rejects corrupt archives, version drift and partial installations',()=>{
  const result=spawnSync('python3',['-m','unittest','discover','-s','tests','-p','test_android_toolchain.py'],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  assert.match(result.stderr,/Ran 7 tests/);
});
