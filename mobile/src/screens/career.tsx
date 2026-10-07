import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Share, StyleSheet, View } from 'react-native';
import { Text } from '@/src/components/Text';
import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';
import { AboutLink } from '@/src/components/AboutLink';

import { loadMobileCareer, loadMobileCareerHistory, type CareerHistoryRow, type CareerProfile } from '@/src/api/career';
import { ApiError } from '@/src/api/client';
import { DAILY_ENVIRONMENT_META, isDailyEnvironment } from '@/src/api/draftRun';
import { ensureGuestSession } from '@/src/api/guest';
import { ProfileOverview } from '@/src/components/ProfileOverview';
import { useAppResume } from '@/src/hooks/useAppResume';
import { readSession, subscribeSession, type MobileSession } from '@/src/storage/session';
import { colors, spacing } from '@/src/theme';
import { config } from '@/src/config';

type LoadState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  | { status: 'ready'; session: MobileSession; profile: CareerProfile; rows: CareerHistoryRow[]; nextCursor: string | null };

function mobileSessionIdentity(session: MobileSession) {
  return JSON.stringify([session.playerToken, session.accountToken ?? '', session.subjectId ?? '', session.accountUser?.id ?? '']);
}

function environmentLabel(value: string) {
  return isDailyEnvironment(value) ? DAILY_ENVIRONMENT_META[value].title : value.toUpperCase();
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function HistoryRow({ item }: { item: CareerHistoryRow }) {
  const detail = [environmentLabel(item.set_id), item.is_daily ? 'Daily' : null,
    item.grade || null, item.outcome || null].filter(Boolean).join(' \u00b7 ');
  return (
    <View accessible accessibilityLabel={`${formatDate(item.played_at)}, ${detail}, score ${item.score}`} style={styles.historyRow}>
      <View style={styles.historyCopy}>
        <Text style={styles.historyDate}>{formatDate(item.played_at)}</Text>
        <Text style={styles.historyMeta}>{detail}</Text>
      </View>
      <Text style={styles.historyScore}>{item.score}</Text>
    </View>
  );
}

export default function CareerScreen() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const stateRef = useRef<LoadState>(state);
  const ownerRef = useRef<string | null>(null);
  const requestId = useRef(0);
  const paginationRequestId = useRef(0);
  const paginationBusy = useRef(false);
  const refreshingRef = useRef(false);
  const usedCursors = useRef(new Set<string>());
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const commitState = useCallback((next: LoadState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Invalidate every outstanding operation before removing private data. This
  // also runs for a locked/unreadable secure store: unknown identity is not A.
  const clearPrivateState = useCallback((next: MobileSession | null | undefined) => {
    requestId.current += 1;
    paginationRequestId.current += 1;
    paginationBusy.current = false;
    refreshingRef.current = false;
    ownerRef.current = null;
    usedCursors.current.clear();
    setLoadingMore(false);
    setRefreshing(false);
    setRefreshError(null);
    setPageError(null);
    setShareError(null);
    commitState(next !== undefined && !next?.accountToken ? { status: 'signed-out' } : {
      status: 'error',
      message: next === undefined
        ? 'Your account could not be verified. Unlock your device and try again.'
        : 'Your account changed. Reload My Pack One for the current account.',
    });
  }, [commitState]);

  const verifyOwner = useCallback(async (expected: MobileSession, current: () => boolean) => {
    let persisted: MobileSession | null;
    try { persisted = await readSession(); }
    catch {
      if (current()) clearPrivateState(undefined);
      return false;
    }
    if (!current()) return false;
    if (!persisted?.accountToken || mobileSessionIdentity(persisted) !== mobileSessionIdentity(expected)) {
      clearPrivateState(persisted);
      return false;
    }
    return true;
  }, [clearPrivateState]);

  const load = useCallback(async (preserveLoaded = true) => {
    const id = ++requestId.current;
    const current = () => id === requestId.current;
    paginationRequestId.current += 1;
    paginationBusy.current = false;
    refreshingRef.current = true;
    usedCursors.current.clear();
    setLoadingMore(false);
    setRefreshing(true);
    setRefreshError(null);
    setPageError(null);
    setShareError(null);
    if (!preserveLoaded || stateRef.current.status !== 'ready') commitState({ status: 'loading' });
    let session: MobileSession | null = null;
    try {
      session = await ensureGuestSession();
      if (!current()) return;
      if (!session.accountToken) { clearPrivateState(session); return; }
      const identity = mobileSessionIdentity(session);
      const previous = stateRef.current;
      if (previous.status === 'ready' && mobileSessionIdentity(previous.session) !== identity) {
        // Clear A before asking for B. In particular, a failed B request may
        // never fall back to A's profile, rows, cursor, or sharing controls.
        commitState({ status: 'loading' });
      }
      ownerRef.current = identity;
      const [profile, history] = await Promise.all([loadMobileCareer(session), loadMobileCareerHistory(session)]);
      if (!await verifyOwner(session, current)) return;
      commitState({ status: 'ready', session, profile, rows: history.rows, nextCursor: history.next_cursor });
    } catch (error: unknown) {
      if (!current()) return;
      if (!session || !await verifyOwner(session, current)) {
        if (!session && current()) clearPrivateState(undefined);
        return;
      }
      if (error instanceof ApiError && [401, 403].includes(error.status)) { clearPrivateState(null); return; }
      const message = error instanceof Error ? error.message : 'My Pack One is unavailable.';
      const previous = stateRef.current;
      if (preserveLoaded && previous.status === 'ready'
        && mobileSessionIdentity(previous.session) === mobileSessionIdentity(session)) setRefreshError(message);
      else commitState({ status: 'error', message });
    } finally {
      if (current()) { refreshingRef.current = false; setRefreshing(false); }
    }
  }, [clearPrivateState, commitState, verifyOwner]);

  useEffect(() => subscribeSession((next) => {
    const identity = next?.accountToken ? mobileSessionIdentity(next) : null;
    if (identity === ownerRef.current) return;
    clearPrivateState(next);
    if (identity) void load(false);
  }), [clearPrivateState, load]);

  useFocusEffect(useCallback(() => {
    void load(true);
    return () => {
      requestId.current += 1;
      paginationRequestId.current += 1;
      paginationBusy.current = false;
      refreshingRef.current = false;
      setLoadingMore(false);
    };
  }, [load]));
  useAppResume(() => load(true));

  const loadMore = async () => {
    const previous = stateRef.current;
    if (previous.status !== 'ready' || !previous.nextCursor || paginationBusy.current || refreshingRef.current) return;
    const cursor = previous.nextCursor;
    const id = ++paginationRequestId.current;
    const generation = requestId.current;
    const current = () => id === paginationRequestId.current && generation === requestId.current;
    paginationBusy.current = true;
    setLoadingMore(true);
    setPageError(null);
    try {
      if (!await verifyOwner(previous.session, current)) return;
      const page = await loadMobileCareerHistory(previous.session, cursor);
      if (!await verifyOwner(previous.session, current)) return;
      const latest = stateRef.current;
      if (latest.status !== 'ready' || latest.nextCursor !== cursor) return;
      const seen = new Set(latest.rows.map((row) => row.cursor));
      const added = page.rows.filter((row) => {
        if (seen.has(row.cursor)) return false;
        seen.add(row.cursor);
        return true;
      });
      usedCursors.current.add(cursor);
      const repeated = page.next_cursor !== null && usedCursors.current.has(page.next_cursor);
      commitState({ ...latest, rows: [...latest.rows, ...added], nextCursor: repeated ? null : page.next_cursor });
      if (repeated) setPageError('History changed while loading. Refresh My Pack One to reload it.');
    } catch (error: unknown) {
      if (!current()) return;
      if (!await verifyOwner(previous.session, current)) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) { clearPrivateState(null); return; }
      setPageError(error instanceof Error ? error.message : 'More history could not be loaded. Try again.');
    } finally {
      if (current()) { paginationBusy.current = false; setLoadingMore(false); }
    }
  };

  const shareProfile = async () => {
    const previous = stateRef.current;
    if (previous.status !== 'ready' || refreshingRef.current) return;
    const generation = requestId.current;
    const current = () => generation === requestId.current;
    setShareError(null);
    if (!await verifyOwner(previous.session, current)) return;
    const profile = previous.profile;
    const key = profile.player.profile_key;
    const publicUrl = profile.player.profile_public && key && /^[a-f0-9]{16}$/.test(key)
      ? `https://packone.pro/?profile=${key}` : null;
    const copy = publicUrl ? `${profile.player.display_name}'s Pack One profile\n${publicUrl}`
      : `${profile.player.display_name} on Pack One \u00b7 ${profile.summary.games} games \u00b7 ${Number(profile.summary.average_score || 0).toFixed(1)} average \u00b7 best ${profile.summary.best_score}\nhttps://packone.pro`;
    try { await Share.share({ message: copy }); }
    catch { if (current()) setShareError('Could not open sharing.'); }
  };

  if (state.status !== 'ready') return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        {state.status === 'loading' ? <>
          <ActivityIndicator accessibilityLabel="Loading My Pack One" color={colors.accent} />
          <Text style={styles.body}>Loading My Pack One...</Text>
        </> : state.status === 'signed-out' ? <>
          <Text style={styles.eyebrow}>MY PACK ONE</Text>
          <Text style={styles.title}>Welcome to My Pack One.</Text>
          <Text style={styles.body}>Play your first Daily to start your record. Your scores, streaks, achievements, and history will appear here as you play.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Play Daily" onPress={() => router.push('/')} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Play Daily</Text>
          </Pressable>
          <Text style={styles.body}>Want to keep this record across devices?</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Sign in or create an account</Text>
          </Pressable>
        </> : <>
          <Text style={styles.title}>Couldn&apos;t load My Pack One.</Text>
          <Text accessibilityRole="alert" style={styles.body}>{state.message}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load(false)} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
        </>}
      </View>
    </SafeAreaView>
  );

  const firstRun = Number(state.profile.summary.games || 0) === 0;
  const header = (
    <View style={styles.header} onLayout={() => { if (config.screenshots.fixtures) console.info('PACKONE_CAREER_READY', JSON.stringify({ firstRun })); }}>
      <View accessibilityLabel="My Pack One sections" style={styles.modeTabs}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: true }} style={[styles.modeTab, styles.modeTabActive]}>
          <Text style={[styles.modeTabText, styles.modeTabTextActive]}>Stats</Text>
        </Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: false }} onPress={() => router.push('/account')} style={styles.modeTab}>
          <Text style={styles.modeTabText}>Account settings</Text>
        </Pressable>
      </View>
      {firstRun ? (
        <View style={styles.firstRunCard}>
          <Text style={styles.eyebrow}>WELCOME TO MY PACK ONE</Text>
          <Text style={styles.firstRunTitle}>Start with today&apos;s Daily.</Text>
          <Text style={styles.firstRunBody}>Your real scores, streaks, environments, achievements, and history will appear here after you play.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Play Daily" onPress={() => router.push('/')} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Play Daily</Text>
          </Pressable>
        </View>
      ) : <ProfileOverview profile={state.profile} />}
      {refreshing ? <Text style={styles.refreshing}>Refreshing My Pack One...</Text> : null}
      {refreshError ? <Text accessibilityRole="alert" style={styles.error}>{refreshError}</Text> : null}
      <View style={styles.actions}>
        {!firstRun ? <Pressable accessibilityRole="button" accessibilityLabel="Share Pack One profile or record" disabled={refreshing}
          onPress={() => void shareProfile()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{state.profile.player.profile_public ? 'Share public profile' : 'Share my record'}</Text>
        </Pressable> : null}
        <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Account settings</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={refreshing} onPress={() => void load()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Refresh My Pack One</Text>
        </Pressable>
      </View>
      {shareError ? <Text accessibilityRole="alert" style={styles.error}>{shareError}</Text> : null}
      {!firstRun ? <Text style={styles.sectionTitle}>Recent Games</Text> : null}
    </View>
  );
  const footer = (
    <View style={styles.footer}>
      {loadingMore ? <ActivityIndicator accessibilityLabel="Loading more games" color={colors.accent} /> : null}
      {pageError ? <Text accessibilityRole="alert" style={styles.error}>{pageError}</Text> : null}
      {state.nextCursor ? <Pressable accessibilityRole="button" disabled={loadingMore || refreshing}
        onPress={() => void loadMore()} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>{pageError ? 'Retry history' : 'Load more games'}</Text>
      </Pressable> : null}
      <AboutLink />
    </View>
  );
  return (
    <SafeAreaView style={styles.safe}>
      <FlatList data={state.rows} keyExtractor={(item) => item.cursor} renderItem={({ item }) => <HistoryRow item={item} />}
        ListHeaderComponent={header} ListEmptyComponent={firstRun ? null : <Text style={styles.empty}>No completed Pack One games yet.</Text>}
        ListFooterComponent={footer} contentContainerStyle={styles.list} refreshing={refreshing} onRefresh={() => void load()}
        onEndReached={() => { if (!pageError) void loadMore(); }} onEndReachedThreshold={0.35} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  list: { paddingBottom: spacing.xxl, alignSelf: 'center', width: '100%', maxWidth: 980 },
  header: { padding: spacing.lg, gap: spacing.lg },
  modeTabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line },
  modeTab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  modeTabActive: { borderBottomWidth: 3, borderColor: colors.accent },
  modeTabText: { color: colors.muted, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  modeTabTextActive: { color: colors.ink },
  firstRunCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.xl, gap: spacing.md },
  firstRunTitle: { color: colors.ink, fontSize: 28, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5 },
  firstRunBody: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  center: { flex: 1, padding: spacing.xl, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  title: { color: colors.ink, fontSize: 32, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7, textAlign: 'center' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '800' },
  historyRow: { minHeight: 68, marginHorizontal: spacing.lg, borderBottomWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.md },
  historyCopy: { flex: 1, gap: 3 },
  historyDate: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  historyMeta: { color: colors.muted, fontSize: 12 },
  historyScore: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  primaryButton: { minHeight: 50, backgroundColor: colors.accent, paddingHorizontal: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: colors.surface, fontSize: 15, fontWeight: '800' },
  secondaryButton: { minHeight: 46, borderWidth: 1, borderColor: colors.accent, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: colors.accentDark, fontSize: 14, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 13 },
  refreshing: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  empty: { color: colors.muted, fontSize: 15, textAlign: 'center', padding: spacing.xl },
  footer: { padding: spacing.lg, gap: spacing.md },
});
