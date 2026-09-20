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
  type PracticeCapability,
  type PracticeSet,
} from '@/src/api/draftRun';
import { ensureGuestSession } from '@/src/api/guest';
import type { MobileSession } from '@/src/storage/session';
import { colors, spacing } from '@/src/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'signin-required' }
  | {
      status: 'ready';
      session: MobileSession;
      capabilities: PracticeCapability[];
      sets: PracticeSet[];
    }
  | { status: 'error'; message: string };

function hasCapability(capabilities: PracticeCapability[], capability: PracticeCapability) {
  return capabilities.includes(capability);
}

export default function PracticeScreen() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [selectedSets, setSelectedSets] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void ensureGuestSession()
      .then(async (session) => {
        if (!session.accountToken) return { status: 'signin-required' as const };
        const access = await loadPracticeCapabilities(session);
        if (!hasCapability(access.capabilities, 'unlimited_regular_practice')) {
          return { status: 'signin-required' as const };
        }
        const sets = hasCapability(access.capabilities, 'custom_corpus')
          ? (await loadPracticeSets(session)).sets
          : [];
        return {
          status: 'ready' as const,
          session,
          capabilities: access.capabilities,
          sets,
        };
      })
      .then((loaded) => {
        if (!active) return;
        setState(loaded);
        if (loaded.status === 'ready' && loaded.sets.length) {
          setSelectedSets((current) => current.length ? current : [loaded.sets[0].set_id]);
        }
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

  const toggleSet = (setId: string) => {
    setSelectedSets((current) => current.includes(setId)
      ? current.filter((id) => id !== setId)
      : [...current, setId].sort());
  };

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.body}>Loading practice access…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'signin-required') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.eyebrow}>PRACTICE</Text>
          <Text style={styles.title}>Keep drafting with a free account.</Text>
          <Text style={styles.body}>A free account includes unlimited regular Draft Run practice.</Text>
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
          <Text style={styles.title}>Couldn&apos;t load practice.</Text>
          <Text style={styles.body}>{state.message}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/practice')}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const cubeUnlocked = hasCapability(state.capabilities, 'unlimited_cube_practice');
  const customUnlocked = hasCapability(state.capabilities, 'custom_corpus');

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>PRACTICE</Text>
          <Text style={styles.title}>Keep drafting.</Text>
          <Text style={styles.body}>
            Regular Draft Run practice is included with a free account. Elite access adds Powered Cube and custom-set practice.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardKicker}>FREE ACCOUNT</Text>
          <Text style={styles.cardTitle}>Regular Draft Run</Text>
          <Text style={styles.body}>Eight fresh decisions from Pack One&apos;s live regular-set pool, with practice rerolls.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/draft-run', params: { mode: 'practice', environment: 'mixed' } })}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Start regular practice</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardKicker}>ELITE</Text>
          <Text style={styles.cardTitle}>Powered Cube</Text>
          <Text style={styles.body}>Eight practice decisions from the Powered Cube environment, with two pack rerolls.</Text>
          {cubeUnlocked ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/draft-run', params: { mode: 'practice', environment: 'powered-cube' } })}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Start Powered Cube practice</Text>
            </Pressable>
          ) : (
            <Text style={styles.locked}>Requires Elite access on your Pack One account.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardKicker}>ELITE</Text>
          <Text style={styles.cardTitle}>Choose your sets</Text>
          <Text style={styles.body}>Build a fresh eight-decision run balanced across one or more eligible live sets.</Text>
          {customUnlocked ? (
            state.sets.length ? (
              <>
                <View style={styles.setList}>
                  {state.sets.map((set) => {
                    const selected = selectedSets.includes(set.set_id);
                    return (
                      <Pressable
                        key={set.set_id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                        onPress={() => toggleSet(set.set_id)}
                        style={[styles.setRow, selected && styles.setRowSelected]}
                      >
                        <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                          <Text style={styles.checkboxText}>{selected ? '✓' : ''}</Text>
                        </View>
                        <View style={styles.setCopy}>
                          <Text style={styles.setName}>{set.set_name || set.set_id.toUpperCase()}</Text>
                          <Text style={styles.setCode}>{set.set_id.toUpperCase()}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={!selectedSets.length}
                  onPress={() => router.push({
                    pathname: '/draft-run',
                    params: {
                      mode: 'practice',
                      environment: 'mixed',
                      setIds: [...selectedSets].sort().join(','),
                    },
                  })}
                  style={[styles.primaryButton, !selectedSets.length && styles.disabled]}
                >
                  <Text style={styles.primaryButtonText}>Start custom practice</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.locked}>No sets currently have complete eight-pick custom-practice coverage.</Text>
            )
          ) : (
            <Text style={styles.locked}>Requires Elite access on your Pack One account.</Text>
          )}
        </View>

        <View style={styles.note}>
          <Text style={styles.noteTitle}>Account access</Text>
          <Text style={styles.body}>
            Practice access is read from your Pack One account. This screen does not sell or change memberships.
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
  hero: { gap: spacing.sm },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 34, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardKicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  cardTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  primaryButton: {
    minHeight: 52,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  disabled: { opacity: 0.42 },
  locked: { color: colors.muted, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  setList: { gap: spacing.sm },
  setRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  setRowSelected: { borderColor: colors.accent },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkboxText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  setCopy: { flex: 1 },
  setName: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  setCode: { color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  note: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.lg, gap: spacing.xs },
  noteTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
});
