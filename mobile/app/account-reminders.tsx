import { themedStyles, withAppTheme } from '@/src/appearance';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/src/components/Text';
import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';
import { useAccountState } from '@/src/hooks/useAccountState';
import { requestMobileVerificationEmail } from '@/src/api/account';
import {
  loadNativeReminders, saveNativeReminders, unregisterReminderDevice,
  reminderDeviceEnabled, assertReminderAccount, type ReminderSnapshot,
} from '@/src/api/reminders';
import { colors, spacing } from '@/src/theme';

function nextEmailText(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function AccountRemindersScreen() {
  const { session, account, busy: accountBusy, message: loadMessage, refresh } = useAccountState({ requireAccount: true });
  const [snapshot, setSnapshot] = useState<ReminderSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deviceEnabled, setDeviceEnabled] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const ownerId = session?.accountUser?.id || null;

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setSnapshot(null);
      setLoading(true);
      setSaving(false);
      setDeviceEnabled(false);
      setNotice(null);
      if (!session?.accountToken) {
        setLoadedFor(null);
        setLoading(false);
        return;
      }
      try {
        const [value, registered] = await Promise.all([
          loadNativeReminders(session), reminderDeviceEnabled(session),
        ]);
        if (!active) return;
        setSnapshot(value);
        setDeviceEnabled(registered);
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : 'Could not load reminders.');
      } finally {
        if (active) {
          setLoadedFor(session.accountUser?.id || null);
          setLoading(false);
        }
      }
    });
    return () => { active = false; };
  }, [session]);

  const save = async (channel: 'email' | 'push', enabled: boolean) => {
    if (!session?.accountToken || !snapshot || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      // The server owns the one shared 23:05 UTC schedule. Do not send editable
      // frequency, weekday, local-time, or timezone options that it ignores.
      const updated = await saveNativeReminders(session, channel, enabled);
      if (channel === 'push' && !enabled) await unregisterReminderDevice(session);
      const registered = await reminderDeviceEnabled(session);
      await assertReminderAccount(session);
      setSnapshot(updated);
      setDeviceEnabled(registered);
      setNotice(channel === 'email'
        ? enabled ? 'Email reminders turned on.' : 'Email reminders turned off.'
        : 'Push reminders turned off.');
    } catch (error) {
      try { await assertReminderAccount(session); } catch { return; }
      setNotice(error instanceof Error ? error.message : 'Reminder settings could not be saved.');
    } finally {
      try { await assertReminderAccount(session); setSaving(false); } catch { /* Current account owns its state. */ }
    }
  };

  const disableThisDevice = async () => {
    if (!session?.accountToken || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      await unregisterReminderDevice(session);
      await assertReminderAccount(session);
      setDeviceEnabled(false);
      setNotice('Reminders are off on this device. Other devices are unchanged.');
    } catch (error) {
      try {
        await assertReminderAccount(session);
        setNotice(error instanceof Error ? error.message : 'Could not unregister this device.');
      } catch { /* Avoid cross-account messages. */ }
    } finally {
      try { await assertReminderAccount(session); setSaving(false); } catch { /* Current account owns its state. */ }
    }
  };

  const sendVerification = async () => {
    const email = account?.user?.email;
    if (!session || !email || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      await requestMobileVerificationEmail(session, email);
      await assertReminderAccount(session);
      setNotice('Verification requested. Check your account email.');
    } catch (error) {
      try {
        await assertReminderAccount(session);
        setNotice(error instanceof Error ? error.message : 'Could not request verification.');
      } catch { /* Avoid cross-account messages. */ }
    } finally {
      try { await assertReminderAccount(session); setSaving(false); } catch { /* Current account owns its state. */ }
    }
  };

  const disabled = saving || loading || accountBusy;
  if (accountBusy || loading || (Boolean(session?.accountToken) && loadedFor !== ownerId)) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}>
      <ActivityIndicator color={colors.accent} /><Text style={styles.body}>Loading reminders…</Text>
    </View></SafeAreaView>;
  }
  if (!account || !session?.accountToken) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}>
      <Text accessibilityRole="alert" style={styles.alert}>{loadMessage || 'Sign in to manage reminders.'}</Text>
      <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.button}>
        <Text style={styles.buttonLabel}>Try again</Text>
      </Pressable>
    </View></SafeAreaView>;
  }

  const email = snapshot?.email;
  const canEnable = Boolean(email?.eligible && !email.suppressed);
  const nextEmail = nextEmailText(snapshot?.nextAt);

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.eyebrow}>ACCOUNT SETTINGS</Text>
    <Text style={styles.title}>Daily reminders</Text>
    <Text style={styles.body}>Get one email reminder a day. If you’ve already finished all three Dailies, we won’t send one.</Text>

    {email ? <View style={styles.panel}>
      <Text style={styles.heading}>Email reminders</Text>
      <Text style={styles.body}>
        {email.enabled
          ? 'On' + (nextEmail ? ' · Next email: ' + nextEmail : ' · Email reminders are on.')
          : 'Off · No reminder emails.'}
      </Text>
      {email.addressChanged ? <Text accessibilityRole="alert" style={styles.help}>
        Your sign-in email changed. Turn reminders off and on again to send them to the new address.
      </Text> : null}
      {email.suppressed ? <Text accessibilityRole="alert" style={styles.help}>
        Email reminders are paused after a bounce or complaint. Contact support to turn them back on.
      </Text> : null}
      {!email.eligible ? <View style={styles.verifyRow}>
        <Text style={styles.help}>Verify your sign-in email to turn on email reminders.</Text>
        {account.user?.email ? <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void sendVerification()} style={styles.secondary}>
          <Text style={styles.buttonLabel}>Send verification email</Text>
        </Pressable> : null}
      </View> : null}
      {email.enabled && email.deliveryActive === false ? <Text style={styles.help}>Email reminders aren’t being sent yet. Your choice is saved.</Text> : null}
      {(email.enabled || canEnable) ? <Pressable
        accessibilityRole="button" disabled={disabled}
        onPress={() => void save('email', !email.enabled)}
        style={[styles.button, disabled && styles.disabled]}
      ><Text style={styles.buttonLabel}>{email.enabled ? 'Turn off' : 'Turn on'}</Text></Pressable> : null}
    </View> : null}

    {(snapshot?.push.enabled || deviceEnabled) ? <View style={styles.panel}>
      <Text style={styles.heading}>Previously enabled push reminders</Text>
      <Text style={styles.help}>Push reminders are not currently offered. You can still turn off any existing opt-in.</Text>
      {deviceEnabled ? <Pressable accessibilityRole="button" disabled={disabled}
        onPress={() => void disableThisDevice()} style={styles.secondary}>
        <Text style={styles.buttonLabel}>Turn off this device</Text>
      </Pressable> : null}
      {snapshot?.push.enabled ? <Pressable accessibilityRole="button" disabled={disabled}
        onPress={() => void save('push', false)} style={styles.secondary}>
        <Text style={styles.buttonLabel}>Turn push off on all devices</Text>
      </Pressable> : null}
    </View> : null}

    {notice ? <Text accessibilityRole="alert" style={styles.alert}>{notice}</Text> : null}
  </ScrollView></SafeAreaView>;
}

const styles = themedStyles(StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md, alignSelf: 'center', width: '100%', maxWidth: 760 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 30, lineHeight: 35, fontWeight: '800' },
  heading: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  help: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.md },
  verifyRow: { gap: spacing.sm },
  button: { minHeight: 50, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondary: { minHeight: 45, alignItems: 'center', justifyContent: 'center', padding: spacing.sm, borderWidth: 1, borderColor: colors.lineStrong },
  buttonLabel: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
  alert: { color: colors.danger, fontSize: 14, lineHeight: 21 },
  disabled: { opacity: 0.4 },
}));

export default withAppTheme(AccountRemindersScreen);
