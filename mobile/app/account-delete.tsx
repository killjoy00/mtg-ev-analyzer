import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  deleteMobileAccount,
  finishAppleDeletion,
  startAppleDeletionVerification,
  startDeletionVerification,
} from '@/src/api/account';
import { loadNativeAppleSubscriptionStatus } from '@/src/api/apple-subscriptions';
import { ensureGuestSession } from '@/src/api/guest';
import { useAccountState } from '@/src/hooks/useAccountState';
import { openAppleSubscriptionManagement } from '@/src/iap/apple-store';
import { colors, spacing } from '@/src/theme';

const BILLING_WARNING = 'Deleting your Pack One account does not cancel subscriptions. Apple subscriptions must be canceled in your Apple subscription settings. Patreon memberships must be canceled on Patreon.';

export default function AccountDeleteScreen() {
  const { session, account, busy, clearAccount } = useAccountState({ requireAccount: true });
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteCode, setDeleteCode] = useState('');
  const [deleteCodeSent, setDeleteCodeSent] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [appleActive, setAppleActive] = useState(false);

  useEffect(() => {
    let active = true;
    if (!session?.accountToken || !session.accountUser?.id) {
      setAppleActive(false);
      return () => { active = false; };
    }
    void loadNativeAppleSubscriptionStatus(session)
      .then((status) => {
        if (active) setAppleActive(Boolean(status.subscription.linked && status.subscription.active));
      })
      .catch(() => {
        if (active) setAppleActive(false);
      });
    return () => { active = false; };
  }, [session]);

  const sendDeleteCode = async () => {
    if (!session || actionBusy) return;
    setActionBusy(true);
    setMessage(null);
    try {
      const result = await startDeletionVerification(session);
      setDeleteCodeSent(true);
      setMessage(`Deletion code sent. It expires in about ${Math.ceil(result.expiresInSeconds / 60)} minutes.`);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not send a deletion code.');
    } finally {
      setActionBusy(false);
    }
  };

  const performDelete = async () => {
    if (!session || actionBusy || !account?.deletion.method) return;
    setActionBusy(true);
    setMessage(null);
    try {
      if (account.deletion.method === 'apple') {
        const start = await startAppleDeletionVerification(session);
        const result = await WebBrowser.openAuthSessionAsync(start.url, 'packone://account');
        if (result.type !== 'success') {
          throw new Error(result.type === 'cancel' ? 'Apple verification was cancelled.' : 'Apple verification did not finish.');
        }
        const callback = new URL(result.url);
        if (callback.searchParams.get('appleDelete') === 'error') throw new Error('Apple verification did not finish.');
        const handoff = callback.searchParams.get('appleDeleteHandoff');
        if (!handoff) throw new Error('Apple verification did not finish.');
        await finishAppleDeletion(session, handoff);
      } else {
        await deleteMobileAccount(
          session,
          account.deletion.method === 'password'
            ? { currentPassword: deletePassword }
            : { code: deleteCode },
        );
      }
      const fresh = await ensureGuestSession();
      clearAccount(fresh);
      router.replace('/');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not delete the account.');
    } finally {
      setActionBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Permanently delete Pack One account?',
      'This permanently deletes your Pack One profile, career, scores and Draft Runs. It does not cancel Apple or Patreon billing. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete permanently', style: 'destructive', onPress: () => void performDelete() },
      ],
    );
  };

  const manageSubscription = async () => {
    setMessage(null);
    try {
      if (Platform.OS === 'ios') await openAppleSubscriptionManagement();
      else await Linking.openURL('https://apps.apple.com/account/subscriptions');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Apple subscription management could not be opened.');
    }
  };

  if (busy || !account) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.body}>Loading deletion options...</Text>
      </View>
    </SafeAreaView>
  );

  const disabled = actionBusy;
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>DELETE ACCOUNT</Text>
        <Text style={styles.title}>Delete your Pack One account</Text>
        <Text style={styles.body}>Deleting your account permanently removes your Pack One profile, career and scores. This cannot be undone.</Text>

        <View style={styles.panel}>
          {!account.deletion.enabled ? (
            <Text style={styles.body}>Account deletion is temporarily unavailable.</Text>
          ) : account.deletion.method === 'password' ? (
            <TextInput
              accessibilityLabel="Current password for account deletion"
              autoCapitalize="none"
              autoComplete="current-password"
              onChangeText={setDeletePassword}
              placeholder="Current password"
              placeholderTextColor={colors.faint}
              secureTextEntry
              style={styles.input}
              value={deletePassword}
            />
          ) : account.deletion.method === 'apple' ? (
            <Text style={styles.body}>Verify with Apple again to confirm permanent deletion. No email code is required.</Text>
          ) : account.deletion.method === 'email' ? (
            <>
              <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void sendDeleteCode()}
                style={[styles.secondaryButton, disabled && styles.disabled]}>
                <Text style={styles.secondaryButtonText}>{deleteCodeSent ? 'Send a new deletion code' : 'Email me a deletion code'}</Text>
              </Pressable>
              {deleteCodeSent ? (
                <TextInput
                  accessibilityLabel="Account deletion code"
                  keyboardType="number-pad"
                  maxLength={8}
                  onChangeText={setDeleteCode}
                  placeholder="8-digit deletion code"
                  placeholderTextColor={colors.faint}
                  style={styles.input}
                  value={deleteCode}
                />
              ) : null}
            </>
          ) : (
            <Text style={styles.body}>A verified account email is required before this account can be deleted.</Text>
          )}

          {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}

          <View style={styles.warning}>
            {appleActive ? (
              <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void manageSubscription()}
                style={[styles.secondaryButton, disabled && styles.disabled]}>
                <Text style={styles.secondaryButtonText}>Manage subscription</Text>
              </Pressable>
            ) : null}
            <Text style={styles.warningText}>{BILLING_WARNING}</Text>
          </View>

          {account.deletion.enabled && account.deletion.method ? (
            <Pressable
              accessibilityRole="button"
              disabled={disabled
                || (account.deletion.method === 'password' && !deletePassword)
                || (account.deletion.method === 'email' && (!deleteCodeSent || !/^\d{8}$/.test(deleteCode)))}
              onPress={confirmDelete}
              style={[
                styles.dangerButton,
                (disabled
                  || (account.deletion.method === 'password' && !deletePassword)
                  || (account.deletion.method === 'email' && (!deleteCodeSent || !/^\d{8}$/.test(deleteCode)))) && styles.disabled,
              ]}
            >
              <Text style={styles.dangerButtonText}>
                {account.deletion.method === 'apple' ? 'Verify with Apple and delete account' : 'Permanently delete account'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg, alignSelf: 'center', width: '100%', maxWidth: 760 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  eyebrow: { color: colors.danger, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 30, lineHeight: 35, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, gap: spacing.md },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, color: colors.ink, paddingHorizontal: spacing.md, fontSize: 16 },
  warning: { borderWidth: 1, borderColor: colors.lineStrong, padding: spacing.md, gap: spacing.md },
  warningText: { color: colors.ink, fontSize: 14, lineHeight: 21, fontWeight: '700' },
  secondaryButton: { minHeight: 48, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryButtonText: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
  dangerButton: { minHeight: 50, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  dangerButtonText: { color: colors.danger, fontSize: 15, fontWeight: '800' },
  message: { color: colors.danger, fontSize: 14, lineHeight: 21 },
  disabled: { opacity: 0.42 },
});
