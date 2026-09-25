import { useLocalSearchParams } from 'expo-router';
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

import {
  DAILY_ENVIRONMENTS,
  DAILY_ENVIRONMENT_META,
  isDailyEnvironment,
  type DailyEnvironment,
} from '@/src/api/draftRun';
import {
  loadDraftRunLeaderboard,
  type DraftRunLeaderboard,
  type LeaderboardPeriod,
  type LeaderboardRow,
} from '@/src/api/leaderboard';
import { colors, spacing } from '@/src/theme';

const periods: { id: LeaderboardPeriod; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All-time' },
];

function isLeaderboardPeriod(value: string): value is LeaderboardPeriod {
  return periods.some((period) => period.id === value);
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: DraftRunLeaderboard }
  | { status: 'error'; message: string };

function FilterButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.filterButton, active && styles.filterButtonActive]}
    >
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

function RankingRow({
  item,
  showDays,
}: {
  item: LeaderboardRow;
  showDays: boolean;
}) {
  const daysLabel = showDays
    ? `, ${item.days} day${item.days === 1 ? '' : 's'}`
    : '';

  return (
    <View
      accessible
      accessibilityLabel={`Rank ${item.rank}, ${item.display_name}, score ${item.score}${daysLabel}`}
      style={[styles.rankingRow, item.rank <= 3 && styles.topRankingRow]}
    >
      <Text style={styles.rank}>{item.rank}</Text>
      <Text style={styles.player} numberOfLines={1}>{item.display_name}</Text>
      <Text style={styles.score}>{item.score}</Text>
      {showDays ? <Text style={styles.days}>{item.days}</Text> : null}
    </View>
  );
}

export default function LeaderboardScreen() {
  const params = useLocalSearchParams<{ environment?: string; period?: string }>();
  const requestedEnvironment = typeof params.environment === 'string' ? params.environment : 'mixed';
  const requestedPeriod = typeof params.period === 'string' ? params.period : 'daily';
  const deepLinkEnvironment = isDailyEnvironment(requestedEnvironment) ? requestedEnvironment : 'mixed';
  const deepLinkPeriod = isLeaderboardPeriod(requestedPeriod) ? requestedPeriod : 'daily';
  const [period, setPeriod] = useState<LeaderboardPeriod>(deepLinkPeriod);
  const [environment, setEnvironment] = useState<DailyEnvironment>(deepLinkEnvironment);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setEnvironment((current) => current === deepLinkEnvironment ? current : deepLinkEnvironment);
      setPeriod((current) => current === deepLinkPeriod ? current : deepLinkPeriod);
    }, 0);
    return () => clearTimeout(timer);
  }, [deepLinkEnvironment, deepLinkPeriod]);

  useEffect(() => {
    const id = ++requestId.current;
    void loadDraftRunLeaderboard(period, environment)
      .then((data) => {
        if (id === requestId.current) setState({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (id !== requestId.current) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Leaderboard is unavailable.',
        });
      })
      .finally(() => {
        if (id === requestId.current) setRefreshing(false);
      });
    return () => {
      requestId.current += 1;
    };
  }, [environment, period, reloadKey]);

  const selectEnvironment = (next: DailyEnvironment) => {
    if (next === environment) return;
    setState({ status: 'loading' });
    setEnvironment(next);
  };

  const selectPeriod = (next: LeaderboardPeriod) => {
    if (next === period) return;
    setState({ status: 'loading' });
    setPeriod(next);
  };

  const retry = () => {
    setState({ status: 'loading' });
    setReloadKey((value) => value + 1);
  };

  const refresh = () => {
    setRefreshing(true);
    setReloadKey((value) => value + 1);
  };

  const showDays = period !== 'daily';

  const header = (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>LEADERBOARD</Text>
      <Text style={styles.title}>See how the field drafted.</Text>
      <Text style={styles.body}>Ranked scores come from signed-in Pack One Daily runs.</Text>

      <View style={styles.filterGroup}>
        <Text style={styles.filterLabel}>RUN</Text>
        <View style={styles.filterRow}>
          {DAILY_ENVIRONMENTS.map((id) => (
            <FilterButton
              key={id}
              active={environment === id}
              label={DAILY_ENVIRONMENT_META[id].title}
              onPress={() => selectEnvironment(id)}
            />
          ))}
        </View>
      </View>

      <View style={styles.filterGroup}>
        <Text style={styles.filterLabel}>PERIOD</Text>
        <View style={styles.filterRow}>
          {periods.map((item) => (
            <FilterButton
              key={item.id}
              active={period === item.id}
              label={item.label}
              onPress={() => selectPeriod(item.id)}
            />
          ))}
        </View>
      </View>

      {state.status === 'ready' ? (
        <>
          <Text style={styles.range}>
            {state.data.start === state.data.today
              ? state.data.today
              : `${state.data.start} – ${state.data.today}`}
          </Text>
          <View style={styles.tableHeader}>
            <Text style={styles.rankHeader}>#</Text>
            <Text style={styles.playerHeader}>PLAYER</Text>
            <Text style={styles.scoreHeader}>SCORE</Text>
            {showDays ? <Text style={styles.daysHeader}>DAYS</Text> : null}
          </View>
        </>
      ) : null}
    </View>
  );

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator accessibilityLabel="Loading leaderboard" color={colors.accent} />
          <Text style={styles.body}>Loading rankings…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        {header}
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Couldn&apos;t load the leaderboard</Text>
          <Text style={styles.body}>{state.message}</Text>
          <Pressable accessibilityRole="button" onPress={retry} style={styles.retryButton}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={state.data.rows}
        keyExtractor={(item) => item.profile_key ?? `${item.rank}:${item.display_name}`}
        renderItem={({ item }) => <RankingRow item={item} showDays={showDays} />}
        ListHeaderComponent={header}
        ListEmptyComponent={(
          <Text style={styles.empty}>
            No ranked {DAILY_ENVIRONMENT_META[environment].title} scores in this view yet.
          </Text>
        )}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={refresh}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  list: { paddingBottom: spacing.xxl },
  header: { padding: spacing.lg, gap: spacing.md },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 32, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  filterGroup: { gap: spacing.xs },
  filterLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterButton: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  filterText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  filterTextActive: { color: colors.accentDark },
  range: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: colors.lineStrong,
    paddingBottom: spacing.sm,
  },
  rankHeader: { width: 42, color: colors.muted, fontSize: 10, fontWeight: '800' },
  playerHeader: { flex: 1, color: colors.muted, fontSize: 10, fontWeight: '800' },
  scoreHeader: { width: 64, textAlign: 'right', color: colors.muted, fontSize: 10, fontWeight: '800' },
  daysHeader: { width: 52, textAlign: 'right', color: colors.muted, fontSize: 10, fontWeight: '800' },
  rankingRow: {
    minHeight: 54,
    marginHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  topRankingRow: { borderLeftWidth: 3, borderLeftColor: colors.accent },
  rank: { width: 39, color: colors.ink, fontSize: 16, fontWeight: '800' },
  player: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: '700' },
  score: { width: 64, textAlign: 'right', color: colors.ink, fontSize: 16, fontWeight: '800' },
  days: { width: 52, textAlign: 'right', color: colors.muted, fontSize: 14 },
  center: { flex: 1, padding: spacing.xl, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  errorTitle: { color: colors.ink, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  retryButton: { minHeight: 48, backgroundColor: colors.accent, paddingHorizontal: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: colors.surface, fontSize: 15, fontWeight: '800' },
  empty: { color: colors.muted, fontSize: 15, textAlign: 'center', padding: spacing.xl },
});
