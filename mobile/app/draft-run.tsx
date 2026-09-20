import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ensureGuestSession } from '@/src/api/guest';
import {
  startDailyDraftRun,
  submitDraftRunPick,
  type DraftRunCard,
  type DraftRunState,
} from '@/src/api/draftRun';
import { colors, spacing } from '@/src/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; run: DraftRunState; token: string }
  | { status: 'error'; message: string };

type ViewMode = 'pick' | 'feedback' | 'result';

function Progress({ run }: { run: DraftRunState }) {
  return (
    <View style={styles.progress} accessibilityLabel={`Round ${Math.min(run.answers.length + 1, run.run_length)} of ${run.run_length}`}>
      {Array.from({ length: run.run_length }, (_, index) => (
        <View
          key={index}
          style={[
            styles.progressStep,
            index < run.answers.length && styles.progressDone,
            index === run.answers.length && !run.complete && styles.progressCurrent,
          ]}
        />
      ))}
    </View>
  );
}

function CardTile({
  card,
  selected,
  disabled,
  onPress,
}: {
  card: DraftRunCard;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Pick ${card.name}`}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.card, selected && styles.cardSelected]}
    >
      {card.image_url ? (
        <Image
          source={card.image_url}
          style={styles.cardImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
          accessibilityLabel={card.name}
        />
      ) : (
        <View style={styles.cardFallback}>
          <Text style={styles.cardFallbackText}>{card.name}</Text>
        </View>
      )}
      <Text style={styles.cardName} numberOfLines={2}>{card.name}</Text>
    </Pressable>
  );
}

export default function DraftRunScreen() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [mode, setMode] = useState<ViewMode>('pick');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);

  const begin = useCallback(async () => {
    setState({ status: 'loading' });
    setSelected(null);
    setMode('pick');
    try {
      const session = await ensureGuestSession();
      const run = await startDailyDraftRun(session.token);
      setMode(run.complete ? 'result' : 'pick');
      setState({ status: 'ready', run, token: session.token });
    } catch (error: unknown) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Draft Run is unavailable.',
      });
    }
  }, []);

  useEffect(() => {
    void begin();
  }, [begin]);

  const choose = (id: string) => {
    if (busy || mode !== 'pick') return;
    setSelected(id);
    void Haptics.selectionAsync();
  };

  const confirm = async () => {
    if (state.status !== 'ready' || !selected || !state.run.current || busy) return;
    setBusy(true);
    try {
      const run = await submitDraftRunPick(state.run, selected, state.token);
      if (run.current) {
        const urls = run.current.candidates.map((card) => card.image_url).filter((url): url is string => Boolean(url));
        if (urls.length) void Image.prefetch(urls);
      }
      setState({ status: 'ready', run, token: state.token });
      setMode('feedback');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      scroll.current?.scrollTo({ y: 0, animated: true });
    } catch (error: unknown) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Your pick could not be saved.',
      });
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (state.status !== 'ready') return;
    if (state.run.complete) {
      setMode('result');
    } else {
      setSelected(null);
      setMode('pick');
    }
    scroll.current?.scrollTo({ y: 0, animated: true });
  };

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>Finding today&apos;s packs…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Couldn&apos;t load Draft Run</Text>
          <Text style={styles.errorBody}>{state.message}</Text>
          <Pressable accessibilityRole="button" onPress={() => void begin()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { run } = state;
  const answer = run.answers.at(-1);

  if (mode === 'result') {
    const matches = run.answers.filter((item) => item.historicalMatch).length;
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.resultPage}>
          <Text style={styles.eyebrow}>DAILY DRAFT RUN COMPLETE</Text>
          <Text style={styles.title}>Your Draft Run.</Text>
          <View style={styles.scoreBlock}>
            <Text style={styles.score}>{run.score ?? 0}</Text>
            <Text style={styles.scoreMeta}>/100 · {matches} trophy picks matched</Text>
          </View>
          {run.standing ? (
            <Text style={styles.resultBody}>
              #{run.standing.rank} of {run.standing.total} today
              {run.standing.percentile ? ` · Top ${run.standing.percentile}%` : ''}
            </Text>
          ) : null}
          <View style={styles.guestNote}>
            <Text style={styles.guestNoteTitle}>Guest result</Text>
            <Text style={styles.resultBody}>
              This run is saved to this guest identity. Account sign-in and score claiming are the next mobile milestone.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const puzzle = mode === 'feedback' ? answer?.puzzle : run.current;
  if (!puzzle) return null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.shell}>
        <ScrollView ref={scroll} contentContainerStyle={styles.page}>
          <Text style={styles.eyebrow}>DAILY DRAFT RUN · {run.day ?? 'TODAY'}</Text>
          <Text style={styles.title}>
            {puzzle.set_id.toUpperCase()} <Text style={styles.titleMeta}>· Pack 1 · Pick {puzzle.pick_number}</Text>
          </Text>
          <Progress run={run} />

          {mode === 'feedback' && answer ? (
            <View style={styles.feedback}>
              <View style={styles.feedbackScore}>
                <Text style={styles.feedbackScoreNumber}>{answer.score}</Text>
                <Text style={styles.feedbackScoreSuffix}>/100</Text>
              </View>
              <View style={styles.feedbackCopy}>
                <Text style={styles.feedbackTitle}>
                  {answer.historicalMatch
                    ? 'You matched the trophy drafter.'
                    : `The trophy drafter took ${answer.historicalName ?? 'another card'}.`}
                </Text>
                <Text style={styles.feedbackBody}>
                  You chose {answer.selectedName}.
                </Text>
              </View>
            </View>
          ) : (
            <>
              {puzzle.prior_picks.length ? (
                <View style={styles.pool}>
                  <Text style={styles.sectionTitle}>Their earlier picks</Text>
                  <Text style={styles.sectionBody}>Choose for this drafter&apos;s pool.</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.poolRow}>
                    {puzzle.prior_picks.map((card, index) => (
                      <View key={`${card.id}-${index}`} style={styles.poolCard}>
                        {card.image_url ? (
                          <Image source={card.image_url} style={styles.poolImage} contentFit="cover" cachePolicy="memory-disk" />
                        ) : null}
                        <Text style={styles.poolName} numberOfLines={2}>{index + 1}. {card.name}</Text>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              <Text style={styles.sectionTitle}>Choose a card</Text>
              <View style={styles.grid}>
                {puzzle.candidates.map((card) => (
                  <CardTile
                    key={card.id}
                    card={card}
                    selected={selected === card.id}
                    disabled={busy}
                    onPress={() => choose(card.id)}
                  />
                ))}
              </View>
            </>
          )}
        </ScrollView>

        <View style={styles.actionDock}>
          {mode === 'pick' ? (
            <Pressable
              accessibilityRole="button"
              disabled={!selected || busy}
              onPress={() => void confirm()}
              style={[styles.primaryButton, (!selected || busy) && styles.primaryButtonDisabled]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Confirm pick</Text>}
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" onPress={next} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{run.complete ? 'See result' : 'Next pick'}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  shell: { flex: 1 },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  loadingText: { color: colors.muted, fontSize: 15 },
  errorTitle: { color: colors.ink, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  errorBody: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  title: { color: colors.ink, fontSize: 30, lineHeight: 34, fontWeight: '800' },
  titleMeta: { color: colors.muted, fontSize: 15, fontWeight: '700' },
  progress: { flexDirection: 'row', gap: 5, marginVertical: spacing.xs },
  progressStep: { flex: 1, height: 5, backgroundColor: colors.line },
  progressDone: { backgroundColor: colors.accent },
  progressCurrent: { backgroundColor: colors.lineStrong },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  sectionBody: { color: colors.muted, fontSize: 14, marginTop: -8 },
  pool: { gap: spacing.sm, paddingVertical: spacing.sm },
  poolRow: { gap: spacing.sm, paddingRight: spacing.lg },
  poolCard: { width: 92, gap: 5 },
  poolImage: { width: 92, aspectRatio: 0.716, backgroundColor: colors.surfaceSoft },
  poolName: { color: colors.muted, fontSize: 11, lineHeight: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md },
  card: {
    width: '48.5%',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
    padding: 3,
  },
  cardSelected: { borderColor: colors.accent },
  cardImage: { width: '100%', aspectRatio: 0.716, backgroundColor: colors.surfaceSoft },
  cardFallback: {
    width: '100%',
    aspectRatio: 0.716,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    backgroundColor: colors.surfaceSoft,
  },
  cardFallbackText: { color: colors.ink, fontWeight: '700', textAlign: 'center' },
  cardName: { color: colors.ink, fontSize: 11, lineHeight: 14, fontWeight: '700', padding: 5 },
  actionDock: {
    borderTopWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  primaryButton: {
    minHeight: 52,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryButtonDisabled: { opacity: 0.42 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  feedback: {
    marginTop: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderTopWidth: 3,
    borderColor: colors.line,
    borderTopColor: colors.accent,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    gap: spacing.lg,
  },
  feedbackScore: { flexDirection: 'row', alignItems: 'baseline' },
  feedbackScoreNumber: { color: colors.ink, fontSize: 44, lineHeight: 48, fontWeight: '800' },
  feedbackScoreSuffix: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  feedbackCopy: { flex: 1, gap: spacing.xs, justifyContent: 'center' },
  feedbackTitle: { color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: '800' },
  feedbackBody: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  resultPage: { padding: spacing.lg, paddingTop: spacing.xxl, gap: spacing.lg },
  scoreBlock: { borderTopWidth: 3, borderColor: colors.accent, backgroundColor: colors.surface, padding: spacing.xl },
  score: { color: colors.ink, fontSize: 72, lineHeight: 76, fontWeight: '800', letterSpacing: -2 },
  scoreMeta: { color: colors.muted, fontSize: 15, fontWeight: '700' },
  resultBody: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  guestNote: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.lg, gap: spacing.xs },
  guestNoteTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
});
