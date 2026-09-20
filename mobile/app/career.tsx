import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { loadMobileAccount } from '@/src/api/account';
import {
  loadCareerHistory,
  loadCareerProfile,
  type CareerHistoryRow,
  type CareerProfile,
} from '@/src/api/career';
import { DAILY_ENVIRONMENT_META, isDailyEnvironment } from '@/src/api/draftRun';
import { ensureGuestSession } from '@/src/api/guest';
import type { MobileSession } from '@/src/storage/session';
import { colors, spacing } from '@/src/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      session: MobileSession;
      profile: CareerProfile;
      rows: CareerHistoryRow[];
      nextCursor?: string | null;
    };

function environmentLabel(value: string) {
  return isDailyEnvironment(value) ? DAILY_ENVIRONMENT_META[value].title : value.toUpperCase();
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function HistoryRow({ item }: { item: CareerHistoryRow }) {
  const detail = [
    environmentLabel(item.set_id),
    item.is_daily ? 'Daily' : null,
    item.grade || null,
    item.outcome ? item.outcome[0].toUpperCase() + item.outcome.slice(1) : null,
  ].filter(Boolean).join(' · ');

  return (
    <View
      accessible
      accessibilityLabel={`${formatDate(item.played_at)}, ${detail}, score ${item.score}`}
      style={styles.historyRow}
    >
      <View style={styles.historyCopy}>
        <Text style={styles.historyDate}>{formatDate(item.played_at)}</Text>
        <Text style={styles.historyMeta} numberOfLines={1}>{detail}</Text>
      </View>
      <Text style={styles.historyScore}>{item.score}</Text>
    </View>
  );
}

export default function CareerScreen() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);

  const load = async ({ showLoading = true }: { showLoading?: boolean } = {}) => {
    const id = ++requestId.current;
    if (showLoading) setState({ status: 'loading' });
    try {
      const session = await ensureGuestSession();
      if (id !== requestId.current) return;
      if (!session.accountToken) {
        setState({ status: 'signed-out' });
        return;
      }
      try {
        await loadMobileAccount(session);
      } catch {
        if (id === requestId.current) setState({ status: 'signed-out' });
        return;
      }
      const [profile, history] = await Promise.all([
        loadCareerProfile(session),
        loadCareerHistory(session),
      ]);
      if (id !== requestId.current) return;
      setState({
        status: 'ready',
        session,
        profile,
        rows: history.rows,
        nextCursor: history.next_cursor,
      });
    } catch (error: unknown) {
      if (id !== requestId.current) return;
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Career is unavailable.',
      });
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void load({ showLoading: false }), 0);
    return () => {
      clearTimeout(timer);
      requestId.current += 1;
    };
  }, []);

  const loadMore = async () => {
    if (state.status !== 'ready' || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await loadCareerHistory(state.session, state.nextCursor);
      setState((current) => current.status === 'ready'
        ? {
            ...current,
            rows: [...current.rows, ...page.rows],
            nextCursor: page.next_cursor,
          }
        : current);
    } catch {
      // Keep the already-loaded history visible if pagination fails.
    } finally {
      setLoadingMore(false);
    }
  };

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator accessibilityLabel="Loading career" color={colors.accent} />
          <Text style={styles.body}>Loading your Pack One career…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'signed-out') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.eyebrow}>YOUR CAREER</Text>
          <Text style={styles.title}>Sign in to see your history.</Text>
          <Text style={styles.body}>
            Your Pack One account keeps the same scores and career across web, iPhone, and Android.
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Sign in or create an account</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.title}>Couldn&apos;t load your career.</Text>
          <Text style={styles.body}>{state.message}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { summary } = state.profile;
  const header = (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>YOUR CAREER</Text>
      <Text style={styles.title}>{state.profile.player.display_name}</Text>
      <Text style={styles.body}>Your server-authoritative Pack One results across web and mobile.</Text>
      <View style={styles.statsGrid}>
        <Stat label="Games" value={summary.games} />
        <Stat label="Average" value={summary.average_score} />
        <Stat label="Best" value={summary.best_score} />
        <Stat label="Dailies" value={summary.daily_games} />
        <Stat label="Current streak" value={summary.current_streak} />
        <Stat label="Best streak" value={summary.best_streak} />
      </View>
      <Text style={styles.sectionTitle}>Recent history</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={state.rows}
        keyExtractor={(item) => item.cursor}
        renderItem={({ item }) => <HistoryRow item={item} />}
        ListHeaderComponent={header}
        ListEmptyComponent={<Text style={styles.empty}>No completed Pack One games yet.</Text>}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={styles.footer} /> : null}
        contentContainerStyle={styles.list}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.35}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  list: { paddingBottom: spacing.xxl },
  header: { padding: spacing.lg, gap: spacing.md },
  center: { flex: 1, padding: spacing.xl, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 32, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7, textAlign: 'center' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    width: '31%',
    minWidth: 96,
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.xs,
  },
  statValue: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '800', marginTop: spacing.sm },
  historyRow: {
    minHeight: 68,
    marginHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  historyCopy: { flex: 1, gap: 3 },
  historyDate: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  historyMeta: { color: colors.muted, fontSize: 12 },
  historyScore: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  primaryButton: {
    minHeight: 50,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: colors.surface, fontSize: 15, fontWeight: '800' },
  empty: { color: colors.muted, fontSize: 15, textAlign: 'center', padding: spacing.xl },
  footer: { padding: spacing.lg },
});
