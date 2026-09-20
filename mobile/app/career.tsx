import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  loadMobileCareer,
  loadMobileCareerHistory,
  type CareerHistoryRow,
  type CareerProfile,
} from '@/src/api/career';
import { readSession, type MobileSession } from '@/src/storage/session';
import { colors, spacing } from '@/src/theme';

type CareerState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      profile: CareerProfile;
      history: CareerHistoryRow[];
      nextCursor: string | null;
    };

function environmentName(setId: string) {
  if (setId === 'mixed') return 'Draft Run';
  if (setId === 'powered-cube') return 'Powered Cube';
  if (setId === 'latest') return 'Latest Set';
  return setId.toUpperCase();
}

function modeName(row: CareerHistoryRow) {
  if (row.set_id === 'powered-cube') return 'Powered Cube';
  if (row.mode === 'draft_run') return environmentName(row.set_id);
  if (row.mode === 'challenge') return 'Challenge';
  return row.mode.replaceAll('_', ' ').replace(/\b\w/g, (value) => value.toUpperCase());
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function HistoryRow({ row }: { row: CareerHistoryRow }) {
  const label = modeName(row);
  const date = dateLabel(row.played_at);
  const detail = [row.is_daily ? 'Daily' : null, date, row.grade || null, row.outcome || null]
    .filter(Boolean)
    .join(' · ');

  return (
    <View
      accessible
      accessibilityLabel={`${label}, score ${row.score}${detail ? `, ${detail}` : ''}`}
      style={styles.historyRow}
    >
      <View style={styles.historyCopy}>
        <Text style={styles.historyTitle}>{label}</Text>
        {detail ? <Text style={styles.historyDetail}>{detail}</Text> : null}
      </View>
      <Text style={styles.historyScore}>{row.score}</Text>
    </View>
  );
}

export default function CareerScreen() {
  const [state, setState] = useState<CareerState>({ status: 'loading' });
  const [session, setSession] = useState<MobileSession | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void readSession()
      .then(async (current) => {
        if (!active) return;
        if (!current?.accountToken) {
          setState({ status: 'signed-out' });
          return;
        }
        setSession(current);
        const [profile, history] = await Promise.all([
          loadMobileCareer(current),
          loadMobileCareerHistory(current),
        ]);
        if (!active) return;
        setState({
          status: 'ready',
          profile,
          history: history.rows,
          nextCursor: history.next_cursor,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Your career is unavailable.',
        });
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const retry = () => {
    setState({ status: 'loading' });
    setReloadKey((value) => value + 1);
  };

  const loadMore = async () => {
    if (!session || state.status !== 'ready' || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await loadMobileCareerHistory(session, state.nextCursor);
      setState((current) => current.status === 'ready'
        ? {
            ...current,
            history: [...current.history, ...next.rows],
            nextCursor: next.next_cursor,
          }
        : current);
    } catch (error: unknown) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Your career history is unavailable.',
      });
    } finally {
      setLoadingMore(false);
    }
  };

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator accessibilityLabel="Loading career" color={colors.accent} />
          <Text style={styles.body}>Loading your career…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'signed-out') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.eyebrow}>YOUR CAREER</Text>
          <Text style={styles.title}>Keep one career across web and mobile.</Text>
          <Text style={styles.body}>
            Sign in to your Pack One account to view your games, scores, and streaks.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/account')}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Sign in or create account</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Couldn&apos;t load your career</Text>
          <Text style={styles.body}>{state.message}</Text>
          <Pressable accessibilityRole="button" onPress={retry} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Account</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { profile } = state;
  const summary = profile.summary;
  const best = profile.best_environments.slice(0, 3);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>YOUR CAREER</Text>
          <Text style={styles.title}>{profile.player.display_name}</Text>
          <Text style={styles.body}>One Pack One history across your linked account.</Text>
        </View>

        <View style={styles.metrics}>
          <Metric label="Games" value={summary.games} />
          <Metric label="Average" value={summary.average_score} />
          <Metric label="Best" value={summary.best_score} />
          <Metric label="Streak" value={summary.current_streak} />
        </View>

        {best.length ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>BEST ENVIRONMENTS</Text>
            {best.map((item) => (
              <View key={item.set_id} style={styles.environmentRow}>
                <View style={styles.historyCopy}>
                  <Text style={styles.historyTitle}>{environmentName(item.set_id)}</Text>
                  <Text style={styles.historyDetail}>{item.games} games</Text>
                </View>
                <Text style={styles.environmentAverage}>{item.average_score} avg</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>HISTORY</Text>
          {state.history.length ? (
            state.history.map((row) => <HistoryRow key={row.cursor} row={row} />)
          ) : (
            <Text style={styles.empty}>Your completed Pack One games will appear here.</Text>
          )}
          {state.nextCursor ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: loadingMore }}
              disabled={loadingMore}
              onPress={() => void loadMore()}
              style={[styles.secondaryButton, loadingMore && styles.disabled]}
            >
              <Text style={styles.secondaryButtonText}>
                {loadingMore ? 'Loading…' : 'Load more'}
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
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  hero: { gap: spacing.sm },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 34, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: {
    width: '48%',
    minHeight: 88,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    justifyContent: 'center',
  },
  metricValue: { color: colors.ink, fontSize: 25, fontWeight: '800' },
  metricLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: spacing.xs },
  section: { gap: spacing.sm },
  sectionLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  environmentRow: {
    minHeight: 62,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  environmentAverage: { color: colors.accentDark, fontSize: 14, fontWeight: '800' },
  historyRow: {
    minHeight: 64,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  historyCopy: { flex: 1, gap: spacing.xs },
  historyTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  historyDetail: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  historyScore: { color: colors.ink, fontSize: 21, fontWeight: '800' },
  empty: { color: colors.muted, fontSize: 14, lineHeight: 21, paddingVertical: spacing.md },
  center: {
    flex: 1,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  errorTitle: { color: colors.ink, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  primaryButton: {
    minHeight: 48,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: colors.surface, fontSize: 15, fontWeight: '800' },
  secondaryButton: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.55 },
});
