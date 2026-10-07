import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPreviewOwner,cleanupOwnedDns,resourceReceipt} from '../scripts/preview-resource-ownership.mjs';
const owner={runId:123,attempt:2,branch:'br-ci-owned',sha:'a'.repeat(40)},record={id:'b'.repeat(32),name:'api-preview.packone.pro',type:'CNAME',content:'owned.example',proxied:true,created_on:'2026-10-07T12:00:00Z',modified_on:'2026-10-07T12:00:00Z'};
const settings={result:{bindings:Object.entries({MODE:'preview',NEON_BRANCH_ID:owner.branch,RELEASE_COMMIT:owner.sha,CI_PREVIEW_RUN:'123',CI_PREVIEW_ATTEMPT:'2'}).map(([name,text])=>({name,text,type:'plain_text'}))}};
test('cleanup identity requires the exact run, attempt, isolated branch and revision',()=>{
  assertPreviewOwner(settings,owner);
  for(const patch of [{runId:124},{attempt:1},{branch:'br-other'},{sha:'c'.repeat(40)}])assert.throws(()=>assertPreviewOwner(settings,{...owner,...patch}),/owner changed/);
  const receipt=resourceReceipt({...owner,expires:'2026-10-07T14:00:00Z',phase:'attached',records:[record]});
  assert.equal(receipt.dns[0].fingerprint.length,64);assert.ok(!JSON.stringify(receipt).includes(record.content));
  assert.throws(()=>resourceReceipt({...owner,branch:'br-orange-feather-ayps8kep',expires:'2026-10-07T14:00:00Z'}),/Invalid/);
});
test('DNS cleanup reconciles an unknown delete and refuses changed ownership or fingerprints',async()=>{
  let current=[record],writes=0;
  await cleanupOwnedDns({records:[record],readRecords:async()=>current,assertOwner:async()=>assertPreviewOwner(settings,owner),remove:async()=>{writes++;current=[];throw Error('provider timeout');}});
  assert.equal(writes,1);
  current=[{...record,modified_on:'2026-10-07T13:00:00Z'}];
  await assert.rejects(cleanupOwnedDns({records:[record],readRecords:async()=>current,assertOwner:async()=>{},remove:async()=>assert.fail('changed DNS must survive')}),/changed/);
  current=[record];
  await assert.rejects(cleanupOwnedDns({records:[record],readRecords:async()=>current,assertOwner:async()=>assertPreviewOwner(settings,{...owner,runId:999}),remove:async()=>assert.fail('another run must survive')}),/owner changed/);
});
