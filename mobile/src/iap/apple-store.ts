export type AppleStorePurchase = {
  id: string;
  transactionId: string;
  productId: string;
  purchaseToken?: string | null;
  appAccountToken?: string | null;
  isAutoRenewing: boolean;
  purchaseState: string;
  quantity: number;
  store: string;
  transactionDate: number;
};

export type AppleStoreSubscription = {
  id: string;
  platform: string;
  displayPrice: string;
  subscriptionPeriodNumberIOS?: string | null;
  subscriptionPeriodUnitIOS?: string | null;
};

export type AppleStoreError = {
  code?: string;
  message?: string;
};

export type AppleStoreHookOptions = {
  onPurchaseSuccess?: (purchase: AppleStorePurchase) => void;
  onPurchaseError?: (error: AppleStoreError) => void;
};

export type AppleStoreHook = {
  connected: boolean;
  subscriptions: AppleStoreSubscription[];
  fetchProducts: (request: { skus: string[]; type: 'subs' }) => Promise<void>;
  requestPurchase: (request: {
    type: 'subs';
    request: {
      apple: {
        sku: string;
        appAccountToken: string;
        andDangerouslyFinishTransactionAutomatically: false;
      };
    };
  }) => Promise<unknown>;
  finishTransaction: (request: {
    purchase: AppleStorePurchase;
    isConsumable: false;
  }) => Promise<void>;
  restorePurchases: (options?: { onlyIncludeActiveItemsIOS?: boolean }) => Promise<void>;
};

const unavailable = async () => {
  throw new Error('Apple subscriptions are available only on iOS.');
};

const NO_SUBSCRIPTIONS: AppleStoreSubscription[] = [];

export function useAppleStore(_options?: AppleStoreHookOptions): AppleStoreHook {
  return {
    connected: false,
    subscriptions: NO_SUBSCRIPTIONS,
    fetchProducts: unavailable,
    requestPurchase: unavailable,
    finishTransaction: unavailable,
    restorePurchases: unavailable,
  };
}

export async function getAvailableApplePurchases(
  _options?: { onlyIncludeActiveItemsIOS?: boolean },
): Promise<AppleStorePurchase[]> {
  return [];
}

export async function openAppleSubscriptionManagement(): Promise<void> {
  await unavailable();
}
