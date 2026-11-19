import test from 'node:test';
import assert from 'node:assert/strict';
import {cardCommerceAllowed} from '../membership-source.mjs';
import {createCardCommerceController} from '../tcgplayer.mjs';

const elite=['custom_corpus','unlimited_cube_practice'];
test('card promotions are excluded for every Elite source and ad-free Supporter',()=>{
  for(const status of [undefined,{}, {ads_allowed:false}, {ads_allowed:true,ad_free:true},
    {ads_allowed:true,capabilities:elite}, {ads_allowed:true,account_capabilities:elite},
    {ads_allowed:true,account_capabilities:elite,apple_subscription_active:true}])
    assert.equal(cardCommerceAllowed(status),false);
  assert.equal(cardCommerceAllowed({ads_allowed:true,ad_free:false,account_capabilities:['account']}),true);
});
test('account changes hide links immediately and reject an older free-account response',async()=>{
  let complete;
  const pending=new Promise(resolve=>{complete=resolve;});
  let call=0;const seen=[];
  const refresh=createCardCommerceController({setAllowed:x=>seen.push(x),account:async()=>({user:{}}),
    membership:()=>++call===1?pending:Promise.resolve({ads_allowed:false,ad_free:true})});
  const old=refresh();await Promise.resolve();
  await refresh();complete({ads_allowed:true});await old;
  assert.deepEqual(seen,[false,false,false]);
});
test('guests can see card links, but membership and account failures remain hidden',async()=>{
  for(const [account,expected] of [[async()=>null,[false,true]],[async()=>{throw Error('offline');},[false]],[async()=>({user:{}}),[false]]]) {
    const seen=[];
    await createCardCommerceController({setAllowed:x=>seen.push(x),account,membership:async()=>{throw Error('offline');}})();
    assert.deepEqual(seen,expected);
  }
});
