import {accountCapabilities} from './capabilities.mjs';
import {verifyAppleJws} from './apple-jws.mjs';
import {
  APPLE_APP_ID,
  APPLE_BUNDLE_ID,
  APPLE_ELITE_PRODUCT_ID,
  APPLE_IAP_PROVIDER,
  appleSubscriptionAction,
} from './apple-subscription-policy.mjs';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TX_RE=/^[0-9]{1,40}$/;
const ENVIRONMENTS=new Set(['Production','Sandbox']);
const STATUSES=new Set(['active','grace_period','billing_retry','expired','revoked','unknown']);
const ACTIVE=new Set(['active','grace_period']);

const problem=(message,status=400,code='APPLE_SUBSCRIPTION_INVALID')=>Object.assign(Error(message),{status,code});
const pgBool=value=>value===true||value===1||value==='1'||value==='t'||value==='true';

function iso(value) {
  if(value==null)return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>0?new Date(n).toISOString():null;
}
function newest(...values) {
  return Math.max(...values.map(value=>Number(value)||0));
}
function validProduct(value) {
  return String(value||'')===APPLE_ELITE_PRODUCT_ID;
}

export const appleStatusName=status=>({
  1:'active',
  2:'expired',
  3:'billing_retry',
  4:'grace_period',
  5:'revoked',
})[Number(status)]||null;

export const appleSubscriptionConfig=()=>({
  configured:true,
  productId:APPLE_ELITE_PRODUCT_ID,
});

export function normalizeAppleTransaction(tx,{
  expectedAccountId=null,
  status=null,
  renewal=null,
  eventSignedAt=null,
  notificationUUID=null,
}={}) {
  if(!tx||typeof tx!=='object')throw problem('Apple subscription payload is incomplete.');

  const environment=String(tx.environment||'');
  if(!ENVIRONMENTS.has(environment)||String(tx.bundleId||'')!==APPLE_BUNDLE_ID)
    throw problem('Apple subscription is for another app.');
  if(!validProduct(tx.productId))
    throw problem('Apple subscription product is not recognized.',400,'APPLE_PRODUCT');
  if(tx.type&&String(tx.type)!=='Auto-Renewable Subscription')
    throw problem('Apple purchase is not a subscription.');
  if(tx.inAppOwnershipType&&String(tx.inAppOwnershipType)!=='PURCHASED')
    throw problem('Family-shared subscriptions are not eligible for Pack One Elite.',403,'APPLE_FAMILY_SHARED');
  if(tx.quantity!=null&&Number(tx.quantity)!==1)
    throw problem('Apple subscription quantity is invalid.');

  const originalTransactionId=String(tx.originalTransactionId||'');
  const lastTransactionId=String(tx.transactionId||'');
  const authUserId=String(tx.appAccountToken||'').toLowerCase();
  if(!TX_RE.test(originalTransactionId)||!TX_RE.test(lastTransactionId)||!ACCOUNT_UUID_RE.test(authUserId))
    throw problem('Apple subscription is missing its Pack One account binding.',409,'APPLE_ACCOUNT_BINDING');
  if(expectedAccountId&&authUserId!==String(expectedAccountId).toLowerCase())
    throw problem('This subscription is linked to a different Pack One account.',409,'APPLE_ACCOUNT_MISMATCH');

  const transactionSignedAt=iso(tx.signedDate);
  const purchaseAt=iso(tx.purchaseDate);
  const baseExpiry=iso(tx.expiresDate);
  if(!transactionSignedAt||!purchaseAt||!baseExpiry)
    throw problem('Apple subscription payload is incomplete.');
  if(Date.parse(baseExpiry)<Date.parse(purchaseAt))
    throw problem('Apple subscription dates are invalid.');

  let gracePeriodExpiry=null;
  let autoRenewEnabled=null;
  if(renewal) {
    if(renewal.environment&&String(renewal.environment)!==environment)
      throw problem('Apple renewal environment does not match the transaction.');
    if(renewal.originalTransactionId&&String(renewal.originalTransactionId)!==originalTransactionId)
      throw problem('Apple renewal does not match the subscription.');
    if((renewal.productId||renewal.autoRenewProductId)&&!validProduct(renewal.productId||renewal.autoRenewProductId))
      throw problem('Apple renewal product does not match the subscription.');
    gracePeriodExpiry=iso(renewal.gracePeriodExpiresDate);
    if(renewal.autoRenewStatus!=null)autoRenewEnabled=Number(renewal.autoRenewStatus)===1;
  }

  const resolvedStatus=status||(
    tx.revocationDate?'revoked':Date.parse(baseExpiry)>Date.now()?'active':'expired'
  );
  if(!STATUSES.has(resolvedStatus))throw problem('Apple subscription status is invalid.');
  const expiresAt=resolvedStatus==='grace_period'
    && gracePeriodExpiry
    && Date.parse(gracePeriodExpiry)>Date.parse(baseExpiry)
    ?gracePeriodExpiry
    :baseExpiry;
  const eventAt=iso(newest(eventSignedAt,tx.signedDate,renewal?.signedDate));
  if(!eventAt)throw problem('Apple subscription signed date is invalid.');

  return {
    authUserId,
    appAccountToken:authUserId,
    originalTransactionId,
    productId:APPLE_ELITE_PRODUCT_ID,
    environment,
    status:resolvedStatus,
    expiresAt,
    autoRenewEnabled,
    lastTransactionId,
    eventSignedAt:eventAt,
    notificationUUID,
  };
}

async function apply(query,state) {
  const result=await query(
    `SELECT * FROM pack1_apply_apple_subscription_state(
      $1::uuid,$2::uuid,$3,$4,$5,$6,$7::timestamptz,$8::boolean,$9,$10::timestamptz,$11::uuid)`,
    [
      state.authUserId,
      state.appAccountToken,
      state.originalTransactionId,
      state.productId,
      state.environment,
      state.status,
      state.expiresAt,
      state.autoRenewEnabled,
      state.lastTransactionId,
      state.eventSignedAt,
      state.notificationUUID,
    ],
  );
  const row=result.rows[0];
  if(row?.account_matches==='f'||row?.account_matches===false)
    throw problem('This subscription is linked to a different Pack One account.',409,'APPLE_ACCOUNT_MISMATCH');
  return {applied:row?.applied==='t'||row?.applied===true,state};
}

export async function appleSubscriptionAccountState(query,authUserId) {
  const result=await query(
    `SELECT product_id,environment,status,expires_at,auto_renew_enabled
     FROM apple_subscription_entitlements
     WHERE auth_user_id=$1::uuid
     ORDER BY (status IN ('active','grace_period') AND expires_at>now()) DESC,
       last_event_signed_at DESC
     LIMIT 1`,
    [authUserId],
  );
  const row=result.rows[0];
  if(!row)return {
    linked:false,
    active:false,
    provider:APPLE_IAP_PROVIDER,
    productId:APPLE_ELITE_PRODUCT_ID,
  };
  const active=ACTIVE.has(row.status)
    && row.expires_at
    && new Date(row.expires_at).getTime()>Date.now();
  return {
    linked:true,
    active,
    provider:APPLE_IAP_PROVIDER,
    productId:row.product_id,
    status:row.status,
    expiresAt:row.expires_at||null,
    autoRenewEnabled:row.auto_renew_enabled==null?null:pgBool(row.auto_renew_enabled),
    environment:row.environment,
  };
}

export async function acceptAppleClientTransaction(query,{
  authUserId,
  signedTransaction,
  verifyJws=verifyAppleJws,
}) {
  const transaction=await verifyJws(String(signedTransaction||''));
  const state=normalizeAppleTransaction(transaction,{expectedAccountId:authUserId});
  const applied=await apply(query,state);
  return {
    ...applied,
    subscription:await appleSubscriptionAccountState(query,authUserId),
  };
}

async function notificationExists(query,uuid) {
  const result=await query(
    'SELECT 1 FROM apple_subscription_notifications WHERE notification_uuid=$1::uuid LIMIT 1',
    [uuid],
  );
  return Boolean(result.rows[0]);
}

async function rememberNotification(query,notification,{
  environment=null,
  originalTransactionId=null,
  outcome,
}) {
  const uuid=String(notification.notificationUUID||'').toLowerCase();
  const signedAt=iso(notification.signedDate);
  const type=String(notification.notificationType||'');
  if(!UUID_RE.test(uuid)||!signedAt||!/^[A-Z0-9_]{2,80}$/.test(type))
    throw problem('Apple notification metadata is invalid.',400,'APPLE_NOTIFICATION');

  const result=await query(
    `INSERT INTO apple_subscription_notifications(
       notification_uuid,notification_type,notification_subtype,environment,
       original_transaction_id,signed_at,processed_at,outcome)
     VALUES($1::uuid,$2,$3,$4,$5,$6::timestamptz,now(),$7)
     ON CONFLICT(notification_uuid) DO NOTHING
     RETURNING notification_uuid`,
    [
      uuid,
      type,
      notification.subtype?String(notification.subtype).slice(0,80):null,
      environment,
      originalTransactionId,
      signedAt,
      outcome,
    ],
  );
  return {uuid,inserted:Boolean(result.rows[0])};
}

export async function acceptAppleNotification(query,{
  signedPayload,
  verifyJws=verifyAppleJws,
}) {
  const notification=await verifyJws(String(signedPayload||''));
  const uuid=String(notification.notificationUUID||'').toLowerCase();
  if(!UUID_RE.test(uuid)||!iso(notification.signedDate))
    throw problem('Apple notification metadata is invalid.',400,'APPLE_NOTIFICATION');
  if(await notificationExists(query,uuid))return {duplicate:true,processed:true};

  const data=notification.data||{};
  if(Object.keys(data).length&&(
    Number(data.appAppleId)!==APPLE_APP_ID
    ||String(data.bundleId||'')!==APPLE_BUNDLE_ID
    ||!ENVIRONMENTS.has(String(data.environment||''))
  ))throw problem('Apple notification is for another app.');

  if(!data.signedTransactionInfo) {
    const receipt=await rememberNotification(query,notification,{
      environment:data.environment||null,
      outcome:'verified_no_subscription',
    });
    return {duplicate:!receipt.inserted,processed:true};
  }

  let transaction=await verifyJws(String(data.signedTransactionInfo));
  if(String(transaction.bundleId||'')!==APPLE_BUNDLE_ID
    ||String(transaction.environment||'')!==String(data.environment||''))
    throw problem('Apple transaction does not match its notification.');

  const originalTransactionId=String(transaction.originalTransactionId||'');
  if(!validProduct(transaction.productId)) {
    const receipt=await rememberNotification(query,notification,{
      environment:data.environment,
      originalTransactionId:TX_RE.test(originalTransactionId)?originalTransactionId:null,
      outcome:'ignored_product',
    });
    return {duplicate:!receipt.inserted,processed:true};
  }
  if(transaction.inAppOwnershipType&&String(transaction.inAppOwnershipType)!=='PURCHASED') {
    const receipt=await rememberNotification(query,notification,{
      environment:data.environment,
      originalTransactionId:TX_RE.test(originalTransactionId)?originalTransactionId:null,
      outcome:'ignored_family_shared',
    });
    return {duplicate:!receipt.inserted,processed:true};
  }

  if(!ACCOUNT_UUID_RE.test(String(transaction.appAccountToken||''))) {
    const existing=TX_RE.test(originalTransactionId)
      ?(await query(
        'SELECT auth_user_id::text FROM apple_subscription_entitlements WHERE original_transaction_id=$1',
        [originalTransactionId],
      )).rows[0]
      :null;
    if(!existing) {
      const receipt=await rememberNotification(query,notification,{
        environment:data.environment,
        originalTransactionId:TX_RE.test(originalTransactionId)?originalTransactionId:null,
        outcome:'unbound',
      });
      return {duplicate:!receipt.inserted,processed:true};
    }
    transaction={...transaction,appAccountToken:existing.auth_user_id};
  }

  const renewal=data.signedRenewalInfo
    ?await verifyJws(String(data.signedRenewalInfo))
    :null;
  const state=normalizeAppleTransaction(transaction,{
    status:appleStatusName(data.status),
    renewal,
    eventSignedAt:newest(notification.signedDate,transaction.signedDate,renewal?.signedDate),
    notificationUUID:uuid,
  });
  await apply(query,state);
  const receipt=await rememberNotification(query,notification,{
    environment:data.environment,
    originalTransactionId:state.originalTransactionId,
    outcome:'applied',
  });
  return {duplicate:!receipt.inserted,processed:true};
}

export async function handleAppleSubscriptions(request,{
  query,
  json,
  readJson,
  mobileAccountIdentity,
  verifyJws=verifyAppleJws,
}) {
  const action=appleSubscriptionAction(new URL(request.url).pathname,request.method);
  if(!action)throw Object.assign(Error('Not found.'),{status:404});

  if(action==='notification') {
    const body=await readJson(request);
    return json(await acceptAppleNotification(query,{
      signedPayload:body.signedPayload,
      verifyJws,
    }));
  }

  const {auth}=await mobileAccountIdentity(request);
  if(action==='status')return json({
    configured:true,
    product_id:APPLE_ELITE_PRODUCT_ID,
    subscription:await appleSubscriptionAccountState(query,auth.user_id),
    account_capabilities:await accountCapabilities(auth,query),
    checked_at:new Date().toISOString(),
  });

  const body=await readJson(request);
  const result=await acceptAppleClientTransaction(query,{
    authUserId:auth.user_id,
    signedTransaction:body.signedTransaction,
    verifyJws,
  });
  return json({
    verified:true,
    configured:true,
    product_id:APPLE_ELITE_PRODUCT_ID,
    subscription:result.subscription,
    account_capabilities:await accountCapabilities(auth,query),
    checked_at:new Date().toISOString(),
  });
}
