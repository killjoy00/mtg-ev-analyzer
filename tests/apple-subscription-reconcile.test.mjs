import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {
  appleIapCredentials,
  appStoreServerToken,
  appStoreStatusClient,
  reconcileAppleSubscriptions,
} from '../scripts/apple-subscription-reconcile.mjs';
import {APPLE_APP_ID,APPLE_ELITE_PRODUCT_ID} from '../worker/apple-subscription-policy.mjs';
import {acceptAppleNotification} from '../worker/apple-subscriptions.mjs';

const ACCOUNT='11111111-1111-4111-8111-111111111111';
const ORIGINAL='200000000000001';
const NOW=Date.now();
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
const credentials={keyId:'KEY1234567',issuerId:'57246542-96fe-1a63-e053-0824d011072a',privateKey:privateKey.export({type:'pkcs8',format:'pem'})};

const transaction=(overrides={})=>({
  bundleId:'pro.packone.app',
  productId:APPLE_ELITE_PRODUCT_ID,
  environment:'Production',
  type:'Auto-Renewable Subscription',
  inAppOwnershipType:'PURCHASED',
  quantity:1,
  appAccountToken:ACCOUNT,
  transactionId:'200000000000009',
  originalTransactionId:ORIGINAL,
  purchaseDate:NOW-1000,
  expiresDate:NOW+30*86400000,
  signedDate:NOW,
  ...overrides,
});
const statusBody=(item={},overrides={})=>({
  environment:'Production',
  appAppleId:APPLE_APP_ID,
  bundleId:'pro.packone.app',
  data:[{subscriptionGroupIdentifier:'1',lastTransactions:[{originalTransactionId:ORIGINAL,status:1,signedTransactionInfo:'tx',signedRenewalInfo:'renewal',...item}]}],
  ...overrides,
});
function database(rows=[{original_transaction_id:ORIGINAL,auth_user_id:ACCOUNT,environment:'Production'}]) {
  const calls=[];
  const query=async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.includes('FROM apple_subscription_entitlements')&&sql.trimStart().startsWith('SELECT'))return {rows};
    if(sql.startsWith('SELECT * FROM pack1_apply_apple_subscription_state'))return {rows:[{applied:true,account_matches:true}]};
    if(sql.startsWith('UPDATE apple_subscription_entitlements'))return {rows:[]};
    throw Error('Unexpected query: '+sql.slice(0,100));
  };
  return {query,calls};
}
const verifyJws=async value=>value==='tx'?transaction():{originalTransactionId:ORIGINAL,productId:APPLE_ELITE_PRODUCT_ID,environment:'Production',autoRenewStatus:1,signedDate:NOW};

test('App Store Server API token follows Apple JWT fields and verifies with the key',()=>{
  const token=appStoreServerToken(credentials,NOW);
  const [header,payload,signature]=token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header,'base64url')),{alg:'ES256',kid:credentials.keyId,typ:'JWT'});
  const claims=JSON.parse(Buffer.from(payload,'base64url'));
  assert.equal(claims.iss,credentials.issuerId);
  assert.equal(claims.aud,'appstoreconnect-v1');
  assert.equal(claims.bid,'pro.packone.app');
  assert.ok(claims.exp>claims.iat&&claims.exp-claims.iat<=3600);
  assert.equal(verify('sha256',Buffer.from(header+'.'+payload),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),true);
});

test('credentials are all-or-nothing',()=>{
  assert.equal(appleIapCredentials({APPLE_IAP_KEY_ID:'K',APPLE_IAP_ISSUER_ID:'I'}),null);
  assert.equal(appleIapCredentials({APPLE_IAP_KEY_ID:'K',APPLE_IAP_ISSUER_ID:'I',APPLE_IAP_KEY_P8:' '}),null);
  assert.deepEqual(appleIapCredentials({APPLE_IAP_KEY_ID:' K ',APPLE_IAP_ISSUER_ID:'I',APPLE_IAP_KEY_P8:'P'}),{keyId:'K',issuerId:'I',privateKey:'P'});
});

test('missing In-App Purchase key is a reported no-op, not a database call',async()=>{
  const result=await reconcileAppleSubscriptions(async()=>{throw Error('must not query');},{credentials:null});
  assert.equal(result.enabled,false);
});

test('status client uses the environment host and rejects malformed identifiers',async()=>{
  const urls=[];
  const client=appStoreStatusClient(credentials,{fetchImpl:async(url,options)=>{
    urls.push(String(url));
    assert.match(options.headers.authorization,/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    return Response.json(statusBody());
  }});
  await client('Production',ORIGINAL);
  await client('Sandbox',ORIGINAL);
  assert.deepEqual(urls,[
    `https://api.storekit.apple.com/inApps/v1/subscriptions/${ORIGINAL}`,
    `https://api.storekit-sandbox.apple.com/inApps/v1/subscriptions/${ORIGINAL}`,
  ]);
  await assert.rejects(client('Production','../x'));
  await assert.rejects(client('Xcode',ORIGINAL));
});

test('a renewal Apple never notified about is applied from verified signed data',async()=>{
  const {query,calls}=database();
  const result=await reconcileAppleSubscriptions(query,{fetchStatus:async()=>statusBody(),verifyJws});
  assert.deepEqual({checked:result.checked,applied:result.applied,failed:result.failed},{checked:1,applied:1,failed:0});
  assert.deepEqual(result.statuses,{active:1});
  const applied=calls.find(call=>call.sql.startsWith('SELECT * FROM pack1_apply_apple_subscription_state'));
  assert.equal(applied.params[0],ACCOUNT);
  assert.equal(applied.params[5],'active');
  assert.equal(applied.params[8],'200000000000009');
  assert.ok(calls.some(call=>call.sql.includes('SET reconcile_attempted_at=now()')));
  assert.ok(calls.some(call=>call.sql.includes('SET last_reconciled_at=now()')));
  assert.equal(JSON.stringify(result).includes(ORIGINAL),false);
});

test('a refund Apple never notified about ends access',async()=>{
  const {query,calls}=database();
  await reconcileAppleSubscriptions(query,{fetchStatus:async()=>statusBody({status:5}),verifyJws});
  assert.equal(calls.find(call=>call.sql.startsWith('SELECT * FROM pack1_apply_apple_subscription_state')).params[5],'revoked');
});

test('another account, app or environment is never applied',async()=>{
  for(const [body,verifier] of [
    [statusBody(),async value=>value==='tx'?transaction({appAccountToken:'33333333-3333-4333-8333-333333333333'}):{}],
    [statusBody({},{bundleId:'other.app'}),verifyJws],
    [statusBody({},{environment:'Sandbox'}),verifyJws],
    [statusBody({},{appAppleId:undefined}),verifyJws],
    [statusBody({originalTransactionId:'999'}),verifyJws],
  ]) {
    const {query,calls}=database();
    const result=await reconcileAppleSubscriptions(query,{fetchStatus:async()=>body,verifyJws:verifier});
    assert.equal(result.failed,1);
    assert.equal(calls.some(call=>call.sql.startsWith('SELECT * FROM pack1_apply_apple_subscription_state')),false);
    assert.equal(calls.some(call=>call.sql.includes('SET last_reconciled_at=now()')),false);
  }
});

test('sandbox status responses without an app ID are accepted',async()=>{
  const {query}=database([{original_transaction_id:ORIGINAL,auth_user_id:ACCOUNT,environment:'Sandbox'}]);
  const sandbox=async value=>value==='tx'?transaction({environment:'Sandbox'}):{originalTransactionId:ORIGINAL,environment:'Sandbox',signedDate:NOW};
  const result=await reconcileAppleSubscriptions(query,{fetchStatus:async()=>statusBody({},{environment:'Sandbox',appAppleId:undefined}),verifyJws:sandbox});
  assert.equal(result.applied,1);
});

test('a rejected key stops the run; a rate limit stops it without failing',async()=>{
  const two=[{original_transaction_id:ORIGINAL,auth_user_id:ACCOUNT,environment:'Production'},{original_transaction_id:'200000000000002',auth_user_id:ACCOUNT,environment:'Production'}];
  const status=code=>appStoreStatusClient(credentials,{fetchImpl:async()=>new Response(null,{status:code})});
  await assert.rejects(reconcileAppleSubscriptions(database(two).query,{fetchStatus:status(401),verifyJws}),/In-App Purchase key/);
  let lookups=0;
  const limited=status(429);
  const result=await reconcileAppleSubscriptions(database(two).query,{fetchStatus:(...args)=>{lookups++;return limited(...args);},verifyJws});
  assert.equal(result.rate_limited,true);
  assert.equal(lookups,1);
});

test('sandbox App Store notifications are not rejected for a missing app ID',async()=>{
  const notification={notificationUUID:'44444444-4444-4444-8444-444444444444',notificationType:'DID_RENEW',signedDate:NOW,
    data:{bundleId:'pro.packone.app',environment:'Sandbox',status:1,signedTransactionInfo:'tx'}};
  const query=async sql=>{
    if(sql.startsWith('SELECT 1 FROM apple_subscription_notifications'))return {rows:[]};
    if(sql.startsWith('SELECT * FROM pack1_apply_apple_subscription_state'))return {rows:[{applied:true,account_matches:true}]};
    if(sql.includes('INSERT INTO apple_subscription_notifications'))return {rows:[{notification_uuid:notification.notificationUUID}]};
    throw Error('Unexpected query: '+sql.slice(0,100));
  };
  const result=await acceptAppleNotification(query,{signedPayload:'payload',verifyJws:async value=>value==='payload'?notification:transaction({environment:'Sandbox'})});
  assert.equal(result.processed,true);
  const production={...notification,data:{...notification.data,environment:'Production'}};
  await assert.rejects(acceptAppleNotification(query,{signedPayload:'payload',verifyJws:async value=>value==='payload'?production:transaction()}),/another app/);
});
