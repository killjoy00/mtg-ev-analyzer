import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {
  appleIapCredentials,
  appStoreServerToken,
  appStoreStatusClient,
  reconcileAppleSubscriptions,
  requestTestNotification,
  diagnoseRejectedKey,
  testNotifications,
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

test('test notification proves the key and reports whether our endpoint accepted it',async()=>{
  const calls=[];
  const replies=[Response.json({testNotificationToken:'token-1'}),new Response(null,{status:404}),
    Response.json({firstSendAttemptResult:'UNSUCCESSFUL_HTTP_RESPONSE_CODE',sendAttempts:[{attemptDate:NOW,sendAttemptResult:'UNSUCCESSFUL_HTTP_RESPONSE_CODE'},{attemptDate:NOW,sendAttemptResult:'SUCCESS'}]})];
  const result=await requestTestNotification(credentials,'Sandbox',{wait:async()=>{},fetchImpl:async(url,options)=>{
    calls.push(`${options.method} ${url}`);
    assert.match(options.headers.authorization,/^Bearer /);
    return replies.shift();
  }});
  assert.deepEqual(result,{environment:'Sandbox',key_accepted:true,delivery:'SUCCESS'});
  assert.deepEqual(calls,[
    'POST https://api.storekit-sandbox.apple.com/inApps/v1/notifications/test',
    'GET https://api.storekit-sandbox.apple.com/inApps/v1/notifications/test/token-1',
    'GET https://api.storekit-sandbox.apple.com/inApps/v1/notifications/test/token-1',
  ]);
  assert.equal(JSON.stringify(result).includes('token-1'),false);
});

test('test notification fails loudly on a rejected key and reports a missing URL',async()=>{
  await assert.rejects(requestTestNotification(credentials,'Production',{wait:async()=>{},fetchImpl:async()=>new Response(null,{status:401})}),/In-App Purchase key/);
  assert.deepEqual(await requestTestNotification(credentials,'Production',{wait:async()=>{},fetchImpl:async()=>new Response(null,{status:404})}),
    {environment:'Production',key_accepted:true,delivery:'no_notification_url'});
  assert.deepEqual(await requestTestNotification(credentials,'Production',{wait:async()=>{},checks:2,fetchImpl:async(url,options)=>
    options.method==='POST'?Response.json({testNotificationToken:'t'}):new Response(null,{status:404})}),{environment:'Production',key_accepted:true,delivery:'pending'});
  await assert.rejects(requestTestNotification(credentials,'Xcode',{fetchImpl:async()=>{throw Error('must not call');}}));
});

test('a production 401 before the first App Store release does not fail a key Sandbox accepted',async()=>{
  const rejected=()=>Object.assign(Error('App Store Server API rejected the In-App Purchase key'),{fatal:true});
  const request=outcomes=>async(_credentials,environment)=>{
    const outcome=outcomes[environment];
    if(outcome==='401')throw rejected();
    return {environment,key_accepted:true,delivery:outcome};
  };
  const lookup=resultCount=>async url=>{
    assert.equal(String(url),`https://itunes.apple.com/lookup?id=${APPLE_APP_ID}`);
    return Response.json({resultCount,results:[]});
  };
  assert.deepEqual(await testNotifications(credentials,{request:request({Sandbox:'SUCCESS',Production:'401'}),fetchImpl:lookup(0)}),[
    {environment:'Sandbox',key_accepted:true,delivery:'SUCCESS'},
    {environment:'Production',key_accepted:null,delivery:'unavailable_until_app_store_release'},
  ]);
  // Once the app is listed, or when its listing cannot be checked, a production 401 is a key problem.
  for(const fetchImpl of [lookup(1),async()=>{throw Error('offline');}]) {
    await assert.rejects(testNotifications(credentials,{request:request({Sandbox:'SUCCESS',Production:'401'}),fetchImpl}),
      error=>error.fatal&&error.environment==='Production'&&error.results.length===1&&error.results[0].environment==='Sandbox');
  }
  // A Sandbox rejection is never excused, and the listing is not consulted.
  await assert.rejects(testNotifications(credentials,{request:request({Sandbox:'401',Production:'SUCCESS'}),fetchImpl:async()=>{throw Error('must not call');}}),
    error=>error.fatal&&error.environment==='Sandbox'&&error.results.length===0);
});

test('a rejected key is diagnosed with safe facts only',async()=>{
  const env={APPLE_IAP_ISSUER_SOURCE:'ASC_ISSUER_ID fallback',APPLE_IAP_KEY_ID_MATCHES_ASC:'false'};
  for(const [status,accepted] of [[200,true],[401,false]]) {
    let url='';
    const facts=await diagnoseRejectedKey(credentials,{env,fetchImpl:async(target,options)=>{
      url=String(target);
      const claims=JSON.parse(Buffer.from(options.headers.authorization.split('.')[1],'base64url'));
      assert.equal('bid' in claims,false);
      return new Response(null,{status});
    }});
    assert.equal(url,'https://api.appstoreconnect.apple.com/v1/apps?limit=1');
    assert.deepEqual(facts,{key_id_format_ok:true,issuer_id_format_ok:true,issuer_id_source:'ASC_ISSUER_ID fallback',
      private_key_is_p256:true,key_id_same_as_app_store_connect_api_key:false,accepted_by_app_store_connect_api:accepted});
    const text=JSON.stringify(facts);
    for(const secret of [credentials.keyId,credentials.issuerId,credentials.privateKey])assert.equal(text.includes(secret),false);
  }
  const offline=await diagnoseRejectedKey({...credentials,keyId:'bad id',privateKey:'not a key'},{env:{},fetchImpl:async()=>{throw Error('offline');}});
  assert.equal(offline.key_id_format_ok,false);
  assert.equal(offline.private_key_is_p256,false);
  assert.equal(offline.accepted_by_app_store_connect_api,null);
});
