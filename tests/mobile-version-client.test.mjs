import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseVersionCheckResponse,
  resolveVersionCheck,
} from '../mobile/src/versionPolicy.ts';

const supported={
  ok:true,
  platform:'ios',
  updateRequired:false,
  installed:{marketingVersion:'1.0',build:100},
  minimum:{marketingVersion:'1.0',build:1},
  storeUrl:'https://apps.apple.com/app/id6814318676',
};

const required={
  ...supported,
  updateRequired:true,
  minimum:{marketingVersion:'1.1',build:101},
};

test('mobile client accepts a valid supported response',()=>{
  assert.deepEqual(parseVersionCheckResponse('ios',supported),{status:'allowed'});
});

test('mobile client blocks only on a valid update-required response',()=>{
  assert.deepEqual(parseVersionCheckResponse('ios',required),{
    status:'required',
    storeUrl:'https://apps.apple.com/app/id6814318676',
    minimum:{marketingVersion:'1.1',build:101},
  });
});

test('mobile client rejects malformed responses and non-store redirect URLs',()=>{
  assert.equal(parseVersionCheckResponse('ios',{...required,minimum:{marketingVersion:'bad',build:101}}),null);
  assert.equal(parseVersionCheckResponse('ios',{...required,storeUrl:'https://example.com/update'}),null);
  assert.equal(parseVersionCheckResponse('android',required),null);
});

test('malformed and unavailable version checks fail open',async()=>{
  assert.deepEqual(await resolveVersionCheck('ios',async()=>({ok:true,updateRequired:true})),{status:'allowed'});
  assert.deepEqual(await resolveVersionCheck('ios',async()=>{throw Error('offline');}),{status:'allowed'});
});
