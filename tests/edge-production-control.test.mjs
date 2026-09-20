import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProductionRequest} from '../scripts/edge-production-control.mjs';

test('production secure-auth request is fixed and non-parameterized',()=>{
  assert.equal(parseProductionRequest({operation:'deploy-secure-auth',reason:'reviewed release'}),'deploy-secure-auth');
  for(const value of [
    null,
    {operation:'deploy-preview',reason:'x'},
    {operation:'deploy-secure-auth',reason:''},
    {operation:'deploy-secure-auth',reason:'x',host:'evil.test'},
  ])assert.throws(()=>parseProductionRequest(value));
});
