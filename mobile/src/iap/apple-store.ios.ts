import {
  deepLinkToSubscriptions,
  getAvailablePurchases,
  useIAP,
} from 'expo-iap';
import type {
  ProductSubscription,
  Purchase,
} from 'expo-iap';

import { config } from '@/src/config';
import type {
  AppleStoreHook,
  AppleStoreHookOptions,
  AppleStorePurchase,
  AppleStoreSubscription,
} from './apple-store';

const SCREENSHOT_SUBSCRIPTIONS: AppleStoreSubscription[] = [{
  id: 'pro.packone.app.elite.monthly',
  platform: 'ios',
  displayPrice: '$7.00',
  subscriptionPeriodNumberIOS: '1',
  subscriptionPeriodUnitIOS: 'month',
}];

const noop = async () => undefined;

export function useAppleStore(options?: AppleStoreHookOptions): AppleStoreHook {
  const live = useIAP({
    onPurchaseSuccess: options?.onPurchaseSuccess
      ? (purchase: Purchase) => options.onPurchaseSuccess?.(purchase as AppleStorePurchase)
      : undefined,
    onPurchaseError: options?.onPurchaseError,
  }) as unknown as AppleStoreHook;

  if (!config.screenshots.fixtures) return live;
  return {
    connected: true,
    subscriptions: SCREENSHOT_SUBSCRIPTIONS,
    fetchProducts: noop,
    requestPurchase: noop,
    finishTransaction: noop,
    restorePurchases: noop,
  };
}

export async function getAvailableApplePurchases(
  options?: { onlyIncludeActiveItemsIOS?: boolean },
): Promise<AppleStorePurchase[]> {
  if (config.screenshots.fixtures) return [];
  const purchases = await getAvailablePurchases(options);
  return purchases as unknown as AppleStorePurchase[];
}

export async function openAppleSubscriptionManagement(): Promise<void> {
  if (config.screenshots.fixtures) return;
  await deepLinkToSubscriptions();
}

export type { ProductSubscription };
