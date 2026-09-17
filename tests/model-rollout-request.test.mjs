import test from 'node:test';
import assert from 'node:assert/strict';
import {rolloutDispatch} from '../scripts/model-rollout-request.mjs';

const common={request_id:'test-request',reason:'Exercise the reviewed rollout path'};
test('rollout requests can target only fixed workflows on main',()=>{
  assert.deepEqual(rolloutDispatch({...common,operation:'deploy',target:'development',commit:'a'.repeat(40)}),{
    workflow:'deploy-functions.yml',body:{ref:'main',inputs:{target:'development',commit:'a'.repeat(40)}},
  });
  assert.equal(rolloutDispatch({...common,operation:'import',target:'build-only',sets:'ktk,powered-cube'}).workflow,'import-all-trophies.yml');
  for(const request of [
    {...common,operation:'arbitrary-command'},
    {...common,operation:'browser',ref:'unreviewed'},
    {...common,operation:'deploy',target:'production',commit:'main'},
    {...common,operation:'import',target:'production',sets:'all; echo unexpected'},
    {...common,operation:'import',target:'another-database',sets:'all'},
  ])assert.throws(()=>rolloutDispatch(request));
});
