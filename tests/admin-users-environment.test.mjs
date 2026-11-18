import test from 'node:test';
import assert from 'node:assert/strict';
import {runEnvironmentLabel} from '../admin/users.mjs';

test('admin Users run table distinguishes Latest from Regular and Powered Cube',()=>{
  assert.equal(runEnvironmentLabel('mixed'),'Regular');
  assert.equal(runEnvironmentLabel('powered-cube'),'Powered Cube');
  assert.equal(runEnvironmentLabel('latest'),'Latest Set');
  assert.equal(runEnvironmentLabel('future-draft'),'future-draft',
    'unexpected stored environments are not falsely labeled Regular');
});
