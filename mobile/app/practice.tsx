import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  loadPracticeCapabilities,
  loadPracticeSets,
  type PracticeSet,
} from '@/src/api/draftRun';
import { ensureGuestSession } from '@/src/api/guest';
import { colors, spacing } from '@/src/theme';

type PracticeState =
  | { status: 'loading' }
  | { status: 'signin-required' }
  | { status: 'ready'; capabilities: string[]; sets: PracticeSet[] }
  | { status: 'error'; message: string };

async function loadPracticeHub(): Promise<PracticeState> {
  const session = await ensureGuestSession();
  if (!session.accountToken) return { status: 'signin-required' };

  const { capabilities } = await loadPracticeCapabilities(session);
  const sets = capabilities.includes('custom_corpus')
    ? (await loadPracticeSets(session)).sets
    : [];

  return { status: 'ready', capabilities, sets };
}

export default function PracticeScreen() {
  const [state, setState] = useState<PracticeState>({ status: 'loading' });
  const [selectedSets, setSelectedSets] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void loadPracticeHub()
      .then((loaded) => {
        if (active) setState(loaded);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Practice options are unavailable.',
        });
      });
    return () => {
      active = false;
    };
  }, []);

  const retry = async () => {
    setState({ status: 'loading' });
    setSelectedSets([]);
    try {
      setState(await loadPracticeHub());
    } catch (error: unknown) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Practice options are unavailable.',
      });
    }
  };

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
            Practice uses Pack One&apos;s server-authoritative packs and scoring. Practice results save to your career but do not enter the Daily leaderboard.
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
          <Text style={styles.cardKicker}>{cubeUnlocked ? 'ELITE UNLOCKED' : 'ELITE'}</Text>
          <Text style={styles.cardTitle}>Powered Cube</Text>
          <Text style={styles.body}>Unlimited Powered Cube practice with two new-pack rerolls.</Text>
          <Text style={cubeUnlocked ? styles.cardAction : styles.lockedText}>
            {cubeUnlocked ? 'Start Powered Cube →' : 'Elite access required'}
          </Text>
        </Pressable>

        <View style={[styles.optionCard, !customUnlocked && styles.lockedCard]}>
          <Text style={styles.cardKicker}>{customUnlocked ? 'ELITE UNLOCKED' : 'ELITE'}</Text>
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
                      <Text style={[styles.setName, selected && styles.setNameSelected]} numberOfLines={2}>{set.set_name}</Text>
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
            <Text style={styles.lockedText}>Elite access required</Text>
          )}
        </View>

        <View style={styles.note}>
          <Text style={styles.noteTitle}>Existing account access only</Text>
          <Text style={styles.body}>
            The app reads practice access from your Pack One account. It does not sell, grant, or infer Elite access.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
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
    width: '48%',
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
