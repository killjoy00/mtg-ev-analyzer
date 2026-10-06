import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
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

function recordBrandLayout(label: string, event: LayoutChangeEvent) {
  if (config.screenshots.fixtures) console.info('PACKONE_BRAND', JSON.stringify({ label, ...event.nativeEvent.layout }));
}

function Brand() {
  return (
    <View style={styles.brand} onLayout={event => recordBrandLayout('brand', event)}>
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.brandMark} onLayout={event => recordBrandLayout('mark', event)}>
        <Image source={require('../../assets/images/header-mark.png')} contentFit="contain" style={styles.brandMarkImage} />
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

export default function HomeScreen() {
  const accountState = useNavigationSession();
  const { fontScale } = useWindowDimensions();
  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [promotionAllowed, setPromotionAllowed] = useState<boolean | null>(null);
  const [promotionError, setPromotionError] = useState<string | null>(null);
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
          ? loadNativePatreonStatus(session).then((membership) => membership.ads_allowed === true)
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

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View onLayout={event => recordBrandLayout('row', event)} style={[styles.brandRow, fontScale > 1.5 && styles.brandRowStacked]}><Brand />
          <Pressable accessibilityRole="button" accessibilityLabel="Help and information" onLayout={event => recordBrandLayout('help', event)} onPress={() => router.push('/help')} style={styles.helpLink}><Text style={styles.cardAction}>Help</Text></Pressable>
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>THE DAILY DRAFT</Text>
          <Text style={styles.title}>Eight picks. Your call.</Text>
          <Text style={styles.lede}>
            Make your pick, then see what the trophy drafter chose and how strong your pick was.
          </Text>
          <Text style={styles.today}>{dailyDate(pacificDay(now))}’s Daily Runs{completedCount !== null ? ` · ${completedCount}/3 complete` : ''}</Text>
        </View>

        {accountState.message ? <Pressable accessibilityRole="button" onPress={() => void accountState.refresh()} style={styles.warning}>
          <Text style={styles.warningBody}>{accountState.message}</Text><Text style={styles.cardAction}>Retry account check</Text>
        </Pressable> : accountState.status === 'checking' ? <Text style={styles.statusText}>Checking account…</Text> : null}
        <View style={styles.statusStrip} accessibilityLabel="Daily reset and streak">
          <Text style={styles.resetCue}>{dailyResetCue(now)}</Text>
          <Text style={styles.statusText}>{currentStatus ? `${currentStatus.daily_streak}-day streak` : phase === 'unavailable' ? 'Streak unavailable' : 'Checking streak…'}</Text>
          <Text style={styles.statusText}>Resets at midnight Pacific</Text>
        </View>
        {phase === 'checking' ? <Text style={styles.statusText}>{currentStatus ? 'Refreshing Daily progress…' : 'Checking Daily progress…'}</Text> : null}
        {phase === 'unavailable' ? <View style={styles.warning}>
          <Text accessibilityRole="alert" style={styles.warningBody}>Daily progress is temporarily unavailable. Play now still resumes your saved attempt.{currentStatus ? ' Showing your last loaded progress.' : ''}</Text>
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
              Until you choose an available display name, Daily results will not appear on the leaderboard.
            </Text>
            <Text style={styles.cardAction}>Change display name →</Text>
          </Pressable>
        ) : null}

        <View style={styles.dailySection}>
          <Text style={styles.sectionLabel}>PLAY TODAY</Text>
          {dailies.map((environment, index) => {
            const meta = DAILY_ENVIRONMENT_META[environment];
            const isComplete = completed(currentStatus, environment);
            const result = currentStatus?.daily_history.find((row) => row.date === currentStatus.day && row.mode === 'draft_run' && row.set_id === environment);
            const startHere = currentStatus && !claimed && completedCount === 0 && environment === 'mixed';
            return (
              <Pressable
                key={environment}
                accessibilityRole="button"
                accessibilityLabel={`${isComplete ? 'View' : currentStatus ? 'Play' : 'Open'} ${meta.title} Daily`}
                onPress={() => router.push({ pathname: '/draft-run', params: { environment } })}
                style={({ pressed }) => [
                  index === 0 && !isComplete ? styles.primaryCard : styles.dailyCard,
                  isComplete && styles.completeCard,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.cardHeading}>
                  <Text style={styles.cardKicker}>{startHere ? 'Start here' : meta.eyebrow}</Text>
                  {isComplete ? <Text style={styles.completeBadge}>COMPLETE</Text> : null}
                </View>
                <Text style={index === 0 && !isComplete ? styles.cardTitle : styles.dailyTitle}>{meta.title}</Text>
                <Text style={styles.cardBody}>{isComplete ? `Complete · ${result?.score}/100` : meta.description}</Text>
                <Text style={styles.cardAction}>{isComplete ? 'View result →' : currentStatus ? 'Play now →' : 'Open Daily →'}</Text>
                {startHere ? <Text style={styles.statusText}>Free · No account required</Text> : null}
              </Pressable>
            );
          })}
        </View>

        {completedCount === 3 ? (
          <View style={styles.practiceHandoff}>
            <Text style={styles.cardKicker}>DAILIES COMPLETE</Text>
            <Text style={styles.utilityTitle}>Keep drafting.</Text>
            <Text style={styles.cardBody}>
              {claimed
                ? 'Your practice options are all in one place.'
                : 'A free account adds unlimited regular Draft Run practice.'}
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

        {promotionAllowed ? (
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

        {!claimed ? <View style={styles.guestLinks}>
          <Pressable accessibilityRole="button" onPress={() => router.navigate('/leaderboard')} style={styles.helpLink}><Text style={styles.cardAction}>View Leaders</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.navigate('/practice')} style={styles.helpLink}><Text style={styles.cardAction}>Explore Practice</Text></Pressable>
        </View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  brandRowStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  helpLink: { minHeight: 44, justifyContent: 'center' },
  guestLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  statusStrip: { padding: spacing.md, backgroundColor: colors.accentSoft, flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: spacing.xs },
  statusText: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: 20, paddingBottom: spacing.xxl, gap: spacing.md, alignSelf: 'center', width: '100%', maxWidth: 860 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1, minWidth: 0, maxWidth: '100%' },
  brandMark: {
    width: 36,
    height: 40,
    flexShrink: 0,
  },
  brandMarkImage: { width: 36, height: 40 },
  brandName: { color: colors.ink, fontSize: 26, fontWeight: '600', letterSpacing: 0.39, flexShrink: 1, minWidth: 0 },
  removedBrandSub: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginTop: 2 },
  hero: { gap: spacing.sm, paddingTop: spacing.sm },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 38, lineHeight: 40, fontWeight: '800', letterSpacing: -1.2 },
  lede: { color: colors.muted, fontSize: 16, lineHeight: 23, maxWidth: 640 },
  today: { color: colors.muted, fontSize: 13, fontWeight: '800' },
  dailySection: { gap: spacing.md },
  sectionLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  primaryCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderTopWidth: 3,
    borderColor: colors.line,
    borderTopColor: colors.accent,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  dailyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  completeCard: { opacity: 0.86 },
  cardHeading: { flexWrap: 'wrap', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  completeBadge: { color: colors.accentDark, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
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
  resetCue: { width: '100%', color: colors.accentDark, fontSize: 13, fontWeight: '800' },
  affiliatePromo: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.xs },
  affiliateLink: { minHeight: 72, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  affiliateLogo: { width: 92, height: 42 },
  affiliateCopy: { flex: 1, minWidth: 150, gap: 2 },
  affiliateTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  affiliateDetail: { color: colors.muted, fontSize: 12 },
  affiliateAction: { color: colors.accentDark, fontSize: 12, fontWeight: '800' },
  affiliateDisclosure: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  promotionError: { color: colors.danger, fontSize: 12, lineHeight: 17 },
  utilityCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  utilityTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  cardKicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  cardTitle: { color: colors.ink, fontSize: 28, fontWeight: '800' },
  dailyTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  cardBody: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  cardAction: { color: colors.accentDark, fontSize: 15, fontWeight: '800', marginTop: spacing.sm },
  primaryButton: {
    minHeight: 50,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
