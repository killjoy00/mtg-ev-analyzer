import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import {
  DAILY_ENVIRONMENT_META,
  loadDailyStatus,
  type DailyEnvironment,
  type DailyStatus,
} from '@/src/api/draftRun';
import { ensureGuestSession } from '@/src/api/guest';
import { useAppResume } from '@/src/hooks/useAppResume';
import { colors, spacing } from '@/src/theme';

const dailyEnvironments: DailyEnvironment[] = ['mixed', 'powered-cube', 'latest'];

function Brand() {
  return (
    <View style={styles.brand}>
      <View style={styles.brandMark}>
        <Text style={styles.brandMarkText}>P¹</Text>
      </View>
      <View>
        <Text style={styles.brandName}>Pack One</Text>
        <Text style={styles.brandSub}>DRAFT DECISION LAB</Text>
      </View>
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
  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useAppResume(() => setReloadKey((value) => value + 1));

  useEffect(() => {
    let active = true;
    void ensureGuestSession()
      .then((session) => loadDailyStatus(session))
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {
        // Daily state is enrichment. Starting a Daily remains server-authoritative
        // and safely resumes the existing attempt if status cannot be loaded.
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const dailies = useMemo(() => [...dailyEnvironments].sort((a, b) => (
    Number(completed(status, a)) - Number(completed(status, b))
  )), [status]);

  const completedCount = dailyEnvironments.filter((environment) => completed(status, environment)).length;
  const rankingReason = status?.ranking_identity?.reason;
  const usernameAttention = rankingReason === 'username_taken' || rankingReason === 'username_required';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <Brand />

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>THE DAILY DRAFT</Text>
          <Text style={styles.title}>Eight picks. Your call.</Text>
          <Text style={styles.lede}>
            Make your pick, then see what the trophy drafter chose and how strong your pick was.
          </Text>
          {status?.day ? <Text style={styles.today}>{status.day} · {completedCount}/3 complete</Text> : null}
        </View>

        {usernameAttention ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/account')}
            style={styles.warning}
          >
            <Text style={styles.warningTitle}>Choose a unique username before playing a ranked Daily.</Text>
            <Text style={styles.warningBody}>
              Your account is linked, but this name cannot appear on the leaderboard yet.
            </Text>
            <Text style={styles.cardAction}>Fix username →</Text>
          </Pressable>
        ) : null}

        <View style={styles.dailySection}>
          <Text style={styles.sectionLabel}>PLAY TODAY</Text>
          {dailies.map((environment, index) => {
            const meta = DAILY_ENVIRONMENT_META[environment];
            const isComplete = completed(status, environment);
            return (
              <Pressable
                key={environment}
                accessibilityRole="button"
                accessibilityLabel={`${isComplete ? 'View' : 'Play'} ${meta.title} Daily`}
                onPress={() => router.push({ pathname: '/draft-run', params: { environment } })}
                style={({ pressed }) => [
                  index === 0 && !isComplete ? styles.primaryCard : styles.dailyCard,
                  isComplete && styles.completeCard,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.cardHeading}>
                  <Text style={styles.cardKicker}>{meta.eyebrow}</Text>
                  {isComplete ? <Text style={styles.completeBadge}>COMPLETE</Text> : null}
                </View>
                <Text style={index === 0 && !isComplete ? styles.cardTitle : styles.dailyTitle}>{meta.title}</Text>
                <Text style={styles.cardBody}>{meta.description}</Text>
                <Text style={styles.cardAction}>{isComplete ? 'View result →' : 'Play now →'}</Text>
              </Pressable>
            );
          })}
        </View>

        {completedCount === 3 ? (
          <View style={styles.practiceHandoff}>
            <Text style={styles.cardKicker}>DAILIES COMPLETE</Text>
            <Text style={styles.utilityTitle}>Keep drafting.</Text>
            <Text style={styles.cardBody}>
              {status?.player.claimed
                ? 'Your practice options are all in one place.'
                : 'A free account adds unlimited regular Draft Run practice.'}
            </Text>
            <Text style={styles.resetCue}>
              Next Daily · midnight Pacific{Number(status?.daily_streak || 0) >= 2 ? ` · ${status?.daily_streak}-day streak` : ''}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(status?.player.claimed ? '/practice' : '/account')}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>{status?.player.claimed ? 'Go to Practice' : 'Create a free account'}</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open practice"
          onPress={() => router.push('/practice')}
          style={({ pressed }) => [styles.utilityCard, pressed && styles.pressed]}
        >
          <Text style={styles.cardKicker}>PRACTICE</Text>
          <Text style={styles.utilityTitle}>Keep drafting</Text>
          <Text style={styles.cardBody}>Regular practice is included with a free account. Existing Elite access unlocks Cube and custom-set practice.</Text>
          <Text style={styles.cardAction}>Choose practice →</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open leaderboard"
          onPress={() => router.push('/leaderboard')}
          style={({ pressed }) => [styles.utilityCard, pressed && styles.pressed]}
        >
          <Text style={styles.cardKicker}>RANKINGS</Text>
          <Text style={styles.utilityTitle}>Leaderboard</Text>
          <Text style={styles.cardBody}>Compare Today, This week, This season, and All time across all three Dailies.</Text>
          <Text style={styles.cardAction}>View rankings →</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open My Pack One"
          onPress={() => router.push('/career')}
          style={({ pressed }) => [styles.utilityCard, pressed && styles.pressed]}
        >
          <Text style={styles.cardKicker}>MY PACK ONE</Text>
          <Text style={styles.utilityTitle}>Career & achievements</Text>
          <Text style={styles.cardBody}>Review your season standings, progression, achievements, Daily history, archive progress, and completed games.</Text>
          <Text style={styles.cardAction}>Open My Pack One →</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open How to Play"
          onPress={() => router.push('/how-to')}
          style={({ pressed }) => [styles.utilityCard, pressed && styles.pressed]}
        >
          <Text style={styles.cardKicker}>LEARN</Text>
          <Text style={styles.utilityTitle}>How to Play</Text>
          <Text style={styles.cardBody}>Learn the eight-decision format, scoring, methodology, and current supported sets.</Text>
          <Text style={styles.cardAction}>Open guide →</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/account')}
          style={({ pressed }) => [styles.utilityCard, pressed && styles.pressed]}
        >
          <Text style={styles.cardKicker}>PACK ONE ACCOUNT</Text>
          <Text style={styles.utilityTitle}>Sign in or manage your account</Text>
          <Text style={styles.cardBody}>
            Use email, Google, or Apple, keep your player identity across devices, and manage account settings from the app.
          </Text>
          <Text style={styles.cardAction}>Open account →</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl, alignSelf: 'center', width: '100%', maxWidth: 860 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  brandMarkText: { color: colors.accentDark, fontSize: 18, fontWeight: '800' },
  brandName: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  brandSub: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginTop: 2 },
  hero: { gap: spacing.sm, paddingTop: spacing.lg },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 42, lineHeight: 44, fontWeight: '800', letterSpacing: -1.2 },
  lede: { color: colors.muted, fontSize: 17, lineHeight: 26, maxWidth: 640 },
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
  cardHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
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
  resetCue: { color: colors.accentDark, fontSize: 13, fontWeight: '800' },
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
