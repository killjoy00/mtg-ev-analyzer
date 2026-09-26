import * as AppleAuthentication from 'expo-apple-authentication';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/src/api/client';
import {
  deleteMobileAccount,
  finishAppleDeletion,
  finishAppleSignIn,
  finishGoogleSignIn,
  finishNativeAppleSignIn,
  forgetAccountLocally,
  loadMobileAccount,
  signInWithEmail,
  signOutMobileAccount,
  signUpWithEmail,
  startAppleDeletionVerification,
  startAppleSignIn,
  startDeletionVerification,
  startGoogleSignIn,
  type AccountState,
  type MobileAuthResponse,
} from '@/src/api/account';
import { isDailyEnvironment } from '@/src/api/draftRun';
import { ensureGuestSession } from '@/src/api/guest';
import { type MobileSession } from '@/src/storage/session';
import { colors, spacing } from '@/src/theme';

WebBrowser.maybeCompleteAuthSession();

type Mode = 'signin' | 'signup';

function authResult(value: unknown): value is MobileAuthResponse {
  return Boolean(
    value
    && typeof value === 'object'
    && 'session' in value
    && 'linked' in value,
  );
}

export default function AccountScreen() {
  const params = useLocalSearchParams<{ validateDailyRunId?: string; environment?: string; returnTo?: string }>();
  const validateDailyRunId = typeof params.validateDailyRunId === 'string'
    ? params.validateDailyRunId
    : undefined;
  const requestedEnvironment = typeof params.environment === 'string' ? params.environment : 'mixed';
  const returnEnvironment = isDailyEnvironment(requestedEnvironment) ? requestedEnvironment : 'mixed';
  const returnToPractice = params.returnTo === 'practice';
  const [session, setSession] = useState<MobileSession | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteCode, setDeleteCode] = useState('');
  const [deleteCodeSent, setDeleteCodeSent] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void ensureGuestSession()
      .then(async (current) => {
        if (!active) return;
        setSession(current);
        if (!current.accountToken) return;
        try {
          const state = await loadMobileAccount(current);
          if (active) setAccount(state);
        } catch (error: unknown) {
          if (!active) return;
          if (error instanceof ApiError && error.status === 401) {
            const guest = await forgetAccountLocally(current);
            if (!active) return;
            setSession(guest);
            setAccount(null);
            setMessage('Your account session expired. Sign in again.');
          } else {
            setMessage(error instanceof Error ? error.message : 'Could not restore your account session.');
          }
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const finish = async (next: MobileSession, result: MobileAuthResponse) => {
    setSession(next);
    const state = await loadMobileAccount(next);
    setAccount(state);
    setPassword('');
    setMessage(
      result.linked.validatedDailyScore
        ? 'Signed in. Today\'s guest Daily was validated for this account.'
        : result.linked.rankingIdentity?.eligible === false
          ? 'Signed in. Choose a unique player name on Pack One before using ranked public identity.'
          : 'Signed in to your Pack One account.',
    );
    if (result.linked.validatedDailyScore) {
      setTimeout(() => router.replace({
        pathname: '/draft-run',
        params: { environment: returnEnvironment },
      }), 600);
    } else if (returnToPractice) {
      setTimeout(() => router.replace('/practice'), 300);
    }
  };

  const submitEmail = async () => {
    if (!session || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'signin') {
        const next = await signInWithEmail(session, email.trim(), password, validateDailyRunId);
        await finish(next.session, next.result);
      } else {
        const next = await signUpWithEmail(
          session,
          name.trim(),
          email.trim(),
          password,
          validateDailyRunId,
        );
        if (!next.session || !authResult(next.result)) {
          setMode('signin');
          setPassword('');
          setMessage('Check your email to verify the new Pack One account, then sign in here.');
        } else {
          await finish(next.session, next.result);
        }
      }
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Account request failed.');
    } finally {
      setBusy(false);
    }
  };

  const openGoogle = async () => {
    if (!session || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const start = await startGoogleSignIn(session);
      const result = await WebBrowser.openAuthSessionAsync(start.url, 'packone://account');
      if (result.type !== 'success') {
        throw new Error(result.type === 'cancel' ? 'Google sign in was cancelled.' : 'Google sign in did not finish.');
      }
      const callback = new URL(result.url);
      if (callback.searchParams.get('google') === 'error') throw new Error('Google sign in did not finish.');
      const handoff = callback.searchParams.get('googleHandoff');
      if (!handoff) throw new Error('Google sign in did not return a Pack One handoff.');
      const next = await finishGoogleSignIn(session, handoff, validateDailyRunId);
      await finish(next.session, next.result);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Google sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  const openApple = async () => {
    if (!session || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const start = await startAppleSignIn(session);
      if (Platform.OS === 'ios') {
        if (!await AppleAuthentication.isAvailableAsync()) {
          throw new Error('Sign in with Apple is not available on this device.');
        }
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
          state: start.flowToken,
          nonce: start.flowToken,
        });
        if (credential.state !== start.flowToken) throw new Error('Apple sign in could not be verified.');
        if (!credential.identityToken || !credential.authorizationCode) {
          throw new Error('Apple sign in did not return the required credentials.');
        }
        const next = await finishNativeAppleSignIn(session, {
          flowToken: start.flowToken,
          identityToken: credential.identityToken,
          authorizationCode: credential.authorizationCode,
          firstName: credential.fullName?.givenName ?? null,
          lastName: credential.fullName?.familyName ?? null,
        }, validateDailyRunId);
        await finish(next.session, next.result);
      } else {
        const result = await WebBrowser.openAuthSessionAsync(start.url, 'packone://account');
        if (result.type !== 'success') {
          throw new Error(result.type === 'cancel' ? 'Apple sign in was cancelled.' : 'Apple sign in did not finish.');
        }
        const callback = new URL(result.url);
        if (callback.searchParams.get('apple') === 'error') {
          const code = callback.searchParams.get('appleErrorCode');
          throw new Error(code === 'APPLE_EXISTING_ACCOUNT_UNVERIFIED'
            ? 'An unverified Pack One account already uses this email. Reset its password from that inbox, verify the account, then try Apple again.'
            : 'Apple sign in did not finish.');
        }
        const handoff = callback.searchParams.get('appleHandoff');
        if (!handoff) throw new Error('Apple sign in did not return a Pack One handoff.');
        const next = await finishAppleSignIn(session, handoff, validateDailyRunId);
        await finish(next.session, next.result);
      }
    } catch (error: unknown) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      setMessage(code === 'ERR_REQUEST_CANCELED'
        ? 'Apple sign in was cancelled.'
        : error instanceof Error ? error.message : 'Apple sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (!session || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await signOutMobileAccount(session);
      const fresh = await ensureGuestSession();
      setSession(fresh);
      setAccount(null);
      setMessage('Signed out.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not sign out.');
    } finally {
      setBusy(false);
    }
  };

  const sendDeleteCode = async () => {
    if (!session || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await startDeletionVerification(session);
      setDeleteCodeSent(true);
      setMessage(`Deletion code sent. It expires in about ${Math.ceil(result.expiresInSeconds / 60)} minutes.`);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not send a deletion code.');
    } finally {
      setBusy(false);
    }
  };

  const performDelete = async () => {
    if (!session || busy || !account?.deletion.method) return;
    setBusy(true);
    setMessage(null);
    try {
      if (account.deletion.method === 'apple') {
        const start = await startAppleDeletionVerification(session);
        const result = await WebBrowser.openAuthSessionAsync(start.url, 'packone://account');
        if (result.type !== 'success') {
          throw new Error(result.type === 'cancel' ? 'Apple verification was cancelled.' : 'Apple verification did not finish.');
        }
        const callback = new URL(result.url);
        if (callback.searchParams.get('appleDelete') === 'error') {
          throw new Error('Apple verification did not finish.');
        }
        const handoff = callback.searchParams.get('appleDeleteHandoff');
        if (!handoff) throw new Error('Apple verification did not return a deletion proof.');
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
      setSession(fresh);
      setAccount(null);
      setDeletePassword('');
      setDeleteCode('');
      setDeleteCodeSent(false);
      router.replace('/');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not delete the account.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Permanently delete Pack One account?',
      'This deletes your Pack One account, profile, career, scores, Draft Runs, provider links, and entitlements. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete permanently', style: 'destructive', onPress: () => void performDelete() },
      ],
    );
  };

  const signedInLabel = account?.user.email ?? account?.user.name ?? 'Pack One account';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>PACK ONE ACCOUNT</Text>
        <Text style={styles.title}>{account ? 'One account everywhere.' : 'Sign in to Pack One.'}</Text>
        <Text style={styles.body}>
          {validateDailyRunId
            ? 'Sign in to attach this device to your Pack One career and validate today\'s completed guest Daily when eligible.'
            : 'Use the same Pack One identity across web, iPhone, and Android.'}
        </Text>

        {busy && !session ? <ActivityIndicator color={colors.accent} /> : null}

        {account ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{signedInLabel}</Text>
            <Text style={styles.body}>This device has a revocable Pack One account session stored in the platform secure store.</Text>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void signOut()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Sign out</Text>
            </Pressable>

            <View style={styles.dangerZone}>
              <Text style={styles.dangerTitle}>Delete account</Text>
              <Text style={styles.body}>Deletion uses the same permanent, tombstoned Pack One deletion system as the website.</Text>

              {!account.deletion.enabled ? (
                <Text style={styles.body}>Account deletion is temporarily unavailable.</Text>
              ) : account.deletion.method === 'password' ? (
                <>
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
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy || !deletePassword}
                    onPress={confirmDelete}
                    style={[styles.dangerButton, (busy || !deletePassword) && styles.disabled]}
                  >
                    <Text style={styles.dangerButtonText}>Permanently delete account</Text>
                  </Pressable>
                </>
              ) : account.deletion.method === 'apple' ? (
                <>
                  <Text style={styles.body}>Verify with Apple again to confirm permanent deletion. No email code is required.</Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={confirmDelete}
                    style={[styles.dangerButton, busy && styles.disabled]}
                  >
                    <Text style={styles.dangerButtonText}>Verify with Apple and delete account</Text>
                  </Pressable>
                </>
              ) : account.deletion.method === 'email' ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void sendDeleteCode()}
                    style={[styles.secondaryButton, busy && styles.disabled]}
                  >
                    <Text style={styles.secondaryButtonText}>{deleteCodeSent ? 'Send a new deletion code' : 'Email me a deletion code'}</Text>
                  </Pressable>
                  {deleteCodeSent ? (
                    <>
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
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy || !/^\d{8}$/.test(deleteCode)}
                        onPress={confirmDelete}
                        style={[styles.dangerButton, (busy || !/^\d{8}$/.test(deleteCode)) && styles.disabled]}
                      >
                        <Text style={styles.dangerButtonText}>Permanently delete account</Text>
                      </Pressable>
                    </>
                  ) : null}
                </>
              ) : (
                <Text style={styles.body}>A verified account email is required before this account can be deleted.</Text>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.panel}>
            {Platform.OS === 'ios' ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                cornerRadius={6}
                onPress={() => void openApple()}
                style={[styles.appleButton, busy && styles.disabled]}
              />
            ) : (
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void openApple()} style={[styles.appleWebButton, busy && styles.disabled]}>
                <Text style={styles.appleWebButtonText}>Continue with Apple</Text>
              </Pressable>
            )}

            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void openGoogle()} style={[styles.googleButton, busy && styles.disabled]}>
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or use email</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.modeRow}>
              <Pressable accessibilityRole="button" onPress={() => setMode('signin')} style={[styles.modeButton, mode === 'signin' && styles.modeButtonActive]}>
                <Text style={[styles.modeText, mode === 'signin' && styles.modeTextActive]}>Sign in</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setMode('signup')} style={[styles.modeButton, mode === 'signup' && styles.modeButtonActive]}>
                <Text style={[styles.modeText, mode === 'signup' && styles.modeTextActive]}>Create account</Text>
              </Pressable>
            </View>

            {mode === 'signup' ? (
              <TextInput
                accessibilityLabel="Name"
                autoCapitalize="words"
                autoComplete="name"
                onChangeText={setName}
                placeholder="Name"
                placeholderTextColor={colors.faint}
                style={styles.input}
                value={name}
              />
            ) : null}
            <TextInput
              accessibilityLabel="Email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={colors.faint}
              style={styles.input}
              value={email}
            />
            <TextInput
              accessibilityLabel="Password"
              autoCapitalize="none"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.faint}
              secureTextEntry
              style={styles.input}
              value={password}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy || !email.trim() || !password || (mode === 'signup' && !name.trim())}
              onPress={() => void submitEmail()}
              style={[styles.primaryButton, (busy || !email.trim() || !password || (mode === 'signup' && !name.trim())) && styles.disabled]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.primaryButtonText}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>
              )}
            </Pressable>
          </View>
        )}

        {message ? <Text style={styles.message}>{message}</Text> : null}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 34, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, gap: spacing.md },
  panelTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  appleButton: { width: '100%', height: 52 },
  appleWebButton: { minHeight: 52, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  appleWebButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  googleButton: { minHeight: 52, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  googleButtonText: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.line },
  dividerText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  modeRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line },
  modeButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  modeButtonActive: { borderBottomWidth: 3, borderColor: colors.accent },
  modeText: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  modeTextActive: { color: colors.ink },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    color: colors.ink,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  primaryButton: { minHeight: 52, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  secondaryButton: { minHeight: 48, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryButtonText: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.42 },
  message: { color: colors.accentDark, fontSize: 14, lineHeight: 21, fontWeight: '700' },
  dangerZone: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.lg, gap: spacing.md },
  dangerTitle: { color: colors.danger, fontSize: 16, fontWeight: '800' },
  dangerButton: { minHeight: 50, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  dangerButtonText: { color: colors.danger, fontSize: 15, fontWeight: '800' },
});
