import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '@/src/components/Text';

import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';

import {
  loadPracticeCapabilities,
  loadPracticeSets,
  type PracticeSet,
} from '@/src/api/draftRun';
import { ensureGuestSession } from '@/src/api/guest';
import { readSession, subscribeSession } from '@/src/storage/session';
import { SharedRunRecovery } from '@/src/components/SharedRunRecovery';
import { useAppResume } from '@/src/hooks/useAppResume';
import { colors, spacing } from '@/src/theme';

type PracticeState =
  | { status: 'loading' }
  | { status: 'signin-required' }
  | { status: 'ready'; capabilities: string[]; sets: PracticeSet[] }
  | { status: 'error'; message: string };

export default function PracticeScreen() {
  const [state, setState] = useState<PracticeState>({ status: 'loading' });
  const [selectedSets, setSelectedSets] = useState<string[]>([]);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const generation = useRef(0);
  const owner = useRef('');
  const refresh = useCallback(async () => {
    const id = ++generation.current;
    try {
      const session = await ensureGuestSession();
      if (id !== generation.current) return;
      const key = `${session.playerToken}:${session.accountToken ?? ''}`;
      if (key !== owner.current) {
        owner.current = key;
        setState({ status: 'loading' });
        setSelectedSets([]);
      }
      if (!session.accountToken) { setState({ status: 'signin-required' }); return; }
      const { capabilities } = await loadPracticeCapabilities(session);
      const sets = capabilities.includes('custom_corpus') ? (await loadPracticeSets(session)).sets : [];
      const current = await readSession();
      if (id !== generation.current || key !== `${current?.playerToken}:${current?.accountToken ?? ''}`) return;
      setState({ status: 'ready', capabilities, sets });
      setSelectedSets((current) => current.filter((id) => sets.some((set) => set.set_id === id)));
      setRefreshError(null);
    } catch {
      if (id !== generation.current) return;
      const message = 'Practice options could not refresh. Please try again.';
      setRefreshError(message);
      setState((current) => current.status === 'ready' ? current : { status: 'error', message });
    }
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); return () => { generation.current += 1; }; }, [refresh]));
  useEffect(() => subscribeSession(() => {
    generation.current += 1;
    owner.current = '';
    setState({ status: 'loading' });
    setSelectedSets([]);
    setRefreshError(null);
    void refresh();
  }), [refresh]);
  useAppResume(refresh);
  const retry = refresh;

  const toggleSet = (setId: string) => {
    setSelectedSets((current) => (
      current.includes(setId)
        ? current.filter((id) => id !== setId)
        : [...current, setId]
    ));
  };

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.centerBody}>Loading practice options…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'signin-required') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.eyebrow}>PRACTICE</Text>
          <Text style={styles.centerTitle}>Keep drafting with a free account.</Text>
          <Text style={styles.centerBody}>A free Pack One account unlocks unlimited regular Draft Run practice.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/account', params: { returnTo: 'practice' } })}
            style={styles.primaryButton}
          >
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
          <Text style={styles.centerTitle}>Couldn&apos;t load practice.</Text>
          <Text style={styles.centerBody}>{state.message}</Text>
          <Pressable accessibilityRole="button" onPress={() => void retry()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const regularUnlocked = state.capabilities.includes('unlimited_regular_practice');
  const cubeUnlocked = state.capabilities.includes('unlimited_cube_practice');
  const customUnlocked = state.capabilities.includes('custom_corpus');
  const orderedSets = [...state.sets].sort((a, b) => (
    String(b.release_date ?? '').localeCompare(String(a.release_date ?? ''))
      || a.set_name.localeCompare(b.set_name)
  ));

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>PRACTICE</Text>
          <Text style={styles.title}>Choose your Draft Run.</Text>
          <Text style={styles.body}>
            Build confidence with eight real draft decisions. Practice results save to your career; Daily runs are where you compete on the leaderboard.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start regular Draft Run practice"
          accessibilityState={{ disabled: !regularUnlocked }}
          disabled={!regularUnlocked}
          onPress={() => router.push({
            pathname: '/draft-run',
            params: { mode: 'practice', environment: 'mixed' },
          })}
          style={({ pressed }) => [
            styles.optionCard,
            !regularUnlocked && styles.lockedCard,
            pressed && regularUnlocked && styles.pressed,
          ]}
        >
          <Text style={styles.cardKicker}>FREE ACCOUNT</Text>
          <Text style={styles.cardTitle}>Regular Draft Run</Text>
          <Text style={styles.body}>Unlimited mixed-set practice with one new-set reroll and one new-pack reroll.</Text>
          <Text style={regularUnlocked ? styles.cardAction : styles.lockedText}>
            {regularUnlocked ? 'Start practice →' : 'Sign in again to refresh access'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start Powered Cube practice"
          accessibilityState={{ disabled: !cubeUnlocked }}
          disabled={!cubeUnlocked}
          onPress={() => router.push({
            pathname: '/draft-run',
            params: { mode: 'practice', environment: 'powered-cube' },
          })}
          style={({ pressed }) => [
            styles.optionCard,
            !cubeUnlocked && styles.lockedCard,
            pressed && cubeUnlocked && styles.pressed,
          ]}
        >
          <Text style={styles.cardKicker}>ADDITIONAL PRACTICE</Text>
          <Text style={styles.cardTitle}>Powered Cube</Text>
          <Text style={styles.body}>Unlimited Powered Cube practice with two new-pack rerolls.</Text>
          <Text style={cubeUnlocked ? styles.cardAction : styles.lockedText}>
            {cubeUnlocked ? 'Start Powered Cube →' : 'Additional account access required'}
          </Text>
        </Pressable>

        <View style={[styles.optionCard, !customUnlocked && styles.lockedCard]}>
          <Text style={styles.cardKicker}>ADDITIONAL PRACTICE</Text>
          <Text style={styles.cardTitle}>Choose your sets</Text>
          <Text style={styles.body}>Build an eight-pick practice run from the live sets you select.</Text>

          {customUnlocked ? (
            <>
              <View style={styles.setGrid}>
                {orderedSets.map((set) => {
                  const selected = selectedSets.includes(set.set_id);
                  return (
                    <Pressable
                      key={set.set_id}
                      accessibilityRole="button"
                      accessibilityLabel={(selected ? 'Remove ' : 'Add ') + set.set_name}
                      accessibilityState={{ selected }}
                      onPress={() => toggleSet(set.set_id)}
                      style={[styles.setButton, selected && styles.setButtonSelected]}
                    >
                      <Text style={[styles.setCode, selected && styles.setCodeSelected]}>{set.set_id.toUpperCase()}</Text>
                      <Text style={[styles.setName, selected && styles.setNameSelected]} >{set.set_name}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.selectionMeta}>
                {selectedSets.length
                  ? `${selectedSets.length} set${selectedSets.length === 1 ? '' : 's'} selected`
                  : 'Choose at least one set.'}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={!selectedSets.length}
                onPress={() => router.push({
                  pathname: '/draft-run',
                  params: {
                    mode: 'practice',
                    environment: 'mixed',
                    setIds: selectedSets.join(','),
                  },
                })}
                style={[styles.primaryButton, !selectedSets.length && styles.disabled]}
              >
                <Text style={styles.primaryButtonText}>Start custom practice</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.lockedText}>Additional account access required</Text>
          )}
        </View>

        <SharedRunRecovery />
        {refreshError ? <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.note}><Text style={styles.body}>{refreshError}</Text><Text style={styles.cardAction}>Retry</Text></Pressable> : null}
        <View style={styles.note}>
          <Text style={styles.noteTitle}>Your practice access</Text>
          <Text style={styles.body}>
            A free account includes regular Draft Runs. Elite adds Powered Cube and custom-set practice.
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/membership')} style={styles.secondaryButton}><Text style={styles.cardAction}>Membership & access →</Text></Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  secondaryButton: { minHeight: 48, justifyContent: 'center' },
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg, alignSelf: 'center', width: '100%', maxWidth: 860 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  hero: { gap: spacing.sm, paddingTop: spacing.sm },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 34, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8 },
  centerTitle: { color: colors.ink, fontSize: 30, lineHeight: 34, fontWeight: '800', textAlign: 'center' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  centerBody: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  optionCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  lockedCard: { opacity: 0.7 },
  pressed: { opacity: 0.78 },
  cardKicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  cardTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  cardAction: { color: colors.accentDark, fontSize: 15, fontWeight: '800', marginTop: spacing.xs },
  lockedText: { color: colors.muted, fontSize: 14, fontWeight: '800', marginTop: spacing.xs },
  setGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  setButton: {
    flexBasis: 150, flexGrow: 1, flexShrink: 1, minWidth: 0,
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  setButtonSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  setCode: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  setCodeSelected: { color: colors.accentDark },
  setName: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: '700' },
  setNameSelected: { color: colors.accentDark },
  selectionMeta: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  primaryButton: {
    minHeight: 52,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.42 },
  note: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.lg, gap: spacing.xs },
  noteTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
});
