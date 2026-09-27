import { requestJson } from '@/src/api/client';
import type { MobileSession } from '@/src/storage/session';

export const APPLE_ELITE_PRODUCT_ID = 'pro.packone.app.elite.monthly';

export type NativeAppleSubscription = {
  linked: boolean;
  active: boolean;
  provider: 'apple-app-store';
  productId: string;
  status?: 'active' | 'grace_period' | 'billing_retry' | 'expired' | 'revoked' | 'unknown';
  expiresAt?: string | null;
  autoRenewEnabled?: boolean | null;
  environment?: 'Production' | 'Sandbox';
};

export type NativeAppleSubscriptionStatus = {
  configured: boolean;
  product_id: string;
  subscription: NativeAppleSubscription;
  account_capabilities: string[];
  checked_at: string;
};

function nativeIdentity(session: MobileSession) {
  const accountId = session.accountUser?.id;
  if (!session.playerToken || !session.accountToken || !accountId) {
    throw new Error('Sign in to a Pack One account before managing an Apple subscription.');
  }
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) {
    throw new Error('The current Pack One account identifier is invalid.');
  }
  return {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    accountId: accountId.toLowerCase(),
  };
}

function checkedStatus(value: NativeAppleSubscriptionStatus) {
  if (!value || typeof value !== 'object'
    || value.product_id !== APPLE_ELITE_PRODUCT_ID
    || !Array.isArray(value.account_capabilities)
    || !value.subscription
    || value.subscription.provider !== 'apple-app-store'
    || value.subscription.productId !== APPLE_ELITE_PRODUCT_ID) {
    throw new Error('Apple subscription status could not be verified.');
  }
  return value;
}

export async function loadNativeAppleSubscriptionStatus(session: MobileSession) {
  const identity = nativeIdentity(session);
  return checkedStatus(await requestJson<NativeAppleSubscriptionStatus>(
    '/growth/v1/apple-subscriptions/mobile/status',
    {
      mobileSessionToken: identity.mobileSessionToken,
      mobileAccountToken: identity.mobileAccountToken,
      credentials: 'omit',
    },
  ));
}

export async function verifyNativeAppleSubscription(
  session: MobileSession,
  signedTransaction: string,
) {
  const identity = nativeIdentity(session);
  const signed = String(signedTransaction || '');
  if (signed.length < 64 || signed.length > 50_000 || signed.split('.').length !== 3) {
    throw new Error('StoreKit did not return a verifiable transaction.');
  }
  return checkedStatus(await requestJson<NativeAppleSubscriptionStatus & { verified: true }>(
    '/growth/v1/apple-subscriptions/mobile/verify',
    {
      method: 'POST',
      body: { signedTransaction: signed },
      mobileSessionToken: identity.mobileSessionToken,
      mobileAccountToken: identity.mobileAccountToken,
      credentials: 'omit',
    },
  ));
}
