import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppResume } from '@/src/hooks/useAppResume';
import { readSession, subscribeSession, type MobileSession } from '@/src/storage/session';
import { readLatestSharedRunContinuation } from '@/src/storage/sharedRun';
import { colors, spacing } from '@/src/theme';

type State = 'loading' | 'signin' | 'empty' | 'error';

function sameSession(left: MobileSession, right: MobileSession | null) {
  return Boolean(right
    && left.playerToken === right.playerToken
    && left.accountToken === right.accountToken
    && left.subjectId === right.subjectId
    && left.accountUser?.id === right.accountUser?.id);
}

/** Local discovery only. The shared-run screen still verifies the server UUID. */
export default function ResumeSharedRunScreen() {
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const session = await readSession();
      if (request !== generation.current) return;
      if (!session?.accountToken) { setState('signin'); return; }
      const saved = await readLatestSharedRunContinuation(session);
      const current = await readSession();
      if (request !== generation.current) return;
      if (!sameSession(session, current)) {
        setError('Your account changed. Try again with your current account.');
        setState('error');
        return;
      }
      if (!saved) { setState('empty'); return; }
      // Do not put the run UUID or credentials into an incoming navigation link.
      // The destination recovers that UUID from identity-scoped SecureStore.
      router.replace({ pathname: '/shared-run', params: { shared: saved.shareId } });
    } catch (reason: unknown) {
      if (request !== generation.current) return;
      setError(reason instanceof Error ? reason.message : 'The saved run could not be read.');
      setState('error');
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]));
  useEffect(() => {
    const unsubscribe = subscribeSession(() => { void refresh(); });
    return () => { unsubscribe(); generation.current += 1; };
  }, [refresh]);
  useAppResume(refresh);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <Text style={styles.title}>Your last shared run</Text>
        {state === 'loading' ? <><ActivityIndicator /><Text style={styles.body}>Finding your saved run on this device...</Text></> : null}
        {state === 'signin' ? <>
          <Text style={styles.body}>Sign in to the same Pack One account to reopen this device&apos;s saved shared run.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={styles.button}>
            <Text style={styles.buttonText}>Sign in to recover your run</Text>
          </Pressable>
        </> : null}
        {state === 'empty' ? <Text style={styles.body}>No shared run is saved for this account on this device. Open a friend&apos;s invitation to play or recover a previous shared run.</Text> : null}
        {state === 'error' ? <>
          <Text accessibilityRole="alert" style={styles.body}>{error}</Text>
          <Text style={styles.body}>Your saved checkpoint has not been deleted. No new run has been started.</Text>
          <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.button}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { alignSelf: 'center', width: '100%', maxWidth: 760, padding: spacing.lg, gap: spacing.lg },
  title: { color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  button: { minHeight: 50, padding: spacing.md, borderWidth: 1, borderColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
});
