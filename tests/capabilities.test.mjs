import test from 'node:test';
import assert from 'node:assert/strict';
import {accountCapabilities,requireCapability,practiceCapability,applyProviderEvent} from '../worker/capabilities.mjs';
test('anonymous has no practice capability; free identity adds regular practice',async()=>{
  assert.deepEqual(await accountCapabilities(null,()=>{throw Error('No anonymous grant query');}),[]);
  assert.deepEqual(await accountCapabilities({auth_user_id:'account'},async()=>({rows:[]})),['account','unlimited_regular_practice']);
  assert.throws(()=>requireCapability([],practiceCapability('mixed')),e=>e.status===403);
  requireCapability(['account','unlimited_regular_practice'],practiceCapability('mixed'));
  assert.throws(()=>requireCapability(['account','unlimited_regular_practice'],practiceCapability('powered-cube')),e=>e.capability==='unlimited_cube_practice');
  assert.equal(practiceCapability('mixed',['neo']),'custom_corpus');
});
test('provider events cannot grant arbitrary capabilities or bypass verification',async()=>{
  let writes=0;const query=async()=>{writes++;};
  await assert.rejects(applyProviderEvent({id:'future-provider',verifyAndResolve:async()=>{throw Error('Bad signature');}}, {},query),/Bad signature/);
  await assert.rejects(applyProviderEvent({id:'future-provider',verifyAndResolve:async()=>({capability:'admin'})},{},query),/Invalid/);
  assert.equal(writes,0);
});
