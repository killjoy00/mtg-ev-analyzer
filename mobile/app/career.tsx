import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import {
  loadMobileCareer,
  loadMobileCareerHistory,
  type CareerHistoryRow,
  type CareerProfile,
} from '@/src/api/career';
import { ApiError } from '@/src/api/client';
import { DAILY_ENVIRONMENT_META, isDailyEnvironment } from '@/src/api/draftRun';
import { ensureGuestSession } from '@/src/api/guest';
import { ProfileOverview } from '@/src/components/ProfileOverview';
import { useAppResume } from '@/src/hooks/useAppResume';
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

function HistoryRow({ item }: { item: CareerHistoryRow }) {
  const detail = [
    environmentLabel(item.set_id),
    item.is_daily ? 'Daily' : null,
    item.grade || null,
    item.outcome ? item.outcome.charAt(0).toUpperCase() + item.outcome.slice(1) : null,
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
  const [reloadKey, setReloadKey] = useState(0);
  const [shareError, setShareError] = useState<string | null>(null);
  const requestId = useRef(0);

  useAppResume(() => {
    setReloadKey((value) => value + 1);
  });

  const load = async () => {
    const id = ++requestId.current;
    setState({ status: 'loading' });
    try {
      const session = await ensureGuestSession();
      if (id !== requestId.current) return;
      if (!session.accountToken) {
        setState({ status: 'signed-out' });
        return;
      }
      const [profile, history] = await Promise.all([
        loadMobileCareer(session),
        loadMobileCareerHistory(session),
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
      if (error instanceof ApiError && error.status === 401) {
        setState({ status: 'signed-out' });
        return;
      }
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'My Pack One is unavailable.',
      });
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timer);
      requestId.current += 1;
    };
  }, [reloadKey]);

  const loadMore = async () => {
    if (state.status !== 'ready' || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await loadMobileCareerHistory(state.session, state.nextCursor);
      setState((current) => current.status === 'ready'
        ? {
            ...current,
            rows: [...current.rows, ...page.rows],
            nextCursor: page.next_cursor,
          }
        : current);
    } catch {
      // Keep already-loaded history visible if pagination fails.
    } finally {
      setLoadingMore(false);
    }
  };

  const shareProfile = async () => {
    if (state.status !== 'ready') return;
    setShareError(null);
    const profile = state.profile;
    const publicUrl = profile.player.profile_public && profile.player.profile_key
      ? `https://packone.pro/?profile=${encodeURIComponent(profile.player.profile_key)}`
      : null;
    const copy = publicUrl
      ? `${profile.player.display_name}'s Pack One profile\n${publicUrl}`
      : `${profile.player.display_name} on Pack One · ${profile.summary.games} games · ${Number(profile.summary.average_score || 0).toFixed(1)} average · best ${profile.summary.best_score}\nhttps://packone.pro`;
    try {
      await Share.share({ message: copy });
    } catch {
      setShareError('Could not open sharing.');
    }
  };

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator accessibilityLabel="Loading My Pack One" color={colors.accent} />
          <Text style={styles.body}>Loading My Pack One…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'signed-out') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.eyebrow}>MY PACK ONE</Text>
          <Text style={styles.title}>Sign in to see your full career.</Text>
          <Text style={styles.body}>
            Your Pack One account keeps the same scores, achievements, season standings, and history across web, iPhone, iPad, and Android.
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
          <Text style={styles.title}>Couldn&apos;t load My Pack One.</Text>
          <Text style={styles.body}>{state.message}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const header = (
    <View style={styles.header}>
      <ProfileOverview profile={state.profile} />
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => void shareProfile()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>
            {state.profile.player.profile_public ? 'Share public profile' : 'Share my record'}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Account & profile settings</Text>
        </Pressable>
      </View>
      {shareError ? <Text accessibilityRole="alert" style={styles.error}>{shareError}</Text> : null}
      <Text style={styles.sectionTitle}>Recent Games</Text>
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
  list: { paddingBottom: spacing.xxl, alignSelf: 'center', width: '100%', maxWidth: 980 },
  header: { padding: spacing.lg, gap: spacing.lg },
  center: { flex: 1, padding: spacing.xl, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 32, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7, textAlign: 'center' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '800' },
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
  secondaryButton: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: colors.accentDark, fontSize: 14, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 13 },
  empty: { color: colors.muted, fontSize: 15, textAlign: 'center', padding: spacing.xl },
  footer: { padding: spacing.lg },
});
