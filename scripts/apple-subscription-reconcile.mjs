import {createPrivateKey,sign} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {verifyAppleJws} from '../worker/apple-jws.mjs';
import {APPLE_APP_ID,APPLE_BUNDLE_ID} from '../worker/apple-subscription-policy.mjs';
import {appleStatusName,applyAppleSubscriptionState,normalizeAppleTransaction} from '../worker/apple-subscriptions.mjs';
import {corpusDatabase} from './neon-corpus-db.mjs';

// App Store Server API hosts, per Get All Subscription Statuses.
const HOSTS={Production:'https://api.storekit.apple.com',Sandbox:'https://api.storekit-sandbox.apple.com'};
const TX_RE=/^[0-9]{1,40}$/;
const fatal=message=>Object.assign(Error(message),{fatal:true});

// Server notifications remain the primary signal. This pass catches the ones that
// never arrived: a renewal whose grant would otherwise lapse at the old expiry, or
// a refund, expiry or billing-retry outcome that should end access. Revoked chains
// are terminal; a later purchase arrives as a new verified transaction.
const DUE=`SELECT original_transaction_id,auth_user_id::text AS auth_user_id,environment
  FROM apple_subscription_entitlements
  WHERE status<>'revoked'
    AND (status IN ('active','grace_period','billing_retry') OR expires_at>now()-interval '60 days')
    AND (reconcile_attempted_at IS NULL OR reconcile_attempted_at<now()-interval '5 hours')
  ORDER BY (status IN ('active','grace_period') AND expires_at<=now()) DESC,last_reconciled_at NULLS FIRST,updated_at
  LIMIT $1`;

export function appleIapCredentials(env=process.env) {
  const keyId=env.APPLE_IAP_KEY_ID?.trim(),issuerId=env.APPLE_IAP_ISSUER_ID?.trim(),privateKey=env.APPLE_IAP_KEY_P8;
  return keyId&&issuerId&&privateKey?.trim()?{keyId,issuerId,privateKey}:null;
}

function signedToken({keyId,issuerId,privateKey},claims,now) {
  const iat=Math.floor(now/1000);
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned=`${encode({alg:'ES256',kid:keyId,typ:'JWT'})}.${encode({iss:issuerId,iat,exp:iat+600,aud:'appstoreconnect-v1',...claims})}`;
  const signature=sign('sha256',Buffer.from(unsigned),{key:createPrivateKey(privateKey),dsaEncoding:'ieee-p1363'});
  return `${unsigned}.${signature.toString('base64url')}`;
}

// ES256 JWT for the App Store Server API, signed with an In-App Purchase key.
export function appStoreServerToken(credentials,now=Date.now()) {
  return signedToken(credentials,{bid:APPLE_BUNDLE_ID},now);
}

// When Apple rejects the key, report only facts that separate a wrong key type
// from a mistyped value. No secret value, or part of one, is ever printed.
export async function diagnoseRejectedKey(credentials,{env=process.env,fetchImpl=fetch,now=Date.now()}={}) {
  let curve=null;
  try {curve=createPrivateKey(credentials.privateKey).asymmetricKeyDetails?.namedCurve||null;} catch {}
  const facts={
    key_id_format_ok:/^[A-Z0-9]{10}$/.test(credentials.keyId),
    issuer_id_format_ok:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(credentials.issuerId),
    issuer_id_source:env.APPLE_IAP_ISSUER_SOURCE||'unknown',
    private_key_is_p256:curve==='prime256v1',
    key_id_same_as_app_store_connect_api_key:env.APPLE_IAP_KEY_ID_MATCHES_ASC==='true',
    accepted_by_app_store_connect_api:null,
  };
  // An App Store Connect API team key is accepted here and rejected by the
  // App Store Server API; an In-App Purchase key is the reverse.
  try {
    const response=await fetchImpl('https://api.appstoreconnect.apple.com/v1/apps?limit=1',{
      headers:{authorization:`Bearer ${signedToken(credentials,{},now)}`,accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(30000),
    });
    facts.accepted_by_app_store_connect_api=response.ok;
  } catch {}
  return facts;
}

export function appStoreStatusClient(credentials,{fetchImpl=fetch}={}) {
  return async function fetchStatus(environment,originalTransactionId) {
    const host=HOSTS[environment];
    if(!host||!TX_RE.test(originalTransactionId))throw Error('Subscription lookup is invalid.');
    const response=await fetchImpl(`${host}/inApps/v1/subscriptions/${originalTransactionId}`,{
      headers:{authorization:`Bearer ${appStoreServerToken(credentials)}`,accept:'application/json','user-agent':'Pack One subscription reconciliation'},
      redirect:'error',signal:AbortSignal.timeout(30000),
    });
    if(response.status===401)throw fatal('App Store Server API rejected the In-App Purchase key; check APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID and APPLE_IAP_KEY_P8.');
    if(response.status===429)throw Object.assign(fatal('App Store Server API rate limit reached; remaining subscriptions wait for the next run.'),{rateLimited:true});
    if(!response.ok)throw Error(`App Store Server API returned ${response.status}.`);
    return response.json();
  };
}

// Proves the In-App Purchase key and the notification endpoint without needing a
// subscriber: Apple sends a TEST notification and reports whether our server
// accepted it. The test token is not logged.
export async function requestTestNotification(credentials,environment,{fetchImpl=fetch,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=6}={}) {
  const host=HOSTS[environment];
  if(!host)throw Error('Unknown App Store environment.');
  const request=(path,method='GET')=>fetchImpl(`${host}${path}`,{
    method,
    headers:{authorization:`Bearer ${appStoreServerToken(credentials)}`,accept:'application/json','user-agent':'Pack One subscription reconciliation'},
    redirect:'error',signal:AbortSignal.timeout(30000),
  });
  const sent=await request('/inApps/v1/notifications/test','POST');
  if(sent.status===401)throw fatal('App Store Server API rejected the In-App Purchase key; check APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID and APPLE_IAP_KEY_P8.');
  if(sent.status===404)return {environment,key_accepted:true,delivery:'no_notification_url'};
  if(!sent.ok)throw Error(`App Store Server API returned ${sent.status} for the ${environment} test notification.`);
  const token=String((await sent.json())?.testNotificationToken||'');
  if(!token)throw Error('App Store Server API did not return a test notification token.');
  for(let attempt=0;attempt<checks;attempt++) {
    await wait(5000);
    const status=await request(`/inApps/v1/notifications/test/${encodeURIComponent(token)}`);
    if(status.status===404)continue;
    if(!status.ok)throw Error(`App Store Server API returned ${status.status} for the ${environment} test notification status.`);
    const body=await status.json();
    const attempts=Array.isArray(body?.sendAttempts)?body.sendAttempts:[];
    return {environment,key_accepted:true,delivery:String(attempts.at(-1)?.sendAttemptResult||body?.firstSendAttemptResult||'pending')};
  }
  return {environment,key_accepted:true,delivery:'pending'};
}

// Apple answers 401 from every Production endpoint until the app's first App Store
// release, so a Production 401 for the key Sandbox just accepted is only a key
// problem once the app is listed.
async function listedOnAppStore(fetchImpl) {
  try {
    const response=await fetchImpl(`https://itunes.apple.com/lookup?id=${APPLE_APP_ID}`,{redirect:'error',signal:AbortSignal.timeout(15000)});
    return response.ok?Number((await response.json())?.resultCount)>0:null;
  } catch {return null;}
}

export async function testNotifications(credentials,{request=requestTestNotification,fetchImpl=fetch}={}) {
  const results=[];
  for(const environment of ['Sandbox','Production']) {
    try {
      results.push(await request(credentials,environment));
    } catch(error) {
      if(error?.fatal&&environment==='Production'&&results[0]?.key_accepted&&await listedOnAppStore(fetchImpl)===false) {
        results.push({environment,key_accepted:null,delivery:'unavailable_until_app_store_release'});
        continue;
      }
      throw Object.assign(error,{environment,results});
    }
  }
  return results;
}

export async function reconcileSubscription(query,row,{fetchStatus,verifyJws=verifyAppleJws}) {
  const body=await fetchStatus(row.environment,row.original_transaction_id);
  if(String(body?.bundleId||'')!==APPLE_BUNDLE_ID||String(body?.environment||'')!==row.environment
    ||((row.environment==='Production'||body?.appAppleId!=null)&&Number(body?.appAppleId)!==APPLE_APP_ID))
    throw Error('App Store status response is for another app or environment.');
  const groups=Array.isArray(body.data)?body.data:[];
  const item=groups.flatMap(group=>Array.isArray(group?.lastTransactions)?group.lastTransactions:[])
    .find(entry=>String(entry?.originalTransactionId||'')===row.original_transaction_id);
  if(!item?.signedTransactionInfo)throw Error('Subscription is missing from the App Store status response.');
  let transaction=await verifyJws(String(item.signedTransactionInfo));
  const renewal=item.signedRenewalInfo?await verifyJws(String(item.signedRenewalInfo)):null;
  // The chain is already bound to this account; a transaction without a token keeps that binding.
  if(!transaction?.appAccountToken)transaction={...transaction,appAccountToken:row.auth_user_id};
  const state=normalizeAppleTransaction(transaction,{expectedAccountId:row.auth_user_id,status:appleStatusName(item.status),renewal});
  if(state.originalTransactionId!==row.original_transaction_id)throw Error('App Store status response is for another subscription.');
  const {applied}=await applyAppleSubscriptionState(query,state);
  await query('UPDATE apple_subscription_entitlements SET last_reconciled_at=now() WHERE original_transaction_id=$1',[row.original_transaction_id]);
  return {applied,status:state.status};
}

export async function reconcileAppleSubscriptions(query,{credentials=appleIapCredentials(),fetchStatus=null,verifyJws=verifyAppleJws,limit=500}={}) {
  if(!credentials&&!fetchStatus)return {enabled:false,reason:'Add the In-App Purchase key secrets to reconcile Apple subscriptions.'};
  const lookup=fetchStatus||appStoreStatusClient(credentials);
  const rows=(await query(DUE,[limit])).rows;
  // Counts only: transaction and account identifiers never reach workflow logs.
  const summary={enabled:true,due:rows.length,checked:0,applied:0,unchanged:0,failed:0,rate_limited:false,statuses:{}};
  for(const row of rows) {
    await query('UPDATE apple_subscription_entitlements SET reconcile_attempted_at=now() WHERE original_transaction_id=$1',[row.original_transaction_id]);
    try {
      const result=await reconcileSubscription(query,row,{fetchStatus:lookup,verifyJws});
      summary.checked++;
      summary[result.applied?'applied':'unchanged']++;
      summary.statuses[result.status]=(summary.statuses[result.status]||0)+1;
    } catch(error) {
      if(error?.rateLimited) {summary.rate_limited=true;break;}
      if(error?.fatal)throw error;
      summary.failed++;
      console.error(`Subscription not reconciled: ${String(error?.message||'unknown error').slice(0,200)}`);
    }
  }
  return summary;
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  const credentials=appleIapCredentials();
  if(process.argv[2]==='test-notification') {
    if(!credentials)throw Error('Add the In-App Purchase key secrets before requesting a test notification.');
    let results;
    try {
      results=await testNotifications(credentials);
    } catch(error) {
      if(error?.results?.length)console.log(JSON.stringify(error.results));
      if(error?.fatal)console.log(JSON.stringify({key_rejected_by:error.environment,diagnosis:await diagnoseRejectedKey(credentials)}));
      throw error;
    }
    console.log(JSON.stringify(results));
    if(results.some(result=>!['SUCCESS','unavailable_until_app_store_release'].includes(result.delivery)))process.exitCode=1;
  } else if(!credentials) {
    console.log(JSON.stringify(await reconcileAppleSubscriptions(null,{credentials})));
  } else {
    if(!process.argv[2])throw Error('Pass the Neon connection file.');
    const summary=await reconcileAppleSubscriptions(corpusDatabase(process.argv[2]),{credentials});
    console.log(JSON.stringify(summary));
    if(summary.failed)process.exitCode=1;
  }
}
