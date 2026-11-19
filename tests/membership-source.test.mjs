import test from 'node:test';
import assert from 'node:assert/strict';
import {eliteSource} from '../membership-source.mjs';

const ELITE=['custom_corpus','unlimited_cube_practice'];
const ACCOUNT=['account','unlimited_regular_practice',...ELITE];

test('Patreon provenance wins so Patreon members keep their management link',()=>{
  assert.equal(eliteSource({capabilities:ELITE,account_capabilities:ACCOUNT,apple_subscription_active:true}),'patreon');
});

test('an Apple subscriber is identified so pages do not send them to Patreon',()=>{
  assert.equal(eliteSource({capabilities:[],account_capabilities:ACCOUNT,apple_subscription_active:true}),'apple');
});

test('Elite from any other source is still Elite',()=>{
  assert.equal(eliteSource({capabilities:[],account_capabilities:ACCOUNT}),'other');
});

test('partial or missing capabilities are not Elite',()=>{
  for(const status of [null,undefined,{},{capabilities:['custom_corpus']},{account_capabilities:['account','custom_corpus']},{capabilities:'custom_corpus,unlimited_cube_practice'},{apple_subscription_active:true},{apple_subscription_active:true,account_capabilities:['account']}])
    assert.equal(eliteSource(status),null);
});
