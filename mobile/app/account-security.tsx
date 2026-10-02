import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { changeMobilePassword, forgetAccountLocally } from '@/src/api/account';
import { useAccountState } from '@/src/hooks/useAccountState';
import { colors, spacing } from '@/src/theme';

export default function AccountSecurityScreen() {
  const { session, account, busy, message: loadMessage, refresh, clearAccount } = useAccountState({ requireAccount: true });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const changePassword = async () => {
    if (!session?.accountToken || changing || !account?.credentials.password) return;
    if (newPassword !== confirmPassword) {
      setMessage('New passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setMessage('New password must be at least 8 characters.');
      return;
    }
    setChanging(true);
    setMessage(null);
    try {
      await changeMobilePassword(session, currentPassword, newPassword);
      const guest = await forgetAccountLocally(session);
      clearAccount(guest);
      router.replace({
        pathname: '/account',
        params: { notice: 'Password changed. Pack One signed out every device. Sign in again with your new password.' },
      });
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not change your password.');
    } finally {
      setChanging(false);
    }
  };

  if (busy) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.body}>Loading sign-in settings...</Text>
      </View>
    </SafeAreaView>
  );

  if (!account) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <Text accessibilityRole="alert" style={styles.message}>{loadMessage || 'Could not load sign-in settings.'}</Text>
        <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.button}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>SIGN-IN &amp; SECURITY</Text>
        <Text style={styles.title}>Sign-in methods</Text>
        <View style={styles.panel}>
          <Text style={styles.method}>{account.credentials.password ? 'Password · connected' : 'Password · not configured'}</Text>
          <Text style={styles.method}>{account.credentials.google ? 'Google · connected' : 'Google · not connected'}</Text>
          <Text style={styles.method}>{account.credentials.apple ? 'Apple · connected' : 'Apple · not connected'}</Text>
        </View>

        {account.credentials.password ? (
          <View style={styles.panel}>
            <Text style={styles.heading}>Change password</Text>
            <Text style={styles.body}>Changing your password signs out every device.</Text>
            <TextInput accessibilityLabel="Current password" autoCapitalize="none" autoComplete="current-password"
              onChangeText={setCurrentPassword} placeholder="Current password" placeholderTextColor={colors.faint}
              secureTextEntry style={styles.input} value={currentPassword} />
            <TextInput accessibilityLabel="New password" autoCapitalize="none" autoComplete="new-password"
              onChangeText={setNewPassword} placeholder="New password" placeholderTextColor={colors.faint}
              secureTextEntry style={styles.input} value={newPassword} />
            <TextInput accessibilityLabel="Confirm new password" autoCapitalize="none" autoComplete="new-password"
              onChangeText={setConfirmPassword} placeholder="Confirm new password" placeholderTextColor={colors.faint}
              secureTextEntry style={styles.input} value={confirmPassword} />
            {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
            <Pressable accessibilityRole="button"
              disabled={changing || !currentPassword || newPassword.length < 8 || !confirmPassword}
              onPress={() => void changePassword()}
              style={[styles.button, (changing || !currentPassword || newPassword.length < 8 || !confirmPassword) && styles.disabled]}>
              {changing ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.buttonText}>Change password</Text>}
            </Pressable>
          </View>
        ) : (
          <View style={styles.panel}>
            <Text style={styles.heading}>Password</Text>
            <Text style={styles.body}>
              {account.credentials.apple
                ? 'This account signs in with Apple and does not have a Pack One password to change.'
                : account.credentials.google
                  ? 'This account signs in with Google and does not have a Pack One password to change.'
                  : 'This account does not have a password to change.'}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg, alignSelf: 'center', width: '100%', maxWidth: 760 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 30, lineHeight: 35, fontWeight: '800' },
  heading: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, gap: spacing.md },
  method: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, color: colors.ink, paddingHorizontal: spacing.md, fontSize: 16 },
  button: { minHeight: 50, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  buttonText: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
  message: { color: colors.danger, fontSize: 14, lineHeight: 21 },
  disabled: { opacity: 0.42 },
});
