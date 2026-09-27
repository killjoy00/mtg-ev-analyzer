import {
  deepLinkToSubscriptions,
  getAvailablePurchases,
  type ProductSubscription,
  type Purchase,
  useIAP,
} from 'expo-iap';
import { router, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  APPLE_ELITE_PRODUCT_ID,
  loadNativeAppleSubscriptionStatus,
  verifyNativeAppleSubscription,
} from '@/src/api/apple-subscriptions';
import type { NativeAppleSubscriptionStatus } from '@/src/api/apple-subscriptions';
import { connectNativePatreon, loadNativePatreonStatus, mutateNativePatreon } from '@/src/api/patreon';
import { canonicalContentUrl } from '@/src/contentLinks';
import { useAppResume } from '@/src/hooks/useAppResume';
import { accountAccessLabel, createMembershipController, initialMembershipState } from '@/src/state/membership';
import { readSession, subscribeSession } from '@/src/storage/session';
import type { MobileSession } from '@/src/storage/session';
import { colors, spacing } from '@/src/theme';

function billingSession(session: MobileSession | null) {
  return session?.accountToken && session.accountUser?.id ? session : null;
}

function purchaseKey(purchase: Purchase) {
  return purchase.transactionId || purchase.purchaseToken || purchase.id;
}

function periodLabel(product: ProductSubscription | undefined) {
  if (!product || product.platform !== 'ios') return '';
  const count = Number(product.subscriptionPeriodNumberIOS || 1);
  const unit = String(product.subscriptionPeriodUnitIOS || '').toLowerCase();
  if (!unit) return '';
  const plural = count === 1 ? unit : `${unit}s`;
  return count === 1 ? `per ${unit}` : `every ${count} ${plural}`;
}

function AppleElitePanel({
  hasAccountElite,
  onAccessChanged,
}: {
  hasAccountElite: boolean;
  onAccessChanged: () => void;
}) {
  const [session, setSession] = useState<MobileSession | null>(null);
  const [status, setStatus] = useState<NativeAppleSubscriptionStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const purchaseHandler = useRef<((purchase: Purchase) => void) | null>(null);
  const purchaseErrorHandler = useRef<((error: { code?: string; message?: string }) => void) | null>(null);
  const verifiedPurchases = useRef(new Map<string, Promise<{
    status: NativeAppleSubscriptionStatus;
    accountId: string;
  }>>());

  const {
    connected,
    subscriptions,
    fetchProducts,
    requestPurchase,
    finishTransaction,
    restorePurchases,
  } = useIAP({
    onPurchaseSuccess: (purchase) => purchaseHandler.current?.(purchase),
    onPurchaseError: (purchaseError) => purchaseErrorHandler.current?.(purchaseError),
  });

  useEffect(() => {
    let active = true;
    void readSession().then((value) => { if (active) setSession(value); });
    const unsubscribe = subscribeSession((value) => setSession(value));
    return () => { active = false; unsubscribe(); };
  }, []);

  const refreshStatus = useCallback(async (forSession: MobileSession | null) => {
    const usable = billingSession(forSession);
    const request = ++generation.current;
    setNotice(null);
    setError(null);
    if (!usable) {
      setStatus(null);
      setLoadingStatus(false);
      return;
    }
    setLoadingStatus(true);
    try {
      const next = await loadNativeAppleSubscriptionStatus(usable);
      if (request === generation.current) setStatus(next);
    } catch (statusError: unknown) {
      if (request === generation.current) {
        setStatus(null);
        setError(statusError instanceof Error ? statusError.message : 'Apple subscription status is unavailable.');
      }
    } finally {
      if (request === generation.current) setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus(session);
  }, [refreshStatus, session]);

  useEffect(() => {
    if (!connected) return;
    void fetchProducts({ skus: [APPLE_ELITE_PRODUCT_ID], type: 'subs' })
      .catch((storeError: unknown) => {
        setError(storeError instanceof Error ? storeError.message : 'The App Store product is unavailable.');
      });
  }, [connected, fetchProducts]);

  const verifyAndFinish = useCallback((purchase: Purchase, fixedSession?: MobileSession) => {
    const key = purchaseKey(purchase);
    const existing = verifiedPurchases.current.get(key);
    if (existing) return existing;

    const operation = (async () => {
      if (purchase.productId !== APPLE_ELITE_PRODUCT_ID) {
        throw new Error('StoreKit returned an unexpected subscription product.');
      }
      const current = billingSession(fixedSession || await readSession());
      if (!current) throw new Error('Sign in to the Pack One account used for this Apple subscription.');
      const accountId = current.accountUser!.id.toLowerCase();
      if (purchase.appAccountToken && purchase.appAccountToken.toLowerCase() !== accountId) {
        throw new Error('This Apple subscription is linked to a different Pack One account.');
      }
      const signedTransaction = String(purchase.purchaseToken || '');
      const verified = await verifyNativeAppleSubscription(current, signedTransaction);

      // StoreKit is finished only after the Pack One backend has accepted the
      // Apple-signed transaction and projected the provider-owned entitlement.
      await finishTransaction({ purchase, isConsumable: false });
      return { status: verified, accountId };
    })();

    verifiedPurchases.current.set(key, operation);
    void operation.catch(() => { verifiedPurchases.current.delete(key); });
    return operation;
  }, [finishTransaction]);

  const applyVerifiedResult = useCallback(async (
    result: { status: NativeAppleSubscriptionStatus; accountId: string },
    successNotice: string,
  ) => {
    const current = billingSession(await readSession());
    if (!current || current.accountUser!.id.toLowerCase() !== result.accountId) return;
    setStatus(result.status);
    setNotice(successNotice);
    setError(null);
    onAccessChanged();
  }, [onAccessChanged]);

  purchaseHandler.current = (purchase) => {
    void (async () => {
      setVerifying(true);
      setError(null);
      try {
        const result = await verifyAndFinish(purchase);
        await applyVerifiedResult(
          result,
          result.status.subscription.active
            ? 'Apple verified your subscription. Elite access is active.'
            : 'Apple verified the transaction, but it is not currently granting Elite access.',
        );
      } catch (purchaseError: unknown) {
        setError(purchaseError instanceof Error ? purchaseError.message : 'Apple purchase verification failed.');
      } finally {
        setVerifying(false);
      }
    })();
  };

  purchaseErrorHandler.current = (purchaseError) => {
    setRequesting(false);
    setVerifying(false);
    if (purchaseError.code === 'user-cancelled') {
      setNotice('Purchase canceled. No subscription change was made.');
      setError(null);
      return;
    }
    setError(purchaseError.message || 'The App Store could not complete the purchase.');
  };

  const product = subscriptions.find((item) => item.id === APPLE_ELITE_PRODUCT_ID);
  const period = periodLabel(product);
  const busy = requesting || verifying || restoring || loadingStatus;
  const signedIn = Boolean(billingSession(session));
  const appleActive = Boolean(status?.subscription.active);
  const otherProviderActive = hasAccountElite && !appleActive;

  const purchase = async () => {
    const current = billingSession(await readSession());
    if (!current) {
      setError('Sign in to a Pack One account before subscribing.');
      return;
    }
    if (!connected || !product) {
      setError('The Pack One Elite subscription is not available from the App Store right now.');
      return;
    }
    if (otherProviderActive) {
      setError('Elite access is already active from another provider. Apple purchase is disabled to avoid duplicate billing.');
      return;
    }
    setRequesting(true);
    setNotice(null);
    setError(null);
    try {
      await requestPurchase({
        type: 'subs',
        request: {
          apple: {
            sku: APPLE_ELITE_PRODUCT_ID,
            appAccountToken: current.accountUser!.id,
            andDangerouslyFinishTransactionAutomatically: false,
          },
        },
      });
    } catch (purchaseError: unknown) {
      setRequesting(false);
      setError(purchaseError instanceof Error ? purchaseError.message : 'The App Store could not start the purchase.');
    } finally {
      // A successful StoreKit event has its own verification state. This only
      // releases the "opening purchase sheet" state after dispatch.
      setRequesting(false);
    }
  };

  const restore = async () => {
    const current = billingSession(await readSession());
    if (!current) {
      setError('Sign in to the Pack One account used for the Apple subscription before restoring purchases.');
      return;
    }
    if (!connected) {
      setError('The App Store is not connected yet.');
      return;
    }
    setRestoring(true);
    setNotice(null);
    setError(null);
    try {
      await restorePurchases({ onlyIncludeActiveItemsIOS: true });
      const purchases = await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
      const eligible = purchases.filter((item) => item.productId === APPLE_ELITE_PRODUCT_ID);
      if (!eligible.length) {
        setNotice('No active Pack One Elite subscription was found for this Apple Account.');
        return;
      }
      let restored = 0;
      for (const item of eligible) {
        const result = await verifyAndFinish(item, current);
        await applyVerifiedResult(result, 'Apple verified your restored subscription.');
        if (result.status.subscription.active) restored += 1;
      }
      setNotice(restored
        ? 'Apple verified your restored subscription. Elite access is active.'
        : 'Apple verified the available transaction, but it is not currently granting Elite access.');
    } catch (restoreError: unknown) {
      setError(restoreError instanceof Error ? restoreError.message : 'Apple purchase restore failed.');
    } finally {
      setRestoring(false);
    }
  };

  const manage = async () => {
    try {
      await deepLinkToSubscriptions();
    } catch (manageError: unknown) {
      setError(manageError instanceof Error ? manageError.message : 'Apple subscription management could not be opened.');
    }
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Pack One Elite with Apple</Text>
      <Text style={styles.body}>Elite unlocks Powered Cube practice and custom-set practice on this Pack One account.</Text>
      {appleActive ? (
        <Text style={styles.body}>Your Apple subscription is active{status?.subscription.expiresAt
          ? ` through ${new Date(status.subscription.expiresAt).toLocaleDateString()}`
          : ''}.</Text>
      ) : otherProviderActive ? (
        <Text style={styles.body}>Elite access is already active from another provider. Apple purchase is disabled here to avoid duplicate billing.</Text>
      ) : (
        <Text style={styles.body}>{product
          ? `Apple price: ${product.displayPrice}${period ? ` ${period}` : ''}.`
          : connected
            ? 'Loading the current App Store price...'
            : 'Connecting to the App Store...'}</Text>
      )}

      {!signedIn ? <Text style={styles.help}>Sign in to Pack One before purchasing or restoring so StoreKit can bind the subscription to the correct account.</Text> : null}

      {!appleActive ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Subscribe to Pack One Elite with Apple"
          disabled={busy || !signedIn || !connected || !product || otherProviderActive}
          onPress={() => void purchase()}
          style={[styles.button, (busy || !signedIn || !connected || !product || otherProviderActive) && styles.disabled]}
        >
          <Text style={styles.buttonText}>{product
            ? `Subscribe with Apple — ${product.displayPrice}${period ? ` ${period}` : ''}`
            : 'Subscribe with Apple'}</Text>
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Restore Apple purchases"
        disabled={busy || !signedIn || !connected}
        onPress={() => void restore()}
        style={[styles.button, (busy || !signedIn || !connected) && styles.disabled]}
      >
        <Text style={styles.buttonText}>Restore Purchases</Text>
      </Pressable>

      {status?.subscription.linked ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage Apple subscription"
          disabled={busy}
          onPress={() => void manage()}
          style={[styles.button, busy && styles.disabled]}
        >
          <Text style={styles.buttonText}>Manage Apple Subscription</Text>
        </Pressable>
      ) : null}

      {busy ? <ActivityIndicator accessibilityLabel="Checking Apple subscription" /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {notice ? <Text accessibilityRole="alert" style={styles.body}>{notice}</Text> : null}

      <Text style={styles.help}>Payment is charged to your Apple Account at confirmation. The subscription renews automatically unless canceled through Apple. You can manage or cancel it in Apple subscription settings.</Text>
      <View style={styles.linkRow}>
        <Pressable accessibilityRole="link" accessibilityLabel="Subscription Terms"
          onPress={() => void Linking.openURL(canonicalContentUrl('terms'))}>
          <Text style={styles.linkText}>Terms</Text>
        </Pressable>
        <Pressable accessibilityRole="link" accessibilityLabel="Subscription Privacy"
          onPress={() => void Linking.openURL(canonicalContentUrl('privacy'))}>
          <Text style={styles.linkText}>Privacy</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function MembershipScreen() {
  const [state, setState] = useState(initialMembershipState);
  const [controller] = useState(() => createMembershipController({
    readSession,
    load: loadNativePatreonStatus,
    connect: connectNativePatreon,
    mutate: mutateNativePatreon,
    openBrowser: (url) => WebBrowser.openBrowserAsync(url),
    changed: setState,
  }));

  useEffect(() => {
    controller.activate();
    const unsubscribe = subscribeSession((next) => controller.sessionChanged(next));
    return () => { unsubscribe(); controller.dispose(); };
  }, [controller]);
  useFocusEffect(useCallback(() => {
    controller.activate();
    void controller.check();
    return () => controller.pause();
  }, [controller]));
  useAppResume(() => controller.check());

  const current = state.phase === 'ready' ? state.data : null;
  const hasAccountElite = Boolean(current
    && current.account_capabilities.includes('unlimited_cube_practice')
    && current.account_capabilities.includes('custom_corpus'));

  const confirmDisconnect = () => {
    if (!current?.connected || state.busy) return;
    const { account_user_id: accountUserId, player_id: playerId } = current;
    Alert.alert('Disconnect Patreon?',
      'This removes only Patreon-provided access in Pack One. Other account access is kept. This does not cancel billing at Patreon.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => void controller.disconnect(accountUserId, playerId) },
      ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.eyebrow}>PACK ONE MEMBERSHIP</Text>
        <Text style={styles.title}>Your account access</Text>
        <View style={styles.panel}>
          <Text style={styles.heading}>{accountAccessLabel(state)}</Text>
          {state.busy ? <ActivityIndicator accessibilityLabel="Checking membership" /> : null}
          {state.phase === 'loading' ? <Text style={styles.body}>Checking access for the current signed-in account...</Text> : null}
          {current ? (
            <>
              <Text style={styles.body}>Regular Draft Run practice: included</Text>
              <Text style={styles.body}>Powered Cube practice: {current.account_capabilities.includes('unlimited_cube_practice') ? 'available' : 'not currently included'}</Text>
              <Text style={styles.body}>Custom-set practice: {current.account_capabilities.includes('custom_corpus') ? 'available' : 'not currently included'}</Text>
              <Text style={styles.help}>This is the same provider-independent account access checked by gameplay. Patreon and Apple are independent entitlement sources for the same account capabilities.</Text>
            </>
          ) : state.phase === 'error' ? (
            <Text style={styles.body}>Access is not verified right now. A failed lookup does not mean your account is Free or that access was removed.</Text>
          ) : null}
        </View>

        {Platform.OS === 'ios' ? (
          <AppleElitePanel
            hasAccountElite={hasAccountElite}
            onAccessChanged={() => { void controller.check(); }}
          />
        ) : null}

        {current ? (
          <View style={styles.panel}>
            <Text style={styles.heading}>Patreon account</Text>
            <Text style={styles.body}>{current.connected ? 'Patreon is connected to this account.' : 'No Patreon account is connected.'}</Text>
            {!current.configured ? <Text style={styles.body}>Patreon connection service is unavailable. Account access above remains a separate check.</Text> : null}
            {current.membership?.sync_pending ? (
              <Text style={styles.body}>Membership reconciliation is pending. A refresh request is not confirmation of a completed sync.</Text>
            ) : current.connected ? (
              <Text style={styles.body}>{current.capabilities.includes('custom_corpus') && current.capabilities.includes('unlimited_cube_practice')
                ? 'Patreon-provided account access is active.'
                : current.capabilities.length
                  ? 'Some Patreon-provided account access is active.'
                  : 'No Patreon-provided access is currently active. Manage your membership through your subscription provider.'}</Text>
            ) : null}
            {current.membership?.last_synced_at ? <Text style={styles.help}>Last provider sync: {current.membership.last_synced_at}</Text> : null}
            {current.configured ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Sign in with Patreon" disabled={state.busy}
                onPress={() => void controller.connect()} style={[styles.button, state.busy && styles.disabled]}>
                <Text style={styles.buttonText}>Sign in with Patreon</Text>
              </Pressable>
            ) : null}
            {current.connected && current.configured ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Request Patreon refresh" disabled={state.busy}
                onPress={() => void controller.refresh()} style={[styles.button, state.busy && styles.disabled]}>
                <Text style={styles.buttonText}>Request Patreon refresh</Text>
              </Pressable>
            ) : null}
            {current.connected ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Disconnect Patreon" disabled={state.busy}
                onPress={confirmDisconnect} style={[styles.button, state.busy && styles.disabled]}>
                <Text style={styles.buttonText}>Disconnect Patreon</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
        {state.notice ? <Text accessibilityRole="alert" style={styles.body}>{state.notice}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Check membership status" disabled={state.busy}
          onPress={() => void controller.check()} style={[styles.button, state.busy && styles.disabled]}>
          <Text style={styles.buttonText}>Check status</Text>
        </Pressable>
        {state.phase === 'guest' ? (
          <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={styles.button}>
            <Text style={styles.buttonText}>Sign in to manage membership</Text>
          </Pressable>
        ) : null}
        <Text style={styles.help}>Sign in with Patreon connects an existing Patreon account. Patreon membership changes remain managed through Patreon.</Text>
        <Text style={styles.help}>When Patreon authorization finishes, close the browser and return here. Check status verifies the current account; a browser message alone does not grant access.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colors.ink, fontSize: 30, lineHeight: 36, fontWeight: '800' },
  heading: { color: colors.ink, fontSize: 20, lineHeight: 26, fontWeight: '800' },
  panel: { padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  body: { color: colors.ink, fontSize: 15, lineHeight: 23 },
  help: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 15, lineHeight: 23 },
  button: { minHeight: 48, padding: spacing.md, borderWidth: 1, borderColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: colors.accentDark, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  disabled: { opacity: 0.5 },
  linkRow: { flexDirection: 'row', gap: spacing.lg },
  linkText: { color: colors.accentDark, fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
});
