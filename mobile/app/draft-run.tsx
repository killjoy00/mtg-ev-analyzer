import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { loadDraftRunHealth, type DraftRunHealth } from '@/src/api/draftRun';
import { colors, spacing } from '@/src/theme';

type State =
  | { status: 'loading' }
  | { status: 'ready'; health: DraftRunHealth }
  | { status: 'error'; message: string };

export default function DraftRunScreen() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    loadDraftRunHealth()
      .then((health) => {
        if (active) setState({ status: 'ready', health });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Draft Run service is unavailable.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <Text style={styles.eyebrow}>GUEST VERTICAL SLICE</Text>
        <Text style={styles.title}>Draft Run</Text>
        <Text style={styles.body}>
          This route deliberately starts with a read-only service check. Guest identity and score mutations will be wired only after their retry and idempotency contract is verified.
        </Text>

        <View style={styles.status}>
          {state.status === 'loading' && (
            <>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.statusText}>Checking Pack One service…</Text>
            </>
          )}
          {state.status === 'ready' && (
            <>
              <Text style={styles.statusStrong}>Service connected</Text>
              <Text style={styles.statusText}>
                {state.health.service ?? 'draft-run'} · {state.health.run_length ?? 8} decisions
              </Text>
            </>
          )}
          {state.status === 'error' && (
            <>
              <Text style={styles.errorTitle}>Service check failed</Text>
              <Text style={styles.statusText}>{state.message}</Text>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { flex: 1, padding: spacing.lg, gap: spacing.md },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 38, lineHeight: 40, fontWeight: '800', letterSpacing: -1 },
  body: { color: colors.muted, fontSize: 16, lineHeight: 24 },
  status: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  statusStrong: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  errorTitle: { color: colors.danger, fontSize: 17, fontWeight: '800' },
  statusText: { color: colors.muted, fontSize: 14, lineHeight: 20 },
});
