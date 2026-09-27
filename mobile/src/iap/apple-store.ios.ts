import {
  deepLinkToSubscriptions,
  getAvailablePurchases,
  useIAP,
} from 'expo-iap';
import type {
  ProductSubscription,
  Purchase,
} from 'expo-iap';

import type {
  AppleStoreHook,
  AppleStoreHookOptions,
  AppleStorePurchase,
} from './apple-store';

export function useAppleStore(options?: AppleStoreHookOptions): AppleStoreHook {
  return useIAP({
    onPurchaseSuccess: options?.onPurchaseSuccess
      ? (purchase: Purchase) => options.onPurchaseSuccess?.(purchase as AppleStorePurchase)
      : undefined,
    onPurchaseError: options?.onPurchaseError,
  }) as unknown as AppleStoreHook;
}

export async function getAvailableApplePurchases(
  options?: { onlyIncludeActiveItemsIOS?: boolean },
): Promise<AppleStorePurchase[]> {
  const purchases = await getAvailablePurchases(options);
  return purchases as unknown as AppleStorePurchase[];
}

export async function openAppleSubscriptionManagement(): Promise<void> {
  await deepLinkToSubscriptions();
}

export type { ProductSubscription };
