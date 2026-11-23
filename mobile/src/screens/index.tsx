import { themedStyles, withAppTheme } from '@/src/appearance';
import { ResultsPreferences } from '@/src/components/ResultsPreferences';
import { AdMobDailyBanner, type AdDiagnostic } from '@/src/components/AdMobDailyBanner';
import { dailyHomePromotion } from '@/src/ads/placement';
import { isTestFlightEnvironment } from '@/src/ads/isTestFlight';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from '@/src/components/Text';
import { config } from '@/src/config';

import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';

import {
  DAILY_ENVIRONMENT_META,
  loadDailyStatus,
  type DailyEnvironment,
  type DailyStatus,
} from '@/src/api/draftRun';
import { ensureGuestSession } from '@/src/api/guest';
import { loadNativePatreonStatus } from '@/src/api/patreon';
import { useNavigationSession } from '@/src/navigation/session';
import { readSession, subscribeSession, type MobileSession } from '@/src/storage/session';
import { pacificDay, dailyDate, dailyResetCue } from '@/src/dailyClock';
import { useAppResume } from '@/src/hooks/useAppResume';
import { tcgplayerMagicUrl } from '@/src/tcgplayer';
import { colors, spacing } from '@/src/theme';

const dailyEnvironments: DailyEnvironment[] = ['mixed', 'powered-cube', 'latest'];
const brandMarkImage = require('../../assets/images/header-mark.png');

function recordBrandLayout(label: string, event: LayoutChangeEvent) {
  if (config.screenshots.fixtures) console.info('PACKONE_BRAND', JSON.stringify({ label, ...event.nativeEvent.layout }));
}

function Brand() {
  return (
    <View style={styles.brand} onLayout={event => recordBrandLayout('brand', event)}>
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.brandMark} onLayout={event => recordBrandLayout('mark', event)}>
        <Image source={brandMarkImage} contentFit="contain" style={styles.brandMarkImage} />
      </View>
      <Text style={styles.brandName} onLayout={event => recordBrandLayout('name', event)}>Pack One</Text>
    </View>
  );
}

function completed(status: DailyStatus | null, environment: DailyEnvironment) {
  if (!status) return false;
  return status.daily_history.some((row) => (
    row.date === status.day && row.mode === 'draft_run' && row.set_id === environment
  ));
}

// Website daily-home.mjs is the source of truth for Daily-home copy.
// Keep home-only titles separate from gameplay, profile, and leaderboard labels.
const HOME_LABELS: Record<DailyEnvironment, string> = { mixed: 'A MIX OF SETS', 'powered-cube': 'POWERED CUBE PICKS', latest: 'ONLY THE NEWEST SET' };
const HOME_TITLES: Record<DailyEnvironment, string> = { mixed: 'Daily Draft Run', 'powered-cube': 'Daily Powered Cube', latest: 'Daily Latest Set' };

const AD_STATUS_LABELS: Record<AdDiagnostic['stage'], string> = {
  starting: 'Waiting for ad eligibility',
  'consent-checking': 'Checking Google consent',
  'consent-ready': 'Google consent allows an ad request',
  'consent-blocked': 'Google consent does not allow an ad request',
  'consent-error': 'Google consent could not be verified',
  'tracking-checked': 'Checking advertising setup',
  'tracking-error': 'Could not check iOS tracking preference',
  'sdk-initializing': 'Starting Google ads',
  'sdk-error': 'Google ads could not start',
  'banner-requested': 'Banner requested; waiting for Google',
  'banner-loaded': 'Banner loaded',
  'banner-no-fill': 'Google returned no ad for this request',
  'banner-error': 'Google could not load the banner',
};

function HomeScreen() {
  const accountState = useNavigationSession();
  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [promotionAllowed, setPromotionAllowed] = useState<boolean | null>(null);
  const [promotionError, setPromotionError] = useState<string | null>(null);
  const [adStatusOpen, setAdStatusOpen] = useState(false);
  const [showAdDiagnostics, setShowAdDiagnostics] = useState(false);
  const [adDiagnostic, setAdDiagnostic] = useState<AdDiagnostic>({ stage: 'starting' });
  const onAdStatus = useCallback((event: AdDiagnostic) => setAdDiagnostic(previous => ({ ...previous, ...event })), []);
  useEffect(() => {
    if (Platform?.OS !== 'ios' || config.screenshots?.fixtures) return;
    let active = true;
    void isTestFlightEnvironment().then(allowed => { if (active) setShowAdDiagnostics(allowed); });
    return () => { active = false; };
  }, []);
  const [phase, setPhase] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  const [now, setNow] = useState(() => new Date());
  const [claimed, setClaimed] = useState(false);
  const statusRef = useRef<DailyStatus | null>(null);
  const owner = useRef('');
  const requestId = useRef(0);
  const identity = (session: MobileSession | null) => session ? `${session.playerToken}:${session.accountToken ?? ''}` : '';

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    const day = pacificDay();
    setNow(new Date());
    setPhase('checking');
    setPromotionAllowed(null);
    setAdDiagnostic({ stage: 'starting' });
    try {
      const session = await ensureGuestSession();
      if (id !== requestId.current) return;
      const key = identity(session);
      if (owner.current !== key || statusRef.current?.day !== day) {
        statusRef.current = null;
        setStatus(null);
      }
      owner.current = key;
      setClaimed(Boolean(session.accountToken));
      const [dailyResult, promotionResult] = await Promise.allSettled([
        loadDailyStatus(session),
        session.accountToken
          ? loadNativePatreonStatus(session).then((membership) => membership.ads_allowed === true && !membership.ad_free
            && !['custom_corpus', 'unlimited_cube_practice'].every(cap => membership.account_capabilities?.includes(cap)))
          : Promise.resolve(true),
      ]);
      const current = await readSession();
      if (id !== requestId.current || identity(current) !== key || day !== pacificDay()) return;
      if (dailyResult.status === 'fulfilled' && dailyResult.value.day === day) {
        statusRef.current = dailyResult.value;
        setStatus(dailyResult.value);
        setPhase('ready');
      } else setPhase('unavailable');
      setPromotionAllowed(promotionResult.status === 'fulfilled' && promotionResult.value === true);
    } catch {
      if (id !== requestId.current) return;
      setPhase('unavailable');
      setPromotionAllowed(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void refresh();
    return () => { requestId.current += 1; };
  }, [refresh]));
  useEffect(() => subscribeSession(() => {
    requestId.current += 1;
    owner.current = '';
    statusRef.current = null;
    setStatus(null);
    setPromotionAllowed(null);
    setPromotionError(null);
    setAdDiagnostic({ stage: 'starting' });
    void refresh();
  }), [refresh]);
  useAppResume(refresh);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
      if (statusRef.current?.day !== pacificDay()) void refresh();
    }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // The website deliberately keeps this order even after a Daily is completed.
  const dailies = dailyEnvironments;
  const currentStatus = status?.day === pacificDay(now) ? status : null;
  const completedCount = currentStatus ? dailyEnvironments.filter((environment) => completed(currentStatus, environment)).length : null;
  const showHomeStatus = phase === 'ready' && claimed && Boolean(currentStatus?.player?.claimed) && completedCount === 3;
  const rankingReason = currentStatus?.ranking_identity?.reason;
  const openPromotion = async () => {
    setPromotionError(null);
    try {
      await Linking.openURL(tcgplayerMagicUrl());
    } catch {
      setPromotionError('Could not open TCGplayer. Try the affiliate link again.');
    }
  };
  const displayNameAttention = ['username_taken', 'username_required', 'name_not_allowed'].includes(rankingReason || '');
  const nativeAdMobEnabled = Platform?.OS === 'ios' ? config.adMob?.iosEnabled === true : config.adMob?.androidEnabled === true;
  const promotion = dailyHomePromotion(promotionAllowed, nativeAdMobEnabled, Platform?.OS === 'ios' ? 'ios' : 'android');

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <ResultsPreferences />
        <View onLayout={event => recordBrandLayout('row', event)} style={styles.brandRow}><Brand /></View>

        <View style={styles.hero}>
          <Text style={styles.title}>Eight picks. What would you take?</Text>
          <Text style={styles.lede}>These picks come from real trophy drafts. Make your pick. See what the trophy drafter chose.</Text>
        </View>

        {accountState.message ? <Pressable accessibilityRole="button" onPress={() => void accountState.refresh()} style={styles.warning}>
          <Text style={styles.warningBody}>{accountState.message}</Text><Text style={styles.cardAction}>Retry account check</Text>
        </Pressable> : accountState.status === 'checking' ? <Text style={styles.statusText}>Checking account…</Text> : null}
        {phase === 'unavailable' ? <View style={styles.warning}>
          <Text accessibilityRole="alert" style={styles.warningBody}>Couldn’t load your Daily progress. Play now will still pick up where you left off.</Text>
          <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.helpLink}><Text style={styles.cardAction}>Retry</Text></Pressable>
        </View> : null}

        {displayNameAttention ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/account-profile')}
            style={styles.warning}
          >
            <Text style={styles.warningTitle}>
              {rankingReason === 'name_not_allowed'
                ? 'That display name is not allowed. Choose another to join Daily leaderboards.'
                : rankingReason === 'username_taken'
                  ? 'Choose a different display name. That one is already taken.'
                  : 'Choose a display name before playing a Daily.'}
            </Text>
            <Text style={styles.warningBody}>
              Pick a display name that isn’t taken, or your Daily scores won’t show on the leaderboard.
            </Text>
            <Text style={styles.cardAction}>Change display name</Text>
          </Pressable>
        ) : null}

        <View style={styles.dailySection}>
          <View style={styles.dailyHeading} accessibilityLabel="Daily date and progress">
            <Text style={styles.today}>{dailyDate(pacificDay(now))}’s Daily Runs</Text>
            {showHomeStatus ? <View style={styles.dailyCue}>
              <Text style={styles.resetCue}>{dailyResetCue(now)}</Text>
              {currentStatus && currentStatus.daily_streak > 0
                ? <Text style={styles.statusText}>{currentStatus.daily_streak}-day streak</Text> : null}
            </View> : null}
          </View>
          {dailies.map((environment, index) => {
            const meta = DAILY_ENVIRONMENT_META[environment];
            const isComplete = completed(currentStatus, environment);
            const result = currentStatus?.daily_history.find((row) => row.date === currentStatus.day && row.mode === 'draft_run' && row.set_id === environment);
            const startHere = currentStatus && !claimed && completedCount === 0 && environment === 'mixed';
            return (
              <View
                key={environment}
                style={[
                  index === 0 && !isComplete ? styles.primaryCard : styles.dailyCard,
                  environment === 'powered-cube' && styles.cubeAccent,
                  environment === 'latest' && styles.latestAccent,
                  isComplete && styles.completeCard,
                ]}
              >
                <View style={styles.dailyCardContent}>
                  <Text style={[styles.cardIndex, environment === 'powered-cube' && styles.cardIndexCube, environment === 'latest' && styles.cardIndexLatest]}>
                    {String(index + 1).padStart(2, '0')}
                  </Text>
                  <View style={styles.dailyCardCopy}>
                    <View style={styles.cardHeading}>
                      <Text style={styles.cardKicker}>{startHere ? 'START HERE · ' : ''}{HOME_LABELS[environment]}</Text>
                    </View>
                    <Text style={index === 0 && !isComplete ? styles.cardTitle : styles.dailyTitle}>{HOME_TITLES[environment]}</Text>
                    <Text style={styles.cardBody}>{isComplete ? `Complete · ${result?.score}/100` : meta.description}</Text>
                    {startHere ? <Text style={styles.statusText}>Free · No account required</Text> : null}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${isComplete ? 'View result for' : 'Play'} ${HOME_TITLES[environment]}`}
                    onPress={() => router.push({ pathname: '/draft-run', params: { environment } })}
                    style={({ pressed }) => [
                      styles.dailyButton,
                      isComplete ? styles.secondaryButton : styles.primaryButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={isComplete ? styles.secondaryButtonText : styles.primaryButtonText}>
                      {isComplete ? 'View result' : 'Play now'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>

        {completedCount === 3 ? (
          <View style={styles.practiceHandoff}>
            <Text style={styles.cardKicker}>DAILIES COMPLETE</Text>
            <Text style={styles.utilityTitle}>Want another eight picks?</Text>
            <Text style={styles.cardBody}>
              {claimed
                ? 'Keep playing regular Draft Runs, or any sets with Pack One Elite.'
                : 'A free account adds unlimited regular Draft Runs.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(claimed ? '/practice' : '/account')}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>{claimed ? 'Go to Practice' : 'Create a free account'}</Text>
            </Pressable>
          </View>
        ) : null}

        {promotion === 'admob' ? <AdMobDailyBanner eligible={promotionAllowed === true} onStatus={onAdStatus} /> : null}
        {promotion === 'affiliate' ? (
          <View style={styles.affiliatePromo}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Shop Magic on TCGplayer, affiliate link"
              onPress={() => void openPromotion()}
              style={({ pressed }) => [styles.affiliateLink, pressed && styles.pressed]}
            >
              <Image
                source="https://packone.pro/assets/tcgplayer-logo-primary-stroke.webp"
                style={styles.affiliateLogo}
                contentFit="contain"
                accessibilityLabel="TCGplayer"
              />
              <View style={styles.affiliateCopy}>
                <Text style={styles.affiliateTitle}>Shop Magic on TCGplayer</Text>
                <Text style={styles.affiliateDetail}>Singles, sealed product, and more</Text>
              </View>
              <Text style={styles.affiliateAction}>Shop TCGplayer →</Text>
            </Pressable>
            <Text style={styles.affiliateDisclosure}>Affiliate link. Pack One may earn a commission from purchases.</Text>
            {promotionError ? <Text accessibilityRole="alert" style={styles.promotionError}>{promotionError}</Text> : null}
          </View>
        ) : null}

        {showAdDiagnostics && Platform?.OS === 'ios' && !config.screenshots?.fixtures ? (
          <View style={styles.adSupport}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Check ad status"
              accessibilityState={{ expanded: adStatusOpen }}
              onPress={() => setAdStatusOpen(open => !open)}
              style={styles.adStatusButton}
            >
              <Text style={styles.adStatusLink}>Check ad status</Text>
            </Pressable>
            {adStatusOpen ? <View style={styles.adStatusDetails}>
              <Text style={styles.statusText}>Ad configuration: {nativeAdMobEnabled ? 'enabled' : 'unavailable'}</Text>
              <Text style={styles.statusText}>Account eligibility: {promotionAllowed === null ? 'checking' : promotionAllowed ? 'allowed' : 'not allowed or unavailable'}</Text>
              {promotionAllowed === true && nativeAdMobEnabled ? <>
                <Text style={styles.statusText}>Google: {AD_STATUS_LABELS[adDiagnostic.stage]}</Text>
                {adDiagnostic.consent ? <Text style={styles.statusText}>Consent: {adDiagnostic.consent}</Text> : null}
                {adDiagnostic.tracking ? <Text style={styles.statusText}>iOS tracking: {adDiagnostic.tracking}</Text> : null}
                {adDiagnostic.code ? <Text style={styles.statusText}>Error code: {adDiagnostic.code}</Text> : null}
              </> : null}
              <Text style={styles.statusText}>No personal details or consent strings are shown.</Text>
            </View> : null}
          </View>
        ) : null}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  helpLink: { minHeight: 44, justifyContent: 'center' },
  dailyHeading: { borderTopWidth: 2, borderBottomWidth: 1, borderColor: colors.lineStrong, paddingVertical: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: spacing.md, rowGap: spacing.xs },
  dailyCue: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  statusText: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.md, paddingBottom: spacing.xxl, gap: 9, alignSelf: 'center', width: '100%', maxWidth: 860 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1, minWidth: 0, maxWidth: '100%' },
  brandMark: {
    width: 30,
    height: 32,
    flexShrink: 0,
  },
  brandMarkImage: { width: 30, height: 32 },
  brandName: { color: colors.ink, fontSize: 22, fontWeight: '600', letterSpacing: 0.2, flexShrink: 1, minWidth: 0 },
  removedBrandSub: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginTop: 2 },
  hero: { gap: spacing.xs },
  title: { color: colors.ink, fontSize: 30, lineHeight: 33, fontWeight: '800', letterSpacing: -0.8 },
  lede: { color: colors.muted, fontSize: 14, lineHeight: 20, maxWidth: 640 },
  today: { color: colors.muted, fontSize: 13, fontWeight: '800' },
  dailySection: { gap: 0 },
  dailyCardContent: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  dailyCardCopy: { flex: 1, minWidth: 150, gap: spacing.xs },
  dailyButton: { minWidth: 92, flexGrow: 1, alignSelf: 'center' },
  cardIndex: { minWidth: 26, flexShrink: 0, color: colors.accentDark, fontSize: 24, fontWeight: '700' },
  cardIndexCube: { color: colors.cube },
  cardIndexLatest: { color: colors.latest },
  cubeAccent: { borderLeftColor: colors.cube },
  latestAccent: { borderLeftColor: colors.latest },
  primaryCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: colors.line,
    borderTopColor: colors.accent,
    borderLeftColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.xs,
  },
  dailyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderColor: colors.line,
    borderLeftColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.xs,
  },
  completeCard: { backgroundColor: colors.surfaceSoft, borderLeftColor: colors.lineStrong },
  cardHeading: { flexWrap: 'wrap', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  pressed: { opacity: 0.78 },
  warning: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderColor: colors.accent,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  warningTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  warningBody: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  practiceHandoff: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderTopWidth: 3,
    borderColor: colors.line,
    borderTopColor: colors.accent,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  resetCue: { color: colors.accentDark, fontSize: 13, fontWeight: '800', flexShrink: 1 },
  affiliatePromo: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.xs },
  affiliateLink: { minHeight: 72, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  affiliateLogo: { width: 92, height: 42 },
  affiliateCopy: { flex: 1, minWidth: 150, gap: 2 },
  affiliateTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  affiliateDetail: { color: colors.muted, fontSize: 12 },
  affiliateAction: { color: colors.accentDark, fontSize: 12, fontWeight: '800' },
  affiliateDisclosure: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  promotionError: { color: colors.danger, fontSize: 12, lineHeight: 17 },
  adSupport: { paddingTop: spacing.sm, paddingBottom: spacing.lg },
  adStatusButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  adStatusLink: { color: colors.muted, fontSize: 13, textDecorationLine: 'underline' },
  adStatusDetails: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surfaceSoft, borderRadius: 6 },
  utilityCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  utilityTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  cardKicker: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, flexShrink: 1 },
  cardTitle: { color: colors.ink, fontSize: 23, fontWeight: '800' },
  dailyTitle: { color: colors.ink, fontSize: 21, fontWeight: '800' },
  cardBody: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  cardAction: { color: colors.accentDark, fontSize: 15, fontWeight: '800', marginTop: spacing.sm },
  primaryButton: {
    minHeight: 48,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 15, lineHeight: 21, fontWeight: '800', textAlign: 'center' },
  secondaryButton: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: colors.accentDark, fontSize: 15, lineHeight: 21, fontWeight: '800', textAlign: 'center' },
}));

export default withAppTheme(HomeScreen);
