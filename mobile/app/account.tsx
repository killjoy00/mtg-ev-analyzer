import { useLocalSearchParams, router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  deleteMobileAccount,
  finishGoogleSignIn,
  linkMobileAccount,
  loadMobileAccount,
  signInWithEmail,
  signOutMobileAccount,
  signUpWithEmail,
  startGoogleDeletion,
  startGoogleSignIn,
} from '@/src/api/account';
import { isDailyEnvironment } from '@/src/api/draftRun';
import { ensureGuestSession } from '@/src/api/guest';
import { type MobileSession } from '@/src/storage/session';
import { colors, spacing } from '@/src/theme';

type Mode = 'signin' | 'signup';

export default function AccountScreen() {
  const params = useLocalSearchParams<{ claimToken?: string; environment?: string }>();
  const claimToken = typeof params.claimToken === 'string' ? params.claimToken : undefined;
  const requestedEnvironment = typeof params.environment === 'string' ? params.environment : 'mixed';
  const returnEnvironment = isDailyEnvironment(requestedEnvironment) ? requestedEnvironment : 'mixed';
  const [session, setSession] = useState<MobileSession | null>(null);
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [signedInLabel, setSignedInLabel] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [passwordDeletionSupported, setPasswordDeletionSupported] = useState(false);
  const [googleDeletionSupported, setGoogleDeletionSupported] = useState(false);

  useEffect(() => {
    let active = true;
    void ensureGuestSession()
      .then(async (current) => {
        if (!active) return;
        setSession(current);
        if (!current.accountToken) return;
        try {
          const account = await loadMobileAccount(current);
          if (!active || !account) return;
          setSignedInLabel(account.user.email ?? account.user.name ?? 'Pack One account');
          setPasswordDeletionSupported(account.deletion?.passwordSupported === true);
          setGoogleDeletionSupported(account.deletion?.googleSupported === true);
        } catch {
          // An expired account token leaves the player session intact; the form
          // below can establish a fresh account session.
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const finishAccount = async (
    current: MobileSession,
    account: Awaited<ReturnType<typeof signInWithEmail>>,
  ) => {
    const result = await linkMobileAccount(current, account, claimToken);
    setSession(result.session);
    setSignedInLabel(result.session.accountUser?.email ?? result.session.accountUser?.name ?? 'Pack One account');
    const accountState = await loadMobileAccount(result.session);
    setPasswordDeletionSupported(accountState?.deletion?.passwordSupported === true);
    setGoogleDeletionSupported(accountState?.deletion?.googleSupported === true);
    setMessage(result.linked.validatedDailyScore
      ? 'Score validated and added to today\'s leaderboard.'
      : 'Signed in to your Pack One account.');
    if (result.linked.validatedDailyScore) {
      setTimeout(() => router.replace({
        pathname: '/draft-run',
        params: { environment: returnEnvironment },
      }), 600);
    }
  };

  const openGoogleHandoff = async (url: string) => {
    const result = await WebBrowser.openAuthSessionAsync(url, 'packone://account');
    if (result.type !== 'success') {
      throw new Error(result.type === 'cancel' ? 'Google sign in was cancelled.' : 'Google sign in did not finish.');
    }
    const callback = new URL(result.url);
    const handoffToken = callback.searchParams.get('googleHandoff');
    if (!handoffToken || callback.searchParams.get('google') === 'error') {
      throw new Error('Google sign in did not finish. Please try again.');
    }
    return handoffToken;
  };

  const continueWithGoogle = async () => {
    if (!session || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const start = await startGoogleSignIn(session.playerToken);
      const handoffToken = await openGoogleHandoff(start.url);
      const googleAccount = await finishGoogleSignIn(session.playerToken, handoffToken);
      await finishAccount(session, googleAccount);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Google sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!session || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'signin') {
        const account = await signInWithEmail(session.playerToken, email.trim(), password);
        await finishAccount(session, account);
      } else {
        const account = await signUpWithEmail(session.playerToken, name.trim(), email.trim(), password);
        if (account.verificationRequired || !account.session?.token) {
          setMessage('Check your email to finish creating your Pack One account, then sign in here.');
          setMode('signin');
        } else {
          await finishAccount(session, account as Awaited<ReturnType<typeof signInWithEmail>>);
        }
      }
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Account request failed.');
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (!session || busy || !passwordDeletionSupported || !deletePassword) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteMobileAccount(session, { password: deletePassword });
      const fresh = await ensureGuestSession();
      setSession(fresh);
      setSignedInLabel(null);
      setDeletePassword('');
      setPasswordDeletionSupported(false);
      setGoogleDeletionSupported(false);
      setMessage('Your Pack One account and career were permanently deleted.');
      router.replace('/');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not delete your account.');
    } finally {
      setBusy(false);
    }
  };

  const deleteWithGoogle = async () => {
    if (!session || busy || !googleDeletionSupported) return;
    setBusy(true);
    setMessage(null);
    try {
      const start = await startGoogleDeletion(session);
      const handoffToken = await openGoogleHandoff(start.url);
      await deleteMobileAccount(session, { googleHandoff: handoffToken });
      const fresh = await ensureGuestSession();
      setSession(fresh);
      setSignedInLabel(null);
      setDeletePassword('');
      setPasswordDeletionSupported(false);
      setGoogleDeletionSupported(false);
      setMessage('Your Pack One account and career were permanently deleted.');
      router.replace('/');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not delete your account.');
    } finally {
      setBusy(false);
    }
  };

  const confirmGoogleDeletion = () => {
    Alert.alert(
      'Permanently delete Pack One account?',
      'This deletes your profile, career, scores, Draft Runs, challenges, provider links, and entitlements. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue with Google', style: 'destructive', onPress: () => void deleteWithGoogle() },
      ],
    );
  };

  const signOut = async () => {
    if (!session || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await signOutMobileAccount(session);
      const fresh = await ensureGuestSession();
      setSession(fresh);
      setSignedInLabel(null);
      setMessage('Signed out.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not sign out.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>PACK ONE ACCOUNT</Text>
        <Text style={styles.title}>{signedInLabel ? 'You’re signed in.' : 'One account everywhere.'}</Text>
        <Text style={styles.body}>
          {claimToken
            ? 'Sign in to validate this guest score and attach it to your existing Pack One career.'
            : 'Use the same Pack One account on web, iPhone, and Android.'}
        </Text>

        {busy && !session ? <ActivityIndicator color={colors.accent} /> : null}

        {signedInLabel ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{signedInLabel}</Text>
            <Text style={styles.body}>Your mobile player identity is linked to this Pack One account.</Text>
            <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Sign out</Text>
            </Pressable>
            <View style={styles.dangerZone}>
              <Text style={styles.dangerTitle}>Delete account</Text>
              <Text style={styles.body}>
                This permanently deletes your Pack One account, profile, career, scores, Draft Runs, challenges, provider links, and entitlements.
              </Text>
              {passwordDeletionSupported ? (
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
                    onPress={() => void deleteAccount()}
                    style={[styles.dangerButton, (busy || !deletePassword) && styles.disabled]}
                  >
                    <Text style={styles.dangerButtonText}>Permanently delete account</Text>
                  </Pressable>
                </>
              ) : googleDeletionSupported ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={confirmGoogleDeletion}
                  style={[styles.dangerButton, busy && styles.disabled]}
                >
                  <Text style={styles.dangerButtonText}>Reauthenticate with Google to delete</Text>
                </Pressable>
              ) : (
                <Text style={styles.providerDeleteNote}>
                  This provider cannot be reauthenticated for deletion in the app yet. Sign in with Apple support remains blocked on provider configuration.
                </Text>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.panel}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void continueWithGoogle()}
              style={[styles.googleButton, busy && styles.disabled]}
            >
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </Pressable>
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or use email</Text>
              <View style={styles.dividerLine} />
            </View>
            <View style={styles.modeRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setMode('signin')}
                style={[styles.modeButton, mode === 'signin' && styles.modeButtonActive]}
              >
                <Text style={[styles.modeText, mode === 'signin' && styles.modeTextActive]}>Sign in</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setMode('signup')}
                style={[styles.modeButton, mode === 'signup' && styles.modeButtonActive]}
              >
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
              onPress={() => void submit()}
              style={[styles.primaryButton, (busy || !email.trim() || !password || (mode === 'signup' && !name.trim())) && styles.disabled]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.primaryButtonText}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>
              )}
            </Pressable>
          </View>
        )}

        {message ? <Text style={styles.message}>{message}</Text> : null}

        <View style={styles.providerNote}>
          <Text style={styles.panelTitle}>Provider sign-in</Text>
          <Text style={styles.body}>
            Google uses the same Pack One account identity as web. Sign in with Apple will use this same account model once the Apple provider is configured.
          </Text>
        </View>
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
  secondaryButton: { minHeight: 48, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.42 },
  message: { color: colors.accentDark, fontSize: 14, lineHeight: 21, fontWeight: '700' },
  dangerZone: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.lg, gap: spacing.md },
  dangerTitle: { color: colors.danger, fontSize: 16, fontWeight: '800' },
  dangerButton: { minHeight: 50, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  dangerButtonText: { color: colors.danger, fontSize: 15, fontWeight: '800' },
  providerDeleteNote: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  providerNote: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.lg, gap: spacing.xs },
});
