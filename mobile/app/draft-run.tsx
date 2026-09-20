import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { ensureGuestSession } from '@/src/api/guest';
import {
  DAILY_ENVIRONMENT_META,
  isDailyEnvironment,
  issueDraftRunClaim,
  loadDraftRun,
  rerollDraftRun,
  startDailyDraftRun,
  startPracticeDraftRun,
  submitDraftRunPick,
  type DailyEnvironment,
  type DraftRunCard,
  type DraftRunState,
} from '@/src/api/draftRun';
import { useAppResume } from '@/src/hooks/useAppResume';
import { clearPracticeIdempotencyKey, practiceIdempotencyKey } from '@/src/storage/idempotency';
import { colors, spacing } from '@/src/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'signin-required' }
  | { status: 'ready'; run: DraftRunState; token: string }
  | { status: 'error'; message: string };

type ViewMode = 'pick' | 'feedback' | 'result';

function Progress({ run }: { run: DraftRunState }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Draft Run progress"
      accessibilityValue={{
        min: 0,
        max: run.run_length,
        now: run.answers.length,
        text: `${run.answers.length} of ${run.run_length} picks completed`,
      }}
      style={styles.progress}
    >
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
  onZoom,
}: {
  card: DraftRunCard;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  onZoom: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Pick ${card.name}`}
      accessibilityHint="Double tap to select. Long press to view a larger card."
      accessibilityState={{ selected, disabled }}
      delayLongPress={350}
      disabled={disabled}
      onLongPress={onZoom}
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

async function loadDraftSurface(
  environment: DailyEnvironment,
  practice: boolean,
  setIds: string[],
) {
  const session = await ensureGuestSession();
  if (practice) {
    if (!session.accountToken) return { status: 'signin-required' as const };
    const practiceEnvironment = environment === 'powered-cube' ? 'powered-cube' : 'mixed';
    const practiceSets = practiceEnvironment === 'mixed' ? setIds : [];
    const fingerprint = `${practiceEnvironment}:${practiceSets.join(',')}`;
    const key = await practiceIdempotencyKey(fingerprint);
    const run = await startPracticeDraftRun(session, key, {
      environment: practiceEnvironment,
      setIds: practiceSets,
    });
    if (run.complete) await clearPracticeIdempotencyKey();
    return { status: 'ready' as const, run, token: session.playerToken };
  }
  const run = await startDailyDraftRun(session.playerToken, environment);
  return { status: 'ready' as const, run, token: session.playerToken };
}

export default function DraftRunScreen() {
  const params = useLocalSearchParams<{ environment?: string; mode?: string; setIds?: string }>();
  const practice = params.mode === 'practice';
  const requestedEnvironment = typeof params.environment === 'string' ? params.environment : 'mixed';
  const rawSetIds = typeof params.setIds === 'string' ? params.setIds : '';
  const setIdsKey = rawSetIds
    .split(',')
    .filter((setId) => /^[-a-z0-9]{2,40}$/.test(setId))
    .sort()
    .join(',');
  const environment: DailyEnvironment = practice
    ? requestedEnvironment === 'powered-cube' ? 'powered-cube' : 'mixed'
    : isDailyEnvironment(requestedEnvironment) ? requestedEnvironment : 'mixed';
  const dailyMeta = DAILY_ENVIRONMENT_META[environment];
  const surfaceMeta = practice
    ? setIdsKey
      ? { eyebrow: 'CUSTOM PRACTICE', resultTitle: 'Custom practice complete.' }
      : environment === 'powered-cube'
        ? { eyebrow: 'POWERED CUBE PRACTICE', resultTitle: 'Powered Cube practice complete.' }
        : { eyebrow: 'PRACTICE DRAFT RUN', resultTitle: 'Practice complete.' }
    : dailyMeta;
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [mode, setMode] = useState<ViewMode>('pick');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [zoomedCard, setZoomedCard] = useState<DraftRunCard | null>(null);
  const scroll = useRef<ScrollView>(null);

  useAppResume(async () => {
    if (state.status !== 'ready' || busy) return;
    try {
      const previousRun = state.run;
      const run = practice
        ? await loadDraftRun(previousRun.id, state.token)
        : await startDailyDraftRun(state.token, environment);
      setState({ status: 'ready', run, token: state.token });
      setSelected(null);
      setMode((currentMode) => {
        if (
          currentMode === 'feedback'
          && run.id === previousRun.id
          && run.answers.length === previousRun.answers.length
        ) {
          return 'feedback';
        }
        return run.complete ? 'result' : 'pick';
      });
    } catch {
      // Keep the last server-authoritative state visible if foreground refresh fails.
    }
  });

  useEffect(() => {
    let active = true;
    void loadDraftSurface(environment, practice, setIdsKey ? setIdsKey.split(',') : [])
      .then((loaded) => {
        if (!active) return;
        if (loaded.status === 'signin-required') {
          setState({ status: 'signin-required' });
          return;
        }
        setMode(loaded.run.complete ? 'result' : 'pick');
        setState({ status: 'ready', run: loaded.run, token: loaded.token });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Draft Run is unavailable.',
        });
      });
    return () => {
      active = false;
    };
  }, [environment, practice, setIdsKey]);

  const retry = async ({ freshPractice = false }: { freshPractice?: boolean } = {}) => {
    setState({ status: 'loading' });
    setSelected(null);
    setMode('pick');
    setActionError(null);
    if (practice && freshPractice) await clearPracticeIdempotencyKey();
    try {
      const loaded = await loadDraftSurface(environment, practice, setIdsKey ? setIdsKey.split(',') : []);
      if (loaded.status === 'signin-required') {
        setState({ status: 'signin-required' });
        return;
      }
      setMode(loaded.run.complete ? 'result' : 'pick');
      setState({ status: 'ready', run: loaded.run, token: loaded.token });
    } catch (error: unknown) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Draft Run is unavailable.',
      });
    }
  };

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
      if (practice && run.complete) await clearPracticeIdempotencyKey();
      setMode('feedback');
      const latestAnswer = run.answers.at(-1);
      if (latestAnswer) {
        AccessibilityInfo.announceForAccessibility(
          `${latestAnswer.score} out of 100. ${latestAnswer.historicalMatch
            ? 'You matched the trophy drafter.'
            : `The trophy drafter took ${latestAnswer.historicalName ?? 'another card'}.`}`,
        );
      }
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

  const reroll = async (type: 'set' | 'pack') => {
    if (state.status !== 'ready' || !state.run.current || busy || !practice) return;
    setBusy(true);
    setActionError(null);
    try {
      const run = await rerollDraftRun(state.run, type, state.token);
      setSelected(null);
      setState({ status: 'ready', run, token: state.token });
      if (run.current) {
        const urls = run.current.candidates.map((card) => card.image_url).filter((url): url is string => Boolean(url));
        if (urls.length) void Image.prefetch(urls);
      }
      void Haptics.selectionAsync();
      scroll.current?.scrollTo({ y: 0, animated: true });
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : 'Could not reroll this pack.');
    } finally {
      setBusy(false);
    }
  };

  const signInToClaim = async () => {
    if (state.status !== 'ready' || !state.run.complete || busy) return;
    setBusy(true);
    setResultError(null);
    try {
      const claim = await issueDraftRunClaim(state.run.id, state.token);
      router.push({
        pathname: '/account',
        params: { claimToken: claim.claimToken, environment },
      });
    } catch (error: unknown) {
      setResultError(error instanceof Error ? error.message : 'Could not prepare this score for sign in.');
    } finally {
      setBusy(false);
    }
  };

  const shareResult = async () => {
    if (state.status !== 'ready' || !state.run.complete) return;
    const matches = state.run.answers.filter((item) => item.historicalMatch).length;
    const label = practice
      ? setIdsKey
        ? 'custom practice'
        : environment === 'powered-cube'
          ? 'Powered Cube practice'
          : 'Draft Run practice'
      : `${dailyMeta.title} Daily`;
    setShareError(null);
    try {
      await Share.share({
        message: `I scored ${state.run.score ?? 0}/100 on Pack One ${label} and matched ${matches} of ${state.run.run_length} trophy picks.\n\nhttps://packone.pro`,
      });
    } catch {
      setShareError('Could not open sharing. Your result is still saved.');
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
          <Text style={styles.loadingText}>{practice ? 'Building your practice run…' : 'Finding today\'s packs…'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'signin-required') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.eyebrow}>PRACTICE DRAFT RUN</Text>
          <Text style={styles.errorTitle}>Keep drafting with a free account.</Text>
          <Text style={styles.errorBody}>A Pack One account is required for practice.</Text>
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
          <Text style={styles.errorTitle}>Couldn&apos;t load Draft Run</Text>
          <Text style={styles.errorBody}>{state.message}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void retry()}
            style={styles.primaryButton}
          >
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
          <Text style={styles.eyebrow}>{surfaceMeta.eyebrow} COMPLETE</Text>
          <Text style={styles.title}>{surfaceMeta.resultTitle}</Text>
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share Pack One result"
            onPress={() => void shareResult()}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Share result</Text>
          </Pressable>
          {shareError ? <Text accessibilityRole="alert" style={styles.resultError}>{shareError}</Text> : null}
          {practice ? (
            <View style={styles.guestNote}>
              <Text style={styles.guestNoteTitle}>Saved to your career</Text>
              <Text style={styles.resultBody}>Practice is saved to your Pack One career and is not ranked on the Daily leaderboard.</Text>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void retry({ freshPractice: true })}
                style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}
              >
                <Text style={styles.primaryButtonText}>Start another practice run</Text>
              </Pressable>
            </View>
          ) : run.leaderboard_eligible ? (
            <View style={styles.guestNote}>
              <Text style={styles.guestNoteTitle}>Ranked result</Text>
              <Text style={styles.resultBody}>This score is attached to your Pack One identity.</Text>
            </View>
          ) : (
            <View style={styles.guestNote}>
              <Text style={styles.guestNoteTitle}>Save this score</Text>
              <Text style={styles.resultBody}>
                Sign in to validate and save your score and join the leaderboard.
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void signInToClaim()}
                style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Sign in and save score</Text>}
              </Pressable>
              {resultError ? <Text style={styles.resultError}>{resultError}</Text> : null}
            </View>
          )}
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
          <Text style={styles.eyebrow}>{surfaceMeta.eyebrow}{practice ? '' : ` · ${run.day ?? 'TODAY'}`}</Text>
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

              {practice ? (
                <View style={styles.rerollPanel}>
                  <Text style={styles.sectionTitle}>Rerolls</Text>
                  <View style={styles.rerollRow}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy || run.rerolls.pack < 1}
                      onPress={() => void reroll('pack')}
                      style={[styles.rerollButton, (busy || run.rerolls.pack < 1) && styles.primaryButtonDisabled]}
                    >
                      <Text style={styles.rerollButtonText}>New pack · {run.rerolls.pack} left</Text>
                    </Pressable>
                    {run.set_reroll_allowed ? (
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy || run.rerolls.set < 1}
                        onPress={() => void reroll('set')}
                        style={[styles.rerollButton, (busy || run.rerolls.set < 1) && styles.primaryButtonDisabled]}
                      >
                        <Text style={styles.rerollButtonText}>New set · {run.rerolls.set} left</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {actionError ? <Text style={styles.resultError}>{actionError}</Text> : null}
                </View>
              ) : null}

              <Text style={styles.sectionTitle}>Choose a card</Text>
              <Text style={styles.sectionBody}>Tap to choose. Press and hold a card to zoom.</Text>
              <View style={styles.grid}>
                {puzzle.candidates.map((card) => (
                  <CardTile
                    key={card.id}
                    card={card}
                    selected={selected === card.id}
                    disabled={busy}
                    onPress={() => choose(card.id)}
                    onZoom={() => setZoomedCard(card)}
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

        <Modal
          animationType="fade"
          onRequestClose={() => setZoomedCard(null)}
          transparent
          visible={zoomedCard !== null}
        >
          <SafeAreaView style={styles.zoomSafe}>
            <View accessibilityViewIsModal style={styles.zoomPanel}>
              {zoomedCard?.image_url ? (
                <Image
                  accessibilityLabel={`${zoomedCard.name} enlarged card`}
                  cachePolicy="memory-disk"
                  contentFit="contain"
                  source={zoomedCard.image_url}
                  style={styles.zoomImage}
                />
              ) : (
                <View style={styles.zoomFallback}>
                  <Text style={styles.zoomName}>{zoomedCard?.name}</Text>
                </View>
              )}
              <Text style={styles.zoomName}>{zoomedCard?.name}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setZoomedCard(null)}
                style={styles.zoomClose}
              >
                <Text style={styles.zoomCloseText}>Close</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </Modal>
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
  rerollPanel: { gap: spacing.sm, paddingVertical: spacing.xs },
  rerollRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rerollButton: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rerollButtonText: { color: colors.accentDark, fontSize: 13, fontWeight: '800' },
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
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  secondaryButton: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
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
  resultError: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  zoomSafe: {
    flex: 1,
    backgroundColor: 'rgba(16, 24, 32, 0.96)',
    padding: spacing.md,
  },
  zoomPanel: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  zoomImage: { width: '100%', flex: 1, maxWidth: 520 },
  zoomFallback: {
    width: '100%',
    flex: 1,
    maxWidth: 520,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    padding: spacing.lg,
  },
  zoomName: { color: '#fff', fontSize: 18, lineHeight: 24, fontWeight: '800', textAlign: 'center' },
  zoomClose: {
    minHeight: 50,
    minWidth: 140,
    borderWidth: 1,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  zoomCloseText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
