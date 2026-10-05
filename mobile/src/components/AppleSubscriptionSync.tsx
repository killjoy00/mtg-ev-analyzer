import { useCallback, useEffect } from 'react';
import { Platform } from 'react-native';

import { config } from '@/src/config';
import { useAppResume } from '@/src/hooks/useAppResume';
import { resyncAppleSubscription } from '@/src/iap/apple-resync';
import { readSession, subscribeSession } from '@/src/storage/session';

// Re-syncs the Apple Elite subscription at launch, on sign-in and on return to
// the app (throttled in resyncAppleSubscription). Renders nothing.
export function AppleSubscriptionSync() {
  const sync = useCallback(async () => {
    if (Platform.OS !== 'ios' || config.screenshots.fixtures) return;
    await resyncAppleSubscription(await readSession());
  }, []);

  useEffect(() => {
    void sync();
    return subscribeSession(() => { void sync(); });
  }, [sync]);

  useAppResume(sync);
  return null;
}
