import {
  deepLinkToSubscriptions,
  getAvailablePurchases,
  useIAP,
} from 'expo-iap';

import { APPLE_ELITE_PRODUCT_ID } from '@/src/api/apple-subscriptions';
import { config } from '@/src/config';
import type {
  ProductSubscription,
  Purchase,
} from 'expo-iap';

import type {
  AppleStoreHook,
  AppleStoreHookOptions,
  AppleStorePurchase,
} from './apple-store';

const SCREENSHOT_SUBSCRIPTIONS = [{
  id: APPLE_ELITE_PRODUCT_ID,
  platform: 'ios',
  displayPrice: '$7.00',
  subscriptionPeriodNumberIOS: '1',
  subscriptionPeriodUnitIOS: 'month',
}];

const noOp = async () => undefined;

export function useAppleStore(options?: AppleStoreHookOptions): AppleStoreHook {
  const liveStore = useIAP({
    onPurchaseSuccess: options?.onPurchaseSuccess
      ? (purchase: Purchase) => options.onPurchaseSuccess?.(purchase as AppleStorePurchase)
      : undefined,
    onPurchaseError: options?.onPurchaseError,
  }) as unknown as AppleStoreHook;
  if (!config.screenshots?.enabled) return liveStore;
  return {
    connected: true,
    subscriptions: SCREENSHOT_SUBSCRIPTIONS,
    fetchProducts: noOp,
    requestPurchase: noOp,
    finishTransaction: noOp,
    restorePurchases: noOp,
  } as AppleStoreHook;
}

export async function getAvailableApplePurchases(
  options?: { onlyIncludeActiveItemsIOS?: boolean },
): Promise<AppleStorePurchase[]> {
  if (config.screenshots?.enabled) return [];
  const purchases = await getAvailablePurchases(options);
  return purchases as unknown as AppleStorePurchase[];
}

export async function openAppleSubscriptionManagement(): Promise<void> {
  if (config.screenshots?.enabled) return;
  await deepLinkToSubscriptions();
}

export type { ProductSubscription };
