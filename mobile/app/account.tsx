import * as AppleAuthentication from 'expo-apple-authentication';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Text } from '@/src/components/Text';
import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';
import { AboutLink } from '@/src/components/AboutLink';

import { ApiError } from '@/src/api/client';
import {
  finishAppleSignIn,
  finishGoogleSignIn,
  finishNativeAppleSignIn,
  linkMobileAccount,
  requestMobilePasswordReset,
  requestMobileVerificationEmail,
  signInWithEmail,
  signOutMobileAccount,
  signUpWithEmail,
  startAppleSignIn,
  startGoogleSignIn,
  type MobileAuthResponse,
} from '@/src/api/account';
import { updateMobileProfile } from '@/src/api/career';
import { isDailyEnvironment } from '@/src/api/draftRun';
import { ensureGuestSession } from '@/src/api/guest';
import { useAccountState } from '@/src/hooks/useAccountState';
import { colors, spacing } from '@/src/theme';

WebBrowser.maybeCompleteAuthSession();

type Mode = 'signin' | 'signup';
type PendingAction = 'report' | 'block' | undefined;

function authResult(value: unknown): value is MobileAuthResponse {
  return Boolean(
    value
    && typeof value === 'object'
    && 'session' in value
    && 'linked' in value,
  );
}

function unverified(error: unknown) {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== 'object') return false;
  return 'code' in error.body && error.body.code === 'EMAIL_NOT_VERIFIED';
}

function displayNameReasonMessage(reason?: string | null) {
  if (reason === 'name_not_allowed') return 'That display name is not allowed. Choose another to join Daily leaderboards.';
  if (reason === 'username_taken') return 'Choose a different display name. That one is already taken.';
  return null;
}

export default function AccountScreen() {
  const params = useLocalSearchParams<{
    validateDailyRunId?: string;
    environment?: string;
    returnTo?: string;
    shared?: string;
    creator?: string;
    profileKey?: string;
    pendingAction?: string;
    reportReason?: string;
    notice?: string;
    emailVerified?: string;
  }>();
  const validateDailyRunId = typeof params.validateDailyRunId === 'string'
    ? params.validateDailyRunId
    : undefined;
  const requestedEnvironment = typeof params.environment === 'string' ? params.environment : 'mixed';
  const returnEnvironment = isDailyEnvironment(requestedEnvironment) ? requestedEnvironment : 'mixed';
  const returnToPractice = params.returnTo === 'practice';
  const returnShared = params.returnTo === 'shared' && typeof params.shared === 'string' && /^[a-f0-9]{24}$/.test(params.shared) ? params.shared : null;
  const returnCreator = params.returnTo === 'creator' && typeof params.creator === 'string' && /^(?:[a-f0-9-]{36}|[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)$/.test(params.creator) ? params.creator : null;
  const returnSharedRecovery = params.returnTo === 'shared-recovery';
  const returnProfileKey = typeof params.profileKey === 'string' && /^[a-f0-9]{16}$/.test(params.profileKey)
    ? params.profileKey
    : null;
  const pendingAction: PendingAction = params.pendingAction === 'report' || params.pendingAction === 'block'
    ? params.pendingAction
    : undefined;
  const reportReason = typeof params.reportReason === 'string' ? params.reportReason : undefined;
  const routeNotice = typeof params.notice === 'string' ? params.notice : null;

  const {
    session,
    account,
    busy,
    message,
    enrichmentWarning,
    setMessage,
    adoptSession,
    clearAccount,
  } = useAccountState();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationPending, setVerificationPending] = useState(false);
  const [signinNeedsVerification, setSigninNeedsVerification] = useState(false);
  const [promptDisplayName, setPromptDisplayName] = useState(false);
  const [pendingClaimValidatedDaily, setPendingClaimValidatedDaily] = useState(false);
  const [readyInitialName, setReadyInitialName] = useState('');
  const [readyDisplayName, setReadyDisplayName] = useState('');
  const [readyError, setReadyError] = useState<string | null>(null);
  const [readyNameOptionalHint, setReadyNameOptionalHint] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const verificationReturnHandled = useRef(false);

  const returnAfterAccount = useCallback((fallbackToCareer = false) => {
    if (returnShared) {
      router.dismissTo({ pathname: '/shared-run', params: { shared: returnShared } });
      return;
    }
    if (returnCreator) {
      router.dismissTo({ pathname: '/creator-run', params: { creator: returnCreator } });
      return;
    }
    if (returnSharedRecovery) {
      router.dismissTo('/resume-shared-run');
      return;
    }
    if (validateDailyRunId) {
      router.dismissTo({
        pathname: '/draft-run',
        params: { environment: returnEnvironment },
      });
      return;
    }
    if (returnToPractice) {
      router.dismissTo('/practice');
      return;
    }
    if (returnProfileKey) {
      router.dismissTo({
        pathname: '/profile',
        params: {
          key: returnProfileKey,
          ...(pendingAction ? { pendingAction } : {}),
          ...(reportReason ? { reportReason } : {}),
        },
      });
      return;
    }
    if (fallbackToCareer) router.dismissTo('/career');
  }, [validateDailyRunId, returnEnvironment, returnToPractice, returnShared, returnCreator, returnSharedRecovery, returnProfileKey, pendingAction, reportReason]);

  const continueAfterDisplayNamePrompt = useCallback((validatedDailyScore = pendingClaimValidatedDaily) => {
    setPromptDisplayName(false);
    setPendingClaimValidatedDaily(false);
    returnAfterAccount(true);
    return validatedDailyScore;
  }, [pendingClaimValidatedDaily, returnAfterAccount]);

  const finish = useCallback(async (next: Parameters<typeof adoptSession>[0], result: MobileAuthResponse) => {
    setPassword('');
    setSigninNeedsVerification(false);
    const newlyClaimed = result.linked.newlyClaimed === true;
    if (newlyClaimed) {
      const displayNameReason = result.linked.rankingIdentity?.reason;
      const initialDisplayName = displayNameReason === 'username_required' ? '' : (result.linked.displayName || '');
      setReadyInitialName(initialDisplayName);
      setReadyDisplayName(initialDisplayName);
      setReadyError(displayNameReasonMessage(displayNameReason));
      setReadyNameOptionalHint(displayNameReason === 'username_required');
      setPromptDisplayName(true);
      setPendingClaimValidatedDaily(Boolean(result.linked.validatedDailyScore));
      setMessage(null);
    } else {
      setMessage(result.linked.validatedDailyScore
        ? 'Signed in. Today\'s guest Daily was validated for this account.'
        : result.linked.rankingIdentity?.eligible === false
          ? 'Signed in. Choose an available display name in Profile & visibility before joining Daily leaderboards.'
          : 'Signed in to your Pack One account.');
    }
    await adoptSession(next);
    if (!newlyClaimed) {
      returnAfterAccount(true);
    }
  }, [adoptSession, returnAfterAccount, setMessage]);

  const submitEmail = async () => {
    if (!session || actionBusy) return;
    setActionBusy(true);
    setMessage(null);
    setSigninNeedsVerification(false);
    try {
      if (mode === 'signin') {
        const next = await signInWithEmail(session, email.trim(), password, validateDailyRunId);
        await finish(next.session, next.result);
      } else {
        const next = await signUpWithEmail(session, email.trim(), password, validateDailyRunId);
        if (!next.session || !authResult(next.result)) {
          setVerificationPending(true);
        } else {
          await finish(next.session, next.result);
        }
      }
    } catch (error: unknown) {
      if (mode === 'signin' && unverified(error)) setSigninNeedsVerification(true);
      setMessage(error instanceof Error ? error.message : 'Account request failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const openGoogle = async () => {
    if (!session || actionBusy) return;
    setActionBusy(true);
    setMessage(null);
    try {
      const start = await startGoogleSignIn(session);
      const result = await WebBrowser.openAuthSessionAsync(start.url, 'packone://account');
      if (result.type !== 'success') {
        throw new Error(result.type === 'cancel' ? 'Google sign in was cancelled.' : 'Google sign in did not finish. Please try again.');
      }
      const callback = new URL(result.url);
      if (callback.searchParams.get('google') === 'error') throw new Error('Google sign in did not finish. Please try again.');
      const handoff = callback.searchParams.get('googleHandoff');
      if (!handoff) throw new Error('Google sign in did not finish. Please try again.');
      const next = await finishGoogleSignIn(session, handoff, validateDailyRunId);
      await finish(next.session, next.result);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Google sign in failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const openApple = async () => {
    if (!session || actionBusy) return;
    setActionBusy(true);
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
          throw new Error('Apple sign in did not return the required information.');
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
          throw new Error(result.type === 'cancel' ? 'Apple sign in was cancelled.' : 'Apple sign in did not finish. Please try again.');
        }
        const callback = new URL(result.url);
        if (callback.searchParams.get('apple') === 'error') {
          const code = callback.searchParams.get('appleErrorCode');
          throw new Error(code === 'APPLE_EXISTING_ACCOUNT_UNVERIFIED'
            ? 'An unverified Pack One account already uses this email. Reset its password from that inbox, then try Apple again.'
            : 'Apple sign in did not finish. Please try again.');
        }
        const handoff = callback.searchParams.get('appleHandoff');
        if (!handoff) throw new Error('Apple sign in did not finish. Please try again.');
        const next = await finishAppleSignIn(session, handoff, validateDailyRunId);
        await finish(next.session, next.result);
      }
    } catch (error: unknown) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      setMessage(code === 'ERR_REQUEST_CANCELED'
        ? 'Apple sign in was cancelled.'
        : error instanceof Error ? error.message : 'Apple sign in failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const signOut = async () => {
    if (!session || actionBusy) return;
    setActionBusy(true);
    setMessage(null);
    try {
      await signOutMobileAccount(session);
      const fresh = await ensureGuestSession();
      clearAccount(fresh);
      setPromptDisplayName(false);
      setPendingClaimValidatedDaily(false);
      setMessage('Signed out.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not sign out.');
    } finally {
      setActionBusy(false);
    }
  };

  const forgotPassword = async () => {
    if (!session || actionBusy) return;
    if (!email.trim()) {
      setMessage('Enter your account email first.');
      return;
    }
    setActionBusy(true);
    setMessage(null);
    try {
      const result = await requestMobilePasswordReset(session, email.trim());
      setMessage(result.message);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Password recovery is temporarily unavailable.');
    } finally {
      setActionBusy(false);
    }
  };

  const resendVerification = async () => {
    if (!session || actionBusy || !email.trim()) return;
    setActionBusy(true);
    setMessage(null);
    try {
      const result = await requestMobileVerificationEmail(session, email.trim());
      setMessage(result.message);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Email verification is temporarily unavailable.');
    } finally {
      setActionBusy(false);
    }
  };

  const saveReadyDisplayName = async () => {
    if (!session?.accountToken || actionBusy) return;
    const nextName = readyDisplayName.trim();
    if (nextName === readyInitialName.trim()) {
      continueAfterDisplayNamePrompt();
      return;
    }
    if (nextName.length < 2) {
      setReadyError('Display name must be 2-24 characters.');
      return;
    }
    setActionBusy(true);
    setReadyError(null);
    try {
      const updated = await updateMobileProfile(session, {
        displayName: nextName,
        acceptPublicIdentityTerms: true,
      });
      if (updated.player.username_owned === false) {
        setReadyError(updated.player.display_name_reason === 'name_not_allowed'
          ? 'That display name is not allowed. Choose another to join Daily leaderboards.'
          : 'Choose a different display name. That one is already taken.');
        return;
      }
      let validatedDailyScore = pendingClaimValidatedDaily;
      if (validateDailyRunId && !validatedDailyScore) {
        const linked = await linkMobileAccount(session, validateDailyRunId);
        validatedDailyScore = Boolean(linked.validatedDailyScore);
      }
      continueAfterDisplayNamePrompt(validatedDailyScore);
    } catch (error: unknown) {
      setReadyError(error instanceof Error ? error.message : 'Could not save your display name.');
    } finally {
      setActionBusy(false);
    }
  };

  useEffect(() => {
    if (params.emailVerified !== '1' || account || busy || verificationReturnHandled.current) return;
    verificationReturnHandled.current = true;
    void (async () => {
      await Promise.resolve();
      if (verificationPending && session && email.trim() && password) {
        setActionBusy(true);
        setMessage('Email verified. Finishing your account…');
        try {
          const next = await signInWithEmail(session, email.trim(), password, validateDailyRunId);
          await finish(next.session, next.result);
        } catch (error: unknown) {
          setVerificationPending(false);
          setMode('signin');
          setMessage(error instanceof Error
            ? `Email verified. ${error.message}`
            : 'Email verified. Sign in to finish setting up your account.');
        } finally {
          setActionBusy(false);
        }
        return;
      }
      setVerificationPending(false);
      setMode('signin');
      setMessage('Email verified. Sign in to finish setting up your account on this device.');
    })();
  }, [params.emailVerified, account, busy, verificationPending, session, email, password, validateDailyRunId, finish, setMessage]);

  const signedInLabel = account?.user.email ?? account?.user.name ?? 'Pack One account';
  const disabled = actionBusy || busy;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
        <Text style={styles.eyebrow}>PACK ONE ACCOUNT</Text>

        {busy && !session ? <ActivityIndicator color={colors.accent} /> : null}

        {account && promptDisplayName ? (
          <>
            <Text style={styles.title}>Your account is ready.</Text>
            <Text style={styles.body}>Your progress is saved across devices.</Text>
            <View style={styles.panel}>
              <Text style={styles.fieldLabel}>Display name</Text>
              <TextInput
                accessibilityLabel="Display name"
                autoCapitalize="words"
                autoComplete="nickname"
                maxLength={24}
                onChangeText={(value) => {
                  setReadyDisplayName(value);
                  if (value.trim() !== readyInitialName.trim()) setReadyError(null);
                }}
                placeholder="Display name"
                placeholderTextColor={colors.faint}
                style={styles.input}
                value={readyDisplayName}
              />
              <Text style={styles.fieldHelp}>Shown on Daily leaderboards and your public profile.</Text>
              {readyNameOptionalHint ? (
                <Text style={styles.fieldHelp}>Optional. Choose a display name if you want to join Daily leaderboards.</Text>
              ) : null}
              <View style={styles.termsBox}>
                <Text style={styles.fieldHelp}>Display names and public profiles follow the Pack One Public Identity rules.</Text>
                <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync('https://packone.pro/terms/#public-identity-rules')}>
                  <Text style={styles.linkText}>Public Identity rules</Text>
                </Pressable>
              </View>
              {readyError ? <Text accessibilityRole="alert" style={styles.error}>{readyError}</Text> : null}
              <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void saveReadyDisplayName()}
                style={[styles.primaryButton, disabled && styles.disabled]}>
                {actionBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Continue</Text>}
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Skip display name for now" disabled={disabled}
                onPress={() => continueAfterDisplayNamePrompt()} style={styles.textButton}>
                <Text style={styles.textButtonText}>Skip for now</Text>
              </Pressable>
            </View>
          </>
        ) : account ? (
          <>
            <Text style={styles.title}>Account</Text>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>{signedInLabel}</Text>
              <Text style={styles.body}>You&apos;re signed in on this device. Your Pack One progress syncs with this account.</Text>

              <Pressable accessibilityRole="button" onPress={() => router.push('/account-profile')} style={styles.row}>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>Profile &amp; visibility</Text>
                  <Text style={styles.fieldHelp}>Display name, public profile and profile preferences</Text>
                </View>
                <Text style={styles.rowArrow}>›</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => router.push('/membership')} style={styles.row}>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>Membership</Text>
                  <Text style={styles.fieldHelp}>Elite access from Apple or Patreon</Text>
                </View>
                <Text style={styles.rowArrow}>›</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => router.push('/account-security')} style={styles.row}>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>Sign-in &amp; security</Text>
                  <Text style={styles.fieldHelp}>Sign-in methods and password</Text>
                </View>
                <Text style={styles.rowArrow}>›</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => router.push('/account-delete')} style={[styles.row, styles.dangerRow]}>
                <View style={styles.rowCopy}>
                  <Text style={styles.dangerTitle}>Delete account</Text>
                  <Text style={styles.fieldHelp}>Permanently remove your Pack One account</Text>
                </View>
                <Text style={[styles.rowArrow, styles.dangerTitle]}>›</Text>
              </Pressable>

              <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void signOut()} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Sign out</Text>
              </Pressable>
            </View>
          </>
        ) : verificationPending ? (
          <>
            <Text style={styles.title}>Check your email</Text>
            <View style={styles.panel}>
              <Text style={styles.body}>We sent a verification link to {email.trim()}. Open it to finish creating your Pack One account. Links expire after 15 minutes.</Text>
              <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void resendVerification()} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Send a new verification link</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={disabled} onPress={() => {
                setVerificationPending(false);
                setMode('signin');
                setMessage(null);
              }} style={styles.textButton}>
                <Text style={styles.textButtonText}>Back to sign in</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.title}>{mode === 'signup' ? 'Create your Pack One account.' : 'Sign in to Pack One.'}</Text>
            <Text style={styles.body}>
              {validateDailyRunId
                ? 'Sign in to save this Daily score to your Pack One career and add it to the leaderboard when eligible.'
                : 'Use the same Pack One account across web, iPhone, iPad, and Android.'}
            </Text>
            <View style={styles.panel}>
              {Platform.OS === 'ios' ? (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  buttonType={mode === 'signup'
                    ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
                    : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  cornerRadius={6}
                  onPress={() => void openApple()}
                  style={[styles.appleButton, disabled && styles.disabled]}
                />
              ) : (
                <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void openApple()} style={[styles.appleWebButton, disabled && styles.disabled]}>
                  <Text style={styles.appleWebButtonText}>{mode === 'signup' ? 'Create with Apple' : 'Sign in with Apple'}</Text>
                </Pressable>
              )}

              <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void openGoogle()} style={[styles.googleButton, disabled && styles.disabled]}>
                <Text style={styles.googleButtonText}>{mode === 'signup' ? 'Create with Google' : 'Sign in with Google'}</Text>
              </Pressable>

              {mode === 'signup' ? (
                <View style={styles.termsBox}>
                  <Text style={styles.fieldHelp}>By creating an account, you agree to the Pack One Terms.</Text>
                  <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync('https://packone.pro/terms/')}>
                    <Text style={styles.linkText}>Pack One Terms</Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              <View style={styles.modeRow}>
                <Pressable accessibilityRole="button" onPress={() => { setMode('signin'); setSigninNeedsVerification(false); }}
                  style={[styles.modeButton, mode === 'signin' && styles.modeButtonActive]}>
                  <Text style={[styles.modeText, mode === 'signin' && styles.modeTextActive]}>Sign in</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => { setMode('signup'); setSigninNeedsVerification(false); }}
                  style={[styles.modeButton, mode === 'signup' && styles.modeButtonActive]}>
                  <Text style={[styles.modeText, mode === 'signup' && styles.modeTextActive]}>Create account</Text>
                </Pressable>
              </View>

              <TextInput
                accessibilityLabel="Email"
                autoCapitalize="none"
                autoComplete="username"
                keyboardType="email-address"
                onChangeText={(value) => { setEmail(value); setSigninNeedsVerification(false); }}
                placeholder="Email"
                placeholderTextColor={colors.faint}
                style={styles.input}
                textContentType={Platform.OS === 'ios' ? 'username' : undefined}
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
              <Pressable accessibilityRole="button" disabled={disabled || !email.trim() || !password}
                accessibilityLabel={mode === 'signin' ? 'Sign in with email' : 'Create account with email'}
                onPress={() => void submitEmail()}
                style={[styles.primaryButton, (disabled || !email.trim() || !password) && styles.disabled]}>
                {actionBusy ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.primaryButtonText}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>
                )}
              </Pressable>
              {mode === 'signin' ? (
                <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void forgotPassword()} style={styles.textButton}>
                  <Text style={styles.textButtonText}>Forgot password?</Text>
                </Pressable>
              ) : null}
              {signinNeedsVerification ? (
                <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void resendVerification()} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Send a new verification link</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        )}

        {message || routeNotice ? <Text accessibilityRole="alert" style={styles.message}>{message || routeNotice}</Text> : null}
        {enrichmentWarning ? <Text accessibilityRole="alert" style={styles.enrichmentWarning}>{enrichmentWarning}</Text> : null}
        <AboutLink />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg, alignSelf: 'center', width: '100%', maxWidth: 760 },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
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
  dividerText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
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
  error: { color: colors.danger, fontSize: 14, lineHeight: 21, fontWeight: '700' },
  enrichmentWarning: { color: colors.muted, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  fieldHelp: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  termsBox: { gap: spacing.sm },
  linkText: { color: colors.accentDark, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  textButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  textButtonText: { color: colors.accentDark, fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' },
  row: { minHeight: 68, borderTopWidth: 1, borderColor: colors.line, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowCopy: { flex: 1, gap: 4 },
  rowTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  rowArrow: { color: colors.muted, fontSize: 26, lineHeight: 30 },
  dangerRow: { marginTop: spacing.sm },
  dangerTitle: { color: colors.danger, fontSize: 16, fontWeight: '800' },
});
