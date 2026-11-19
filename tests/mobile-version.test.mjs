import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareMarketingVersions,
  evaluateMobileVersion,
  normalizeMobileVersionPolicy,
} from '../worker/mobile-version.mjs';

const policy=normalizeMobileVersionPolicy({
  ios:{marketingVersion:'1.0',build:100},
  android:{marketingVersion:'1.2.3',build:200},
});

test('mobile version comparison treats omitted patch as zero',()=>{
  assert.equal(compareMarketingVersions('1.0','1.0.0'),0);
  assert.equal(compareMarketingVersions('1.0.1','1.0'),1);
  assert.equal(compareMarketingVersions('0.9.9','1.0'),-1);
});

test('server version policy supports current/newer builds and blocks older binaries',()=>{
  assert.equal(evaluateMobileVersion(policy,'ios','1.0',100).updateRequired,false);
  assert.equal(evaluateMobileVersion(policy,'ios','1.0',101).updateRequired,false);
  assert.equal(evaluateMobileVersion(policy,'ios','1.1',1).updateRequired,false);
  assert.equal(evaluateMobileVersion(policy,'ios','1.0',99).updateRequired,true);
  assert.equal(evaluateMobileVersion(policy,'ios','0.9.9',999999).updateRequired,true);
  assert.equal(evaluateMobileVersion(policy,'android','1.2.3',199).updateRequired,true);
});

test('malformed client and policy versions fail closed on the server endpoint contract',()=>{
  assert.throws(()=>evaluateMobileVersion(policy,'ios','banana',100),error=>error.status===400);
  assert.throws(()=>evaluateMobileVersion(policy,'windows','1.0',100),error=>error.status===400);
  assert.throws(()=>evaluateMobileVersion(policy,'ios','1.0','nope'),error=>error.status===400);
  assert.throws(
    ()=>normalizeMobileVersionPolicy({ios:{marketingVersion:'1.0',build:1},android:{marketingVersion:'bad',build:1}}),
    error=>error.status===503,
  );
});

test('store links are fixed to the official platform listings',()=>{
  assert.equal(evaluateMobileVersion(policy,'ios','0.9',1).storeUrl,'https://apps.apple.com/app/id6814318676');
  assert.equal(evaluateMobileVersion(policy,'android','0.9',1).storeUrl,'https://play.google.com/store/apps/details?id=pro.packone.app');
});
