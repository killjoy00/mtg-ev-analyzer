import { APPLE_ELITE_PRODUCT_ID, verifyNativeAppleSubscription } from '@/src/api/apple-subscriptions';
import { finishApplePurchase, getAvailableApplePurchases } from '@/src/iap/apple-store';
import type { MobileSession } from '@/src/storage/session';

// App Store Server Notifications stay the primary signal for renewals and refunds.
// This re-sends the subscription StoreKit currently holds for the signed-in account,
// so a missed renewal notification cannot leave a paying subscriber without Elite.
// It uses the same Apple-signed verification as a purchase, and the server ignores
// state older than what it already has.
export const APPLE_RESYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

let last: { accountId: string; at: number } | null = null;
let running: Promise<number> | null = null;

export function resyncAppleSubscription(session: MobileSession | null, now = Date.now()): Promise<number> {
  const accountId = session?.playerToken && session.accountToken ? session.accountUser?.id?.toLowerCase() : undefined;
  if (!session || !accountId) return Promise.resolve(0);
  if (running) return running.then(() => resyncAppleSubscription(session, now));
  if (last?.accountId === accountId && now - last.at < APPLE_RESYNC_INTERVAL_MS) return Promise.resolve(0);
  last = { accountId, at: now };
  running = (async () => {
    let verified = 0;
    const purchases = await getAvailableApplePurchases({ onlyIncludeActiveItemsIOS: true });
    for (const purchase of purchases) {
      // Only this account's own subscription; another account's is never sent.
      if (purchase.productId !== APPLE_ELITE_PRODUCT_ID) continue;
      if (purchase.appAccountToken?.toLowerCase() !== accountId) continue;
      try {
        await verifyNativeAppleSubscription(session, String(purchase.purchaseToken || ''));
        // Finish only after the backend accepted it, as the purchase flow does.
        await finishApplePurchase(purchase);
        verified += 1;
      } catch {
        // Background work: the membership screen reports errors when the user is there.
      }
    }
    return verified;
  })().catch(() => 0).finally(() => { running = null; });
  return running;
}

export function resetAppleResyncForTests() {
  last = null;
  running = null;
}
