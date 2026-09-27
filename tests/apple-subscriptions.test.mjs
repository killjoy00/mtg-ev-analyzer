import test from 'node:test';
import assert from 'node:assert/strict';

import {gateway} from '../edge/gateway.mjs';
import {
  APPLE_ELITE_PRODUCT_ID,
  appleSubscriptionAction,
} from '../worker/apple-subscription-policy.mjs';
import {
  handleAppleSubscriptions,
  normalizeAppleTransaction,
} from '../worker/apple-subscriptions.mjs';

const ACCOUNT='11111111-1111-4111-8111-111111111111';
const PLAYER='22222222-2222-4222-8222-222222222222';
const PLAYER_TOKEN=`p1_${PLAYER}.${'A'.repeat(43)}`;
const ACCOUNT_TOKEN='B'.repeat(43);
const NOW=Date.now();

const transaction=(overrides={})=>({
  bundleId:'pro.packone.app',
  productId:APPLE_ELITE_PRODUCT_ID,
  environment:'Sandbox',
  type:'Auto-Renewable Subscription',
  inAppOwnershipType:'PURCHASED',
  quantity:1,
  appAccountToken:ACCOUNT,
  transactionId:'200000000000001',
  originalTransactionId:'200000000000001',
  purchaseDate:NOW-1000,
  expiresDate:NOW+86400000,
  signedDate:NOW,
  ...overrides,
});

for(const [path,method,action] of [
  ['/v1/apple-subscriptions/mobile/status','GET','status'],
  ['/v1/apple-subscriptions/mobile/verify','POST','verify'],
  ['/v1/apple-subscriptions/notifications','POST','notification'],
]) {
  test(`Apple subscription route is exact: ${action}`,()=>{
    assert.equal(appleSubscriptionAction(path,method),action);
    assert.equal(appleSubscriptionAction(path,method==='GET'?'POST':'GET'),null);
    assert.equal(appleSubscriptionAction(path+'/extra',method),null);
  });
}

test('signed appAccountToken is the Pack One account boundary',()=>{
  const state=normalizeAppleTransaction(transaction(),{expectedAccountId:ACCOUNT});
  assert.equal(state.authUserId,ACCOUNT);
  assert.equal(state.productId,APPLE_ELITE_PRODUCT_ID);

  assert.throws(
    ()=>normalizeAppleTransaction(transaction({appAccountToken:crypto.randomUUID()}),{expectedAccountId:ACCOUNT}),
    {status:409},
  );
  assert.throws(()=>normalizeAppleTransaction(transaction({productId:'wrong.product'})),{status:400});
  assert.throws(()=>normalizeAppleTransaction(transaction({bundleId:'wrong.bundle'})),{status:400});
  assert.throws(()=>normalizeAppleTransaction(transaction({inAppOwnershipType:'FAMILY_SHARED'})),{status:403});
});

test('server verification ignores unsigned client account and product claims',async()=>{
  let appliedParams=null;
  const query=async(sql,params=[])=>{
    if(sql.startsWith('SELECT * FROM pack1_apply_apple_subscription_state')) {
      appliedParams=params;
      return {rows:[{applied:true,account_matches:true}]};
    }
    if(sql.includes('FROM apple_subscription_entitlements'))return {rows:[{
      product_id:APPLE_ELITE_PRODUCT_ID,
      environment:'Sandbox',
      status:'active',
      expires_at:new Date(NOW+86400000).toISOString(),
      auto_renew_enabled:null,
    }]};
    if(sql.includes('SELECT DISTINCT capability'))return {rows:[
      {capability:'custom_corpus'},
      {capability:'unlimited_cube_practice'},
    ]};
    throw Error('Unexpected query: '+sql.slice(0,100));
  };

  const response=await handleAppleSubscriptions(new Request(
    'https://packone.pro/v1/apple-subscriptions/mobile/verify',
    {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        signedTransaction:'fixture',
        accountId:'attacker',
        productId:'attacker',
      }),
    },
  ),{
    query,
    json:(value,status=200)=>Response.json(value,{status}),
    readJson:request=>request.json(),
    mobileAccountIdentity:async()=>({owner:PLAYER,auth:{user_id:ACCOUNT}}),
    verifyJws:async()=>transaction(),
  });

  assert.equal(response.status,200);
  assert.equal((await response.json()).verified,true);
  assert.equal(appliedParams[0],ACCOUNT);
  assert.equal(appliedParams[3],APPLE_ELITE_PRODUCT_ID);
});

const environment=()=>({
  MODE:'production',
  NEON_BRANCH_ID:'br-orange-feather-ayps8kep',
  QUOTA_KEY:'a'.repeat(64),
  NETWORK_QUOTA:{
    idFromName:value=>value,
    get:()=>({fetch:async()=>new Response(null,{status:204})}),
  },
});

test('gateway requires both native identities for Apple purchase verification',async()=>{
  for(const headers of [
    {},
    {'x-pack1-mobile-session':PLAYER_TOKEN},
    {'x-pack1-mobile-account':ACCOUNT_TOKEN},
  ]) {
    const response=await gateway(new Request(
      'https://api.packone.pro/growth/v1/apple-subscriptions/mobile/verify',
      {
        method:'POST',
        headers:{
          'cf-connecting-ip':'192.0.2.1',
          'content-type':'application/json',
          ...headers,
        },
        body:'{}',
      },
    ),environment(),async()=>{throw Error('must not forward');});
    assert.equal(response.status,401);
  }
});

test('gateway admits App Store notifications without native credentials',async()=>{
  let forwarded=null;
  const response=await gateway(new Request(
    'https://api.packone.pro/growth/v1/apple-subscriptions/notifications',
    {
      method:'POST',
      headers:{
        'cf-connecting-ip':'192.0.2.2',
        'content-type':'application/json',
      },
      body:'{"signedPayload":"fixture"}',
    },
  ),environment(),async(url,options)=>{
    forwarded={url:String(url),headers:new Headers(options.headers)};
    return Response.json({ok:true});
  });

  assert.equal(response.status,200);
  assert.match(forwarded.url,/\/v1\/apple-subscriptions\/notifications$/);
  assert.equal(forwarded.headers.has('x-pack1-mobile-account'),false);
});
