import test from 'node:test';
import assert from 'node:assert/strict';
import {planJsTests,DATA_TESTS} from '../scripts/run-js-tests.mjs';
const names=[...DATA_TESTS,'example.test.mjs'];
test('fast lane is independent of replay availability and retains corpus behavior checks',()=>{
  const plan=planJsTests(names,{lane:'fast'});
  assert.deepEqual(plan.selected,['draft-run-corpus.test.mjs','example.test.mjs']);
  assert.equal(plan.missing.length,0);
});
test('data lane fails if any required input or registered suite is missing',()=>{
  assert.throws(()=>planJsTests(names,{lane:'data'}),/Required replay/);
  assert.throws(()=>planJsTests(['example.test.mjs'],{lane:'fast'}),/Registered data suite missing/);
  const available=new Map(['msh','sos','tmt','ecl'].map(id=>[id,true]));
  assert.deepEqual(planJsTests(names,{lane:'data',available}).selected,[...DATA_TESTS].sort());
  assert.equal(planJsTests(names,{lane:'full',available}).selected.length,names.length);
});
test('an unknown lane cannot silently fall back to fewer tests',()=>{
  assert.throws(()=>planJsTests(names,{lane:'typo'}),/Unknown/);
});
