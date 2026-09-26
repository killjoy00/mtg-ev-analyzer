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
  changeMobilePassword,
  deleteMobileAccount,
  finishAppleDeletion,
  finishAppleSignIn,
  finishGoogleSignIn,
  finishNativeAppleSignIn,
  forgetAccountLocally,
  loadMobileAccount,
  requestMobilePasswordReset,
  requestMobileVerificationEmail,
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
import {
  loadMobileCareer,
  updateMobileProfile,
  type CareerProfile,
} from '@/src/api/career';
import {
  isDailyEnvironment,
  loadSetCatalog,
  type PracticeSet,
} from '@/src/api/draftRun';
import { ensureGuestSession } from '@/src/api/guest';
import {
  disconnectMobilePatreon,
  isElitePatreon,
  loadMobilePatreonStatus,
  startMobilePatreonConnect,
  type PatreonStatus,
} from '@/src/api/patreon';
import { useAppResume } from '@/src/hooks/useAppResume';
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
  const params = useLocalSearchParams<{ validateDailyRunId?: string; environment?: string; returnTo?: string; shared?: string }>();
  const validateDailyRunId = typeof params.validateDailyRunId === 'string'
    ? params.validateDailyRunId
    : undefined;
  const requestedEnvironment = typeof params.environment === 'string' ? params.environment : 'mixed';
  const returnEnvironment = isDailyEnvironment(requestedEnvironment) ? requestedEnvironment : 'mixed';
  const returnToPractice = params.returnTo === 'practice';
  const returnShared = typeof params.shared === 'string' && /^[a-f0-9]{24}$/.test(params.shared) ? params.shared : '';
  const returnToChallenge = params.returnTo === 'challenge' && Boolean(returnShared);
  const [session, setSession] = useState<MobileSession | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [profile, setProfile] = useState<CareerProfile | null>(null);
  const [catalogSets, setCatalogSets] = useState<PracticeSet[]>([]);
  const [patreon, setPatreon] = useState<PatreonStatus | null>(null);
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profilePublic, setProfilePublic] = useState(false);
  const [favoriteSetId, setFavoriteSetId] = useState('');
  const [showcaseAchievement, setShowcaseAchievement] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteCode, setDeleteCode] = useState('');
  const [deleteCodeSent, setDeleteCodeSent] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const applyProfile = (next: CareerProfile | null) => {
    setProfile(next);
    setProfileName(next?.player.display_name ?? '');
    setProfilePublic(Boolean(next?.player.profile_public));
    setFavoriteSetId(next?.player.favorite_set_id ?? '');
    setShowcaseAchievement(next?.player.showcase_achievement ?? '');
  };

  const refreshPatreon = async (current: MobileSession | null = session) => {
    if (!current?.accountToken) {
      setPatreon(null);
      return;
    }
    try {
      setPatreon(await loadMobilePatreonStatus(current));
    } catch {
      // Membership status is enrichment. Practice capability checks remain
      // independently server-authoritative even if this panel cannot refresh.
    }
  };

  useAppResume(() => refreshPatreon());

  useEffect(() => {
    let active = true;
    void ensureGuestSession()
      .then(async (current) => {
        if (!active) return;
        setSession(current);
        if (!current.accountToken) return;
        try {
          const [state, nextProfile, catalog, membership] = await Promise.all([
            loadMobileAccount(current),
            loadMobileCareer(current),
            loadSetCatalog(current),
            loadMobilePatreonStatus(current).catch(() => null),
          ]);
          if (active) {
            setAccount(state);
            applyProfile(nextProfile);
            setCatalogSets(catalog.sets);
            setPatreon(membership);
          }
        } catch (error: unknown) {
          if (!active) return;
          if (error instanceof ApiError && error.status === 401) {
            const guest = await forgetAccountLocally(current);
            if (!active) return;
            setSession(guest);
            setAccount(null);
            applyProfile(null);
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
    const [state, nextProfile, catalog, membership] = await Promise.all([
      loadMobileAccount(next),
      loadMobileCareer(next),
      loadSetCatalog(next),
      loadMobilePatreonStatus(next).catch(() => null),
    ]);
    setAccount(state);
    applyProfile(nextProfile);
    setCatalogSets(catalog.sets);
    setPatreon(membership);
    setPassword('');
    setMessage(
      result.linked.validatedDailyScore
        ? 'Signed in. Today\'s guest Daily was validated for this account.'
        : result.linked.rankingIdentity?.eligible === false
          ? 'Signed in. Choose a unique leaderboard name below before using ranked public identity.'
          : 'Signed in to your Pack One account.',
    );
    if (result.linked.validatedDailyScore) {
      setTimeout(() => router.replace({
        pathname: '/draft-run',
        params: { environment: returnEnvironment },
      }), 600);
    } else if (returnToChallenge) {
      setTimeout(() => router.replace({
        pathname: '/draft-run',
        params: { shared: returnShared },
      }), 300);
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
      applyProfile(null);
      setCatalogSets([]);
      setPatreon(null);
      setMessage('Signed out.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not sign out.');
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async () => {
    if (!session?.accountToken || busy || !profile) return;
    setBusy(true);
    setMessage(null);
    try {
      const updated = await updateMobileProfile(session, {
        displayName: profileName.trim(),
        profilePublic,
        favoriteSetId: favoriteSetId || null,
        showcaseAchievement: showcaseAchievement || null,
      });
      applyProfile(updated);
      setMessage(updated.player.username_owned === false
        ? 'Profile saved. Choose a different unique leaderboard name to become rank-eligible.'
        : 'Profile settings saved.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not save profile settings.');
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    if (!session || busy) return;
    if (!email.trim()) {
      setMessage('Enter your account email first.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await requestMobilePasswordReset(session, email.trim());
      setMessage(result.message);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Password recovery is temporarily unavailable.');
    } finally {
      setBusy(false);
    }
  };

  const resendVerification = async () => {
    if (!session || busy) return;
    if (!email.trim()) {
      setMessage('Enter your account email first.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await requestMobileVerificationEmail(session, email.trim());
      setMessage(result.message);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Email verification is temporarily unavailable.');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if (!session?.accountToken || busy || !account?.credentials.password) return;
    if (newPassword !== confirmPassword) {
      setMessage('New passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setMessage('New password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await changeMobilePassword(session, currentPassword, newPassword);
      const guest = await forgetAccountLocally(session);
      setSession(guest);
      setAccount(null);
      applyProfile(null);
      setCatalogSets([]);
      setPatreon(null);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPassword('');
      setMessage('Password changed. Pack One signed out every account session; sign in again with your new password.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  };

  const connectPatreon = async () => {
    if (!session?.accountToken || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const start = await startMobilePatreonConnect(session);
      setMessage('Patreon opened in your browser. Finish connecting there, then return to Pack One.');
      await WebBrowser.openBrowserAsync(start.url);
      await refreshPatreon(session);
      setMessage('Patreon membership status refreshed.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not connect Patreon.');
    } finally {
      setBusy(false);
    }
  };

  const disconnectPatreon = async () => {
    if (!session?.accountToken || busy || !patreon?.connected) return;
    setBusy(true);
    setMessage(null);
    try {
      await disconnectMobilePatreon(session);
      await refreshPatreon(session);
      setMessage('Patreon disconnected. Patreon-provided Elite access was removed.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Could not disconnect Patreon.');
    } finally {
      setBusy(false);
    }
  };

  const confirmPatreonDisconnect = () => {
    Alert.alert(
      'Disconnect Patreon?',
      'This removes Patreon-provided Elite access from Pack One until you connect Patreon again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => void disconnectPatreon() },
      ],
    );
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
      applyProfile(null);
      setCatalogSets([]);
      setPatreon(null);
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
  const favoriteOptions = [...catalogSets].sort((a, b) => (
    String(b.release_date ?? '').localeCompare(String(a.release_date ?? ''))
      || a.set_name.localeCompare(b.set_name)
  ));
  const unlockedAchievements = (profile?.achievements ?? []).filter((item) => item.unlocked);
  const elite = isElitePatreon(patreon);
  const membershipTitle = patreon?.configured === false
    ? 'Membership status unavailable'
    : elite
      ? 'Elite Member'
      : patreon?.connected
        ? 'Patreon connected'
        : 'Free member';

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

            {profile ? (
              <View style={styles.settingsSection}>
                <Text style={styles.sectionTitle}>Profile settings</Text>
                {profile.player.username_owned === false ? (
                  <View style={styles.warning}>
                    <Text style={styles.warningTitle}>Username needs attention</Text>
                    <Text style={styles.body}>
                      Choose a unique leaderboard name below before this account can appear in ranked public identity.
                    </Text>
                  </View>
                ) : null}

                <Text style={styles.fieldLabel}>Leaderboard name</Text>
                <TextInput
                  accessibilityLabel="Leaderboard name"
                  autoCapitalize="words"
                  autoComplete="nickname"
                  maxLength={24}
                  onChangeText={setProfileName}
                  placeholder="Leaderboard name"
                  placeholderTextColor={colors.faint}
                  style={styles.input}
                  value={profileName}
                />
                <Text style={styles.fieldHelp}>Shown on Pack One Daily leaderboards.</Text>

                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: profilePublic }}
                  onPress={() => setProfilePublic((value) => !value)}
                  style={[styles.toggle, profilePublic && styles.toggleActive]}
                >
                  <View style={styles.toggleCopy}>
                    <Text style={styles.toggleTitle}>Public profile</Text>
                    <Text style={styles.fieldHelp}>Allows leaderboard visitors and shared links to open your Pack One record.</Text>
                  </View>
                  <Text style={[styles.toggleValue, profilePublic && styles.toggleValueActive]}>
                    {profilePublic ? 'ON' : 'OFF'}
                  </Text>
                </Pressable>

                <Text style={styles.fieldLabel}>Favorite environment</Text>
                <View style={styles.optionGrid}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: favoriteSetId === '' }}
                    onPress={() => setFavoriteSetId('')}
                    style={[styles.optionChip, favoriteSetId === '' && styles.optionChipSelected]}
                  >
                    <Text style={[styles.optionChipText, favoriteSetId === '' && styles.optionChipTextSelected]}>No favorite</Text>
                  </Pressable>
                  {favoriteOptions.map((item) => (
                    <Pressable
                      key={item.set_id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: favoriteSetId === item.set_id }}
                      onPress={() => setFavoriteSetId(item.set_id)}
                      style={[styles.optionChip, favoriteSetId === item.set_id && styles.optionChipSelected]}
                    >
                      <Text style={[styles.optionChipText, favoriteSetId === item.set_id && styles.optionChipTextSelected]}>
                        {item.set_name}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Showcase achievement</Text>
                <View style={styles.optionGrid}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: showcaseAchievement === '' }}
                    onPress={() => setShowcaseAchievement('')}
                    style={[styles.optionChip, showcaseAchievement === '' && styles.optionChipSelected]}
                  >
                    <Text style={[styles.optionChipText, showcaseAchievement === '' && styles.optionChipTextSelected]}>No showcase</Text>
                  </Pressable>
                  {unlockedAchievements.map((item) => (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: showcaseAchievement === item.id }}
                      onPress={() => setShowcaseAchievement(item.id)}
                      style={[styles.optionChip, showcaseAchievement === item.id && styles.optionChipSelected]}
                    >
                      <Text style={[styles.optionChipText, showcaseAchievement === item.id && styles.optionChipTextSelected]}>
                        ◆ {item.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Pressable
                  accessibilityRole="button"
                  disabled={busy || profileName.trim().length < 2}
                  onPress={() => void saveProfile()}
                  style={[styles.primaryButton, (busy || profileName.trim().length < 2) && styles.disabled]}
                >
                  <Text style={styles.primaryButtonText}>Save profile</Text>
                </Pressable>

                <Pressable accessibilityRole="button" onPress={() => router.push('/career')} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Open My Pack One</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.settingsSection}>
              <Text style={styles.sectionTitle}>Elite membership</Text>
              <View style={[styles.membershipCard, elite && styles.membershipCardElite]}>
                <Text style={styles.membershipTitle}>{membershipTitle}</Text>
                <Text style={styles.body}>
                  {elite
                    ? 'Elite access is active. Powered Cube and custom-set practice are unlocked on this account.'
                    : patreon?.connected
                      ? 'Your Patreon account is linked, but it does not currently provide Elite access.'
                      : 'Existing Elite access is recognized in the mobile app after you connect the Patreon account that provides it.'}
                </Text>
                {patreon?.membership?.sync_pending ? (
                  <Text style={styles.fieldHelp}>Patreon is syncing a recent membership change.</Text>
                ) : patreon?.membership?.last_synced_at ? (
                  <Text style={styles.fieldHelp}>
                    Last synced {new Date(patreon.membership.last_synced_at).toLocaleString()}
                  </Text>
                ) : null}
                <Text style={styles.fieldHelp}>
                  Membership purchases and upgrades are not sold inside Pack One mobile.
                </Text>
              </View>

              {patreon?.configured !== false ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void connectPatreon()}
                  style={[styles.secondaryButton, busy && styles.disabled]}
                >
                  <Text style={styles.secondaryButtonText}>
                    {patreon?.connected ? 'Refresh Patreon access' : 'Connect existing Patreon membership'}
                  </Text>
                </Pressable>
              ) : null}

              {patreon?.connected ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={confirmPatreonDisconnect}
                  style={[styles.textButton, busy && styles.disabled]}
                >
                  <Text style={styles.dangerTextButton}>Disconnect Patreon</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.settingsSection}>
              <Text style={styles.sectionTitle}>Sign-in credentials</Text>
              <Text style={styles.credentialLine}>
                {account.credentials.password ? 'Password · connected' : 'Password · not configured'}
              </Text>
              <Text style={styles.credentialLine}>
                {account.credentials.google ? 'Google · connected' : 'Google · not connected'}
              </Text>
              <Text style={styles.credentialLine}>
                {account.credentials.apple ? 'Apple · connected' : 'Apple · not connected'}
              </Text>

              {account.credentials.password ? (
                <View style={styles.passwordBox}>
                  <Text style={styles.fieldLabel}>Change password</Text>
                  <Text style={styles.fieldHelp}>Changing your password signs out every Pack One account session, including this device.</Text>
                  <TextInput
                    accessibilityLabel="Current password"
                    autoCapitalize="none"
                    autoComplete="current-password"
                    onChangeText={setCurrentPassword}
                    placeholder="Current password"
                    placeholderTextColor={colors.faint}
                    secureTextEntry
                    style={styles.input}
                    value={currentPassword}
                  />
                  <TextInput
                    accessibilityLabel="New password"
                    autoCapitalize="none"
                    autoComplete="new-password"
                    onChangeText={setNewPassword}
                    placeholder="New password"
                    placeholderTextColor={colors.faint}
                    secureTextEntry
                    style={styles.input}
                    value={newPassword}
                  />
                  <TextInput
                    accessibilityLabel="Confirm new password"
                    autoCapitalize="none"
                    autoComplete="new-password"
                    onChangeText={setConfirmPassword}
                    placeholder="Confirm new password"
                    placeholderTextColor={colors.faint}
                    secureTextEntry
                    style={styles.input}
                    value={confirmPassword}
                  />
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy || !currentPassword || newPassword.length < 8 || !confirmPassword}
                    onPress={() => void changePassword()}
                    style={[
                      styles.secondaryButton,
                      (busy || !currentPassword || newPassword.length < 8 || !confirmPassword) && styles.disabled,
                    ]}
                  >
                    <Text style={styles.secondaryButtonText}>Change password</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.fieldHelp}>
                  {account.credentials.apple
                    ? 'This account signs in with Apple and does not have a Pack One password to change.'
                    : account.credentials.google
                      ? 'This account signs in with Google and does not have a Pack One password to change.'
                      : 'This account does not have a password credential to change.'}
                </Text>
              )}
            </View>

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
            {mode === 'signin' ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void forgotPassword()}
                style={styles.textButton}
              >
                <Text style={styles.textButtonText}>Forgot password?</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void resendVerification()}
              style={styles.textButton}
            >
              <Text style={styles.textButtonText}>Resend verification email</Text>
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
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg, alignSelf: 'center', width: '100%', maxWidth: 760 },
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
  settingsSection: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.lg, gap: spacing.md },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  fieldHelp: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  warning: { borderWidth: 1, borderLeftWidth: 4, borderColor: colors.accent, padding: spacing.md, gap: spacing.xs },
  warningTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  toggle: {
    minHeight: 62,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  toggleActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  toggleCopy: { flex: 1, gap: 3 },
  toggleTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  toggleValue: { color: colors.muted, fontSize: 12, fontWeight: '900' },
  toggleValueActive: { color: colors.accentDark },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  optionChip: {
    minHeight: 40,
    maxWidth: '100%',
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionChipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  optionChipText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  optionChipTextSelected: { color: colors.accentDark },
  credentialLine: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  membershipCard: { borderWidth: 1, borderColor: colors.lineStrong, padding: spacing.md, gap: spacing.sm },
  membershipCardElite: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  membershipTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  passwordBox: { gap: spacing.md },
  textButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  textButtonText: { color: colors.accentDark, fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' },
  dangerTextButton: { color: colors.danger, fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' },
  dangerZone: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.lg, gap: spacing.md },
  dangerTitle: { color: colors.danger, fontSize: 16, fontWeight: '800' },
  dangerButton: { minHeight: 50, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  dangerButtonText: { color: colors.danger, fontSize: 15, fontWeight: '800' },
});
