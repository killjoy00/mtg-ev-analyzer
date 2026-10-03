import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { loadDraftRun } from '@/src/api/draftRun';
import { Text } from '@/src/components/Text';
import { useAppResume } from '@/src/hooks/useAppResume';
import { readSession, subscribeSession, type MobileSession } from '@/src/storage/session';
import { readLatestSharedRunContinuation } from '@/src/storage/sharedRun';
import { colors, spacing } from '@/src/theme';

type State = { kind: 'checking' | 'empty' | 'error' } | { kind: 'ready'; complete: boolean };
const identity = (s: MobileSession | null) => s ? `${s.playerToken}:${s.accountToken}:${s.accountUser?.id}` : '';

/** Local checkpoint discovery never POSTs an invitation or replaces an attempt. */
export function SharedRunRecovery() {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++generation.current;
    setState({ kind: 'checking' });
    try {
      const session = await readSession();
      const saved = session ? await readLatestSharedRunContinuation(session) : null;
      if (id !== generation.current) return;
      if (!session?.accountToken || !saved) { setState({ kind: 'empty' }); return; }
      const run = await loadDraftRun(saved.runId, session);
      if (id !== generation.current || identity(session) !== identity(await readSession())) return;
      if (run.id !== saved.runId) throw new Error('Unexpected saved run.');
      setState({ kind: 'ready', complete: run.complete });
    } catch {
      if (id === generation.current) setState({ kind: 'error' });
    }
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); return () => { generation.current += 1; }; }, [refresh]));
  useEffect(() => subscribeSession(() => { generation.current += 1; setState({ kind: 'checking' }); void refresh(); }), [refresh]);
  useAppResume(refresh);
  return <View style={styles.panel}>
    <Text style={styles.title}>Shared activity</Text>
    <Text style={styles.body}>{state.kind === 'ready'
      ? 'Saved on this device for your account. Your full shared-run record is in My Pack One.'
      : state.kind === 'empty' ? 'No shared run is saved for this account on this device. Open a friend’s invitation to play.'
        : state.kind === 'checking' ? 'Checking this device’s saved shared run…'
          : 'Could not check your saved shared run. Your checkpoint is retained; retry to reopen the same attempt.'}</Text>
    {state.kind === 'ready' ? <Pressable accessibilityRole="button" onPress={() => router.push('/resume-shared-run')} style={styles.button}>
      <Text style={styles.action}>{state.complete ? 'View shared result' : 'Continue shared run'}</Text>
    </Pressable> : null}
    {state.kind === 'error' ? <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.button}><Text style={styles.action}>Retry shared activity</Text></Pressable> : null}
  </View>;
}
const styles = StyleSheet.create({
  panel: { padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  title: { color: colors.ink, fontSize: 24, fontWeight: '700' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  button: { minHeight: 48, justifyContent: 'center' },
  action: { color: colors.accentDark, fontSize: 16, fontWeight: '700' },
});
