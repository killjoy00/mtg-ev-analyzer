import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CareerHistoryRow, CareerProfile } from '@/src/api/career';
import { ApiError } from '@/src/api/client';
import { DAILY_ENVIRONMENT_META, isDailyEnvironment } from '@/src/api/draftRun';
import { InvalidPublicProfileError, loadPublicProfile, loadPublicProfileHistory, publicProfileUrl } from '@/src/api/publicProfile';
import { ProfileOverview } from '@/src/components/ProfileOverview';
import { useAppResume } from '@/src/hooks/useAppResume';
import { colors, spacing } from '@/src/theme';

type State = {
  phase: 'loading' | 'ready' | 'error';
  profile: CareerProfile | null;
  rows: CareerHistoryRow[];
  nextCursor: string | null;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  pageError: string | null;
  canRetryHistory: boolean;
};
const initial: State = { phase: 'loading', profile: null, rows: [], nextCursor: null,
  refreshing: false, loadingMore: false, error: null, pageError: null, canRetryHistory: false };

function unavailable(error: unknown) {
  return error instanceof InvalidPublicProfileError
    || (error instanceof ApiError && [401, 403, 404, 410].includes(error.status));
}
function detail(error: unknown) { return error instanceof Error ? error.message : 'This public profile is unavailable.'; }
function environment(value: string) { return isDailyEnvironment(value) ? DAILY_ENVIRONMENT_META[value].title : value.toUpperCase(); }
function mode(value: string) {
  return ({ draft_run: 'Draft Run', cube: 'Powered Cube Run', full: 'Full Pack', top3: 'Top 3' } as Record<string, string>)[value] ?? value;
}
function playedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function historyDetail(row: CareerHistoryRow) {
  return [environment(row.set_id), mode(row.mode), row.is_daily ? 'Daily' : null, row.grade, row.outcome].filter(Boolean).join(' \u00b7 ');
}

function PublicRecordDetails({ profile }: { profile: CareerProfile }) {
  const showcase = profile.achievements.find((item) => item.id === profile.player.showcase_achievement && item.unlocked);
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Player record details</Text>
      {profile.player.favorite_set_id ? <Text style={styles.body}>Favorite environment: {environment(profile.player.favorite_set_id)}</Text> : null}
      {showcase ? <Text style={styles.body}>Showcased achievement: {showcase.label}</Text> : null}
      {profile.best_final_percentile != null && profile.best_final_percentile > 0
        ? <Text style={styles.body}>Best final Daily finish: Top {profile.best_final_percentile}%</Text> : null}
      {profile.by_mode.map((entry) => <Text key={entry.mode} style={styles.body}>
        {mode(entry.mode)}: {entry.games} games{entry.games > 0 ? ` \u00b7 ${Number(entry.average_score).toFixed(1)} average \u00b7 ${entry.best_score} best` : ''}
      </Text>)}
      <Text style={styles.heading}>Played environments</Text>
      {profile.by_set.length ? profile.by_set.map((entry) => (
        <View key={entry.set_id} style={styles.recordRow}>
          <Text style={styles.rowTitle}>{environment(entry.set_id)}</Text>
          <Text style={styles.body}>{entry.games} games{entry.games > 0 ? ` \u00b7 ${Number(entry.average_score).toFixed(1)} average \u00b7 ${entry.best_score} best` : ''}</Text>
          {entry.daily_games != null ? <Text style={styles.meta}>{entry.daily_games} Daily games</Text> : null}
          {entry.last_played_at ? <Text style={styles.meta}>Last played {playedDate(entry.last_played_at)}</Text> : null}
        </View>
      )) : <Text style={styles.body}>No environment results yet.</Text>}
      <Pressable accessibilityRole="button" onPress={() => router.push('/sets')} style={styles.button}>
        <Text style={styles.buttonText}>Browse set coverage</Text>
      </Pressable>
    </View>
  );
}

function PublicProfileRecord({ profileKey }: { profileKey: string }) {
  const [state, setState] = useState<State>(initial);
  const stateRef = useRef<State>(state);
  const requestId = useRef(0);
  const pageId = useRef(0);
  const pageBusy = useRef(false);
  const usedCursors = useRef(new Set<string>());
  const retryCursor = useRef<string | null>(null);
  const shareId = useRef(0);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const commit = useCallback((next: State) => { stateRef.current = next; setState(next); }, []);

  const deny = useCallback((error: unknown) => {
    requestId.current += 1;
    pageId.current += 1;
    shareId.current += 1;
    pageBusy.current = false;
    setSharing(false);
    setShareError(null);
    // A newly private/deleted profile is not a transient refresh failure. Drop
    // every previously loaded row and the sharing surface as well as the hero.
    commit({ ...initial, phase: 'error', error: detail(error) });
  }, [commit]);

  const history = useCallback(async (cursor: string | null, generation: number) => {
    if (pageBusy.current || generation !== requestId.current || stateRef.current.phase !== 'ready') return;
    const id = ++pageId.current;
    const current = () => id === pageId.current && generation === requestId.current;
    pageBusy.current = true;
    retryCursor.current = cursor;
    commit({ ...stateRef.current, loadingMore: true, pageError: null });
    try {
      const page = await loadPublicProfileHistory(profileKey, cursor);
      if (!current()) return;
      const previous = cursor === null ? [] : stateRef.current.rows;
      const seen = new Set(previous.map((row) => row.cursor));
      const added = page.rows.filter((row) => {
        if (seen.has(row.cursor)) return false;
        seen.add(row.cursor);
        return true;
      });
      if (cursor !== null) usedCursors.current.add(cursor);
      const repeated = page.next_cursor !== null && usedCursors.current.has(page.next_cursor);
      commit({ ...stateRef.current, rows: [...previous, ...added], nextCursor: repeated ? null : page.next_cursor,
        pageError: repeated ? 'History changed while loading. Refresh the profile to reload it.' : null, canRetryHistory: false });
    } catch (error: unknown) {
      if (!current()) return;
      if (unavailable(error)) { deny(error); return; }
      commit({ ...stateRef.current, pageError: detail(error), canRetryHistory: true });
    } finally {
      if (current()) { pageBusy.current = false; commit({ ...stateRef.current, loadingMore: false }); }
    }
  }, [commit, deny, profileKey]);

  const load = useCallback(async () => {
    const generation = ++requestId.current;
    pageId.current += 1;
    shareId.current += 1;
    pageBusy.current = false;
    usedCursors.current.clear();
    setSharing(false);
    setShareError(null);
    commit({ ...(stateRef.current.profile ? stateRef.current : initial), refreshing: true, loadingMore: false, error: null, pageError: null });
    try {
      const profile = await loadPublicProfile(profileKey);
      if (generation !== requestId.current) return;
      commit({ ...initial, phase: 'ready', profile, rows: profile.recent, refreshing: true });
      await history(null, generation);
    } catch (error: unknown) {
      if (generation !== requestId.current) return;
      if (unavailable(error) || !stateRef.current.profile) { deny(error); return; }
      commit({ ...stateRef.current, error: detail(error) });
    } finally {
      if (generation === requestId.current) commit({ ...stateRef.current, refreshing: false });
    }
  }, [commit, deny, history, profileKey]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      requestId.current += 1;
      pageId.current += 1;
      shareId.current += 1;
      pageBusy.current = false;
    };
  }, [load]));
  useAppResume(load);

  const share = async () => {
    if (stateRef.current.phase !== 'ready' || stateRef.current.refreshing || sharing) return;
    const generation = requestId.current;
    const id = ++shareId.current;
    const current = () => generation === requestId.current && id === shareId.current;
    setSharing(true);
    setShareError(null);
    try {
      // Recheck the subject's public opt-in before handing a cached record to
      // the share sheet. The URL carries only the public profile key.
      const profile = await loadPublicProfile(profileKey);
      if (!current()) return;
      commit({ ...stateRef.current, profile });
      await Share.share({ message: `${profile.player.display_name}'s Pack One profile\n${publicProfileUrl(profileKey)}` });
    } catch (error: unknown) {
      if (!current()) return;
      if (unavailable(error)) deny(error);
      else setShareError('Could not verify or share this public profile. Please try again.');
    } finally { if (current()) setSharing(false); }
  };

  if (state.phase !== 'ready' || !state.profile) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        {state.phase === 'loading' ? <>
          <ActivityIndicator accessibilityLabel="Loading public profile" color={colors.accent} />
          <Text style={styles.body}>Loading player profile...</Text>
        </> : <>
          <Text style={styles.title}>Profile unavailable</Text>
          <Text accessibilityRole="alert" style={styles.body}>{state.error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.button}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </>}
      </View>
    </SafeAreaView>
  );

  const header = (
    <View style={styles.header}>
      <ProfileOverview profile={state.profile} publicView />
      <PublicRecordDetails profile={state.profile} />
      {state.refreshing ? <Text style={styles.meta}>Refreshing public profile...</Text> : null}
      {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" disabled={sharing || state.refreshing} onPress={() => void share()} style={styles.button}>
          <Text style={styles.buttonText}>{sharing ? 'Checking profile...' : 'Share public profile'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={state.refreshing} onPress={() => void load()} style={styles.button}>
          <Text style={styles.buttonText}>Refresh profile</Text>
        </Pressable>
      </View>
      <Text selectable accessibilityLabel="Public profile link" style={styles.meta}>{publicProfileUrl(profileKey)}</Text>
      {shareError ? <Text accessibilityRole="alert" style={styles.error}>{shareError}</Text> : null}
      <Text style={styles.heading}>Recent Games</Text>
    </View>
  );
  const footer = (
    <View style={styles.footer}>
      {state.loadingMore ? <ActivityIndicator accessibilityLabel="Loading public history" color={colors.accent} /> : null}
      {state.pageError ? <Text accessibilityRole="alert" style={styles.error}>{state.pageError}</Text> : null}
      {state.pageError && state.canRetryHistory ? (
        <Pressable accessibilityRole="button" disabled={state.loadingMore || state.refreshing}
          onPress={() => void history(retryCursor.current, requestId.current)} style={styles.button}>
          <Text style={styles.buttonText}>Retry history</Text>
        </Pressable>
      ) : state.nextCursor ? (
        <Pressable accessibilityRole="button" disabled={state.loadingMore || state.refreshing}
          onPress={() => void history(state.nextCursor, requestId.current)} style={styles.button}>
          <Text style={styles.buttonText}>Load more games</Text>
        </Pressable>
      ) : null}
    </View>
  );
  return (
    <SafeAreaView style={styles.safe}>
      <FlatList data={state.rows} keyExtractor={(row) => row.cursor} contentContainerStyle={styles.page}
        ListHeaderComponent={header} ListFooterComponent={footer}
        ListEmptyComponent={<Text style={styles.empty}>No completed public games yet.</Text>}
        refreshing={state.refreshing} onRefresh={() => void load()}
        onEndReached={() => { if (!state.refreshing && !state.pageError && state.nextCursor) void history(state.nextCursor, requestId.current); }}
        onEndReachedThreshold={0.35}
        renderItem={({ item }) => <View accessible accessibilityLabel={`${playedDate(item.played_at)}, ${historyDetail(item)}, score ${item.score}`} style={styles.historyRow}>
          <View style={styles.historyCopy}>
            <Text style={styles.rowTitle}>{playedDate(item.played_at)}</Text>
            <Text style={styles.meta}>{historyDetail(item)}</Text>
          </View>
          <Text style={styles.score}>{item.score}</Text>
        </View>} />
    </SafeAreaView>
  );
}

export default function PublicProfileScreen() {
  const params = useLocalSearchParams<{ key?: string }>();
  const key = typeof params.key === 'string' && /^[a-f0-9]{16}$/.test(params.key) ? params.key : null;
  if (!key) return <SafeAreaView style={styles.safe}><View style={styles.center}>
    <Text style={styles.title}>Profile unavailable</Text><Text style={styles.body}>This public profile link is invalid.</Text>
  </View></SafeAreaView>;
  // A -> B is a new browsing scope, not a refresh of A. React discards all old
  // rows/actions synchronously and effect cleanup rejects late A responses.
  return <PublicProfileRecord key={key} profileKey={key} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { paddingBottom: spacing.xxl, alignSelf: 'center', width: '100%', maxWidth: 980 },
  header: { padding: spacing.lg, gap: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  heading: { color: colors.ink, fontSize: 19, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  panel: { backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.line },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  button: { minHeight: 48, borderWidth: 1, borderColor: colors.accent, padding: spacing.md, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: colors.accentDark, fontSize: 14, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 14, lineHeight: 21 },
  meta: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  recordRow: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: 1, borderColor: colors.line },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  historyRow: { marginHorizontal: spacing.lg, minHeight: 64, padding: spacing.md, gap: spacing.md,
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.line },
  historyCopy: { flex: 1, gap: spacing.xs },
  score: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  footer: { padding: spacing.lg, gap: spacing.md },
  empty: { color: colors.muted, padding: spacing.lg, textAlign: 'center' },
});
