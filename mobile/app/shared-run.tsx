import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import DraftRunScreen from './draft-run';
import {
  createDraftRunShare,
  loadDraftRun,
  loadSharedDraftRunInfo,
  startSharedDraftRun,
  submitDraftRunPick,
  type DraftRunState,
  type SharedDraftRunInfo,
} from '@/src/api/draftRun';
import { ensureGuestSession } from '@/src/api/guest';
import { useAppResume } from '@/src/hooks/useAppResume';
import { createSharedRunRecovery, SharedRunIdentityChangedError } from '@/src/state/sharedRunRecovery';
import type { SharedRunSurface } from '@/src/state/sharedRunSurface';
import { readSession, subscribeSession, type MobileSession } from '@/src/storage/session';
import { readSharedRunContinuation, writeSharedRunContinuation } from '@/src/storage/sharedRun';
import { colors, spacing } from '@/src/theme';

type State =
  | { status: 'loading' }
  | { status: 'invite'; info: SharedDraftRunInfo; session: MobileSession }
  | { status: 'ready'; session: MobileSession; surface: SharedRunSurface; epoch: number }
  | { status: 'error'; message: string };

function sameSession(left: MobileSession, right: MobileSession | null) {
  return Boolean(right
    && left.playerToken === right.playerToken
    && left.accountToken === right.accountToken
    && left.subjectId === right.subjectId
    && left.accountUser?.id === right.accountUser?.id);
}

function SharedRunGate({ shareId }: { shareId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const stateRef = useRef<State>(state);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busyRef = useRef(false);
  const pendingAuth = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const epoch = useRef(0);
  const reloadRef = useRef<() => Promise<void>>(async () => {});
  const recovery = useMemo(() => createSharedRunRecovery({
    readSession,
    readContinuation: readSharedRunContinuation,
    writeContinuation: writeSharedRunContinuation,
    loadRun: loadDraftRun,
    startRun: (id, session) => startSharedDraftRun(session, id),
  }), []);

  const commit = useCallback((next: State) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const invalidate = useCallback(() => {
    generation.current += 1;
    epoch.current += 1;
    busyRef.current = false;
    setBusy(false);
    setMessage(null);
    commit({ status: 'loading' });
  }, [commit]);

  const makeSurface = useCallback((run: DraftRunState, session: MobileSession): SharedRunSurface => {
    const boundEpoch = epoch.current;
    const assertCurrent = async () => {
      if (!mounted.current || epoch.current !== boundEpoch) throw new SharedRunIdentityChangedError();
      const current = await readSession();
      if (!mounted.current || epoch.current !== boundEpoch) throw new SharedRunIdentityChangedError();
      if (!sameSession(session, current)) {
        invalidate();
        void reloadRef.current();
        throw new SharedRunIdentityChangedError();
      }
    };
    const checked = (value: DraftRunState) => {
      if (value.id !== run.id || value.day !== null) throw new Error('The server returned a different run. Reopen this invitation.');
      return value;
    };
    return {
      initialRun: run,
      session,
      async loadRun() {
        await assertCurrent();
        const loaded = checked(await loadDraftRun(run.id, session));
        await assertCurrent();
        return loaded;
      },
      async submitPick(currentRun, cardId) {
        checked(currentRun);
        await assertCurrent();
        const updated = checked(await submitDraftRunPick(currentRun, cardId, session));
        await assertCurrent();
        return updated;
      },
      async createShare() {
        await assertCurrent();
        const result = await createDraftRunShare(run.id, session);
        await assertCurrent();
        return result;
      },
    };
  }, [invalidate]);

  const reload = useCallback(async () => {
    if (!shareId || busyRef.current) return;
    const request = ++generation.current;
    const isCurrent = () => mounted.current && request === generation.current;
    try {
      const session = await ensureGuestSession();
      if (!isCurrent()) return;
      const previous = stateRef.current;
      if ('session' in previous && sameSession(previous.session, session)) {
        // Focus/share-sheet returns must not recreate gameplay or reset feedback.
        if (previous.status === 'ready') { setMessage(null); return; }
      } else if ('session' in previous) {
        epoch.current += 1;
        commit({ status: 'loading' });
      }
      const run = session.accountToken ? await recovery.resume(shareId, session) : null;
      if (!isCurrent()) return;
      if (run) {
        commit({ status: 'ready', session, surface: makeSurface(run, session), epoch: epoch.current });
        setMessage(null);
        return;
      }
      const info = await loadSharedDraftRunInfo(shareId, session);
      if (!isCurrent()) return;
      const persisted = await readSession();
      if (!isCurrent()) return;
      if (!sameSession(session, persisted)) throw new SharedRunIdentityChangedError();
      if (info.id !== shareId) throw new Error('The invitation did not match this shared run.');
      commit({ status: 'invite', info, session });
      setMessage(null);
    } catch (error: unknown) {
      if (!isCurrent()) return;
      const detail = error instanceof Error ? error.message : 'This shared run is unavailable.';
      if (stateRef.current.status === 'ready') setMessage(detail);
      else commit({ status: 'error', message: detail });
    }
  }, [commit, makeSurface, recovery, shareId]);
  reloadRef.current = reload;

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeSession((next) => {
      // Account stays on its normal route, including Google/Apple AuthSession
      // callbacks. Only the invitation that initiated sign-in requests a return.
      if (pendingAuth.current && next?.accountToken) {
        pendingAuth.current = false;
        router.replace({ pathname: '/shared-run', params: { shared: shareId } });
      }
      const current = stateRef.current;
      if ('session' in current && sameSession(current.session, next)) return;
      invalidate();
      void reloadRef.current();
    });
    return () => {
      unsubscribe();
      mounted.current = false;
      pendingAuth.current = false;
      generation.current += 1;
      epoch.current += 1;
    };
  }, [invalidate, shareId]);

  useFocusEffect(useCallback(() => {
    // Returning with Back cancels the old authentication-return intent.
    pendingAuth.current = false;
    void reload();
    return () => {
      generation.current += 1;
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    };
  }, [reload]));
  useAppResume(reload);

  const accept = async () => {
    const invitation = stateRef.current;
    if (invitation.status !== 'invite' || busyRef.current) return;
    if (!invitation.session.accountToken) {
      pendingAuth.current = true;
      router.push({ pathname: '/account' });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    const request = ++generation.current;
    try {
      const run = await recovery.start(shareId, invitation.session);
      if (!mounted.current || request !== generation.current) return;
      if (!run) throw new Error('The shared run could not be recovered.');
      commit({ status: 'ready', session: invitation.session, surface: makeSurface(run, invitation.session), epoch: epoch.current });
    } catch (error: unknown) {
      if (!mounted.current || request !== generation.current) return;
      if (error instanceof SharedRunIdentityChangedError) {
        invalidate();
        void reloadRef.current();
      } else setMessage(error instanceof Error ? error.message : 'This shared run could not be started.');
    } finally {
      if (mounted.current && request === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  if (!shareId) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}><Text accessibilityRole="alert" style={styles.title}>This shared-run link is invalid.</Text></View>
    </SafeAreaView>
  );

  if (state.status === 'ready') return (
    <View style={styles.safe}>
      {message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}
      <DraftRunScreen key={state.epoch} shared={state.surface} />
    </View>
  );

  if (state.status === 'loading') return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}><ActivityIndicator /><Text style={styles.body}>Recovering this shared run...</Text></View>
    </SafeAreaView>
  );

  if (state.status === 'error') return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <Text style={styles.title}>Could not recover this shared run.</Text>
        <Text accessibilityRole="alert" style={styles.body}>{state.message}</Text>
        <Text style={styles.body}>Your saved run is not discarded or replaced by a new attempt.</Text>
        <Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={styles.button}>
          <Text style={styles.buttonText}>Manage account</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.eyebrow}>{state.info.environment === 'powered-cube' ? 'SHARED POWERED CUBE' : 'SHARED DRAFT RUN'}</Text>
        <Text style={styles.title}>Play this run and compare.</Text>
        <Text style={styles.body}>{state.info.name} shared {state.info.run_length} decisions. You will see the same packs and earlier picks. Shared runs cannot be rerolled.</Text>
        <Text style={styles.score}>{state.info.name}: {state.info.score}/100</Text>
        {state.info.scores.length ? <View style={styles.scores}>
          <Text style={styles.heading}>Players on this run</Text>
          {state.info.scores.map((entry, index) => <View key={`${index}:${entry.name}`} style={styles.row}>
            <Text style={styles.body}>{entry.name}</Text><Text style={styles.heading}>{entry.score}/100</Text>
          </View>)}
        </View> : null}
        <Text style={styles.body}>{state.info.environment === 'powered-cube'
          ? 'Powered Cube practice access is required. Your account access is checked by Pack One.'
          : 'A free Pack One account includes regular Draft Run practice.'}</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void accept()} style={[styles.button, busy && styles.disabled]}>
          <Text style={styles.buttonText}>{busy ? 'Recovering your run...' : state.session.accountToken ? 'Play or resume this run' : 'Sign in to play this run'}</Text>
        </Pressable>
        {message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function SharedRunScreen() {
  const params = useLocalSearchParams<{ shared?: string }>();
  const shareId = typeof params.shared === 'string' && /^[a-f0-9]{24}$/.test(params.shared) ? params.shared : '';
  return <SharedRunGate key={shareId || 'invalid'} shareId={shareId} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { alignSelf: 'center', width: '100%', maxWidth: 760, padding: spacing.lg, gap: spacing.lg },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23, flexShrink: 1 },
  score: { color: colors.ink, fontSize: 24, fontWeight: '800' },
  heading: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  scores: { gap: spacing.md, padding: spacing.md, backgroundColor: colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  button: { minHeight: 50, padding: spacing.md, borderWidth: 1, borderColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 21 },
});
