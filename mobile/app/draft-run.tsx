import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  createDraftRunShare,
  DAILY_ENVIRONMENT_META,
  isDailyEnvironment,
  loadDraftRun,
  rerollDraftRun,
  startDailyDraftRun,
  startPracticeDraftRun,
  submitDraftRunPick,
  type DailyEnvironment,
  type DraftRunAnswer,
  type DraftRunCard,
  type DraftRunState,
  type PracticeEnvironment,
} from '@/src/api/draftRun';
import { useAppResume } from '@/src/hooks/useAppResume';
import { clearPracticeIdempotencyKey, practiceIdempotencyKey } from '@/src/storage/idempotency';
import type { MobileSession } from '@/src/storage/session';
import { colors, spacing } from '@/src/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'signin-required' }
  | { status: 'ready'; run: DraftRunState; session: MobileSession }
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


function relativeSupport(support: number | undefined, leader: number) {
  if (!Number.isFinite(Number(support)) || leader <= 0) return 'Unavailable';
  return `${Math.round(100 * Number(support) / leader)}%`;
}

function compactFeedback(answer: DraftRunAnswer) {
  if (answer.historicalMatch) return '';
  const prefix = answer.selectedName ? `You chose ${answer.selectedName}. ` : '';
  if (answer.modelTargetDisagreement) return `${prefix}The trophy drafter made an unusual choice relative to the model.`;
  if (answer.score >= 85) return `${prefix}A strongly supported alternative.`;
  if (answer.score >= 60) return `${prefix}A plausible alternative.`;
  return `${prefix}The model found less support for this choice.`;
}

function FeedbackCard({
  card,
  label,
  onZoom,
}: {
  card: DraftRunCard | undefined;
  label: string;
  onZoom: (card: DraftRunCard) => void;
}) {
  if (!card) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${card.name}. Open enlarged card.`}
      onPress={() => onZoom(card)}
      style={styles.feedbackCard}
    >
      <Text style={styles.feedbackCardLabel}>{label}</Text>
      {card.image_url ? (
        <Image
          source={card.image_url}
          style={styles.feedbackCardImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          accessibilityLabel={card.name}
        />
      ) : (
        <View style={styles.feedbackCardFallback}>
          <Text style={styles.cardFallbackText}>{card.name}</Text>
        </View>
      )}
      <Text style={styles.feedbackCardName} numberOfLines={2}>{card.name}</Text>
    </Pressable>
  );
}

function FeedbackAnalysis({
  answer,
  onZoom,
}: {
  answer: DraftRunAnswer;
  onZoom: (card: DraftRunCard) => void;
}) {
  const candidates = answer.puzzle.candidates;
  const selected = candidates.find((card) => card.id === answer.selectedId);
  const trophy = candidates.find((card) => card.id === answer.historicalId);
  const supportRanking = [...(answer.ranking ?? [])].sort((a, b) => Number(b.support) - Number(a.support));
  const displayRanking = [...(answer.ranking ?? [])].sort(
    (a, b) => Number(b.id === answer.historicalId) - Number(a.id === answer.historicalId)
      || Number(b.support) - Number(a.support),
  );
  const leaderSupport = Number(answer.consensusSupport ?? supportRanking[0]?.support ?? 0);
  const leader = supportRanking[0];
  const modelLeaderName = answer.consensusName ?? leader?.name;
  const disagreement = Boolean(
    answer.historicalId
      && (answer.consensusId ?? leader?.id)
      && (answer.consensusId ?? leader?.id) !== answer.historicalId,
  );

  return (
    <View style={styles.analysisPanel}>
      <View style={styles.feedbackComparison}>
        <FeedbackCard
          card={selected}
          label={answer.historicalMatch ? 'Your pick · Trophy pick' : 'Your pick'}
          onZoom={onZoom}
        />
        {!answer.historicalMatch ? <FeedbackCard card={trophy} label="Trophy pick" onZoom={onZoom} /> : null}
      </View>

      {compactFeedback(answer) ? <Text style={styles.analysisLead}>{compactFeedback(answer)}</Text> : null}

      {modelLeaderName ? (
        <>
          <Text style={styles.analysisTitle}>Model&apos;s strongest choice: {modelLeaderName}</Text>
          {answer.historicalName ? (
            <Text style={styles.analysisBody}>
              Trophy drafter: {answer.historicalName}: 100.
              {disagreement
                ? ` Model's strongest alternative: ${modelLeaderName}: 95. This was an excellent alternative according to the model; ${answer.historicalName} was the choice in this successful trophy draft.`
                : ''}
            </Text>
          ) : null}
          <Text style={styles.analysisBody}>
            {answer.historicalId && answer.selectedId === answer.historicalId
              ? 'You matched the trophy pick.'
              : `Your pick has ${relativeSupport(answer.selectedSupport, leaderSupport)} of the leading model support.`}
            {' '}Matching the trophy drafter is the goal of this game: trophy matches earn 100 regardless of model support. Other choices receive partial credit, up to 95, based on how strongly the model supports them.
          </Text>
        </>
      ) : null}

      {displayRanking.length ? (
        <>
          <Text style={styles.analysisSubhead}>Leading choices</Text>
          {displayRanking.slice(0, 3).map((item) => (
            <View key={item.id} style={styles.rankingLine}>
              <Text style={styles.rankingName}>
                {item.name}
                {item.id === answer.selectedId ? ' · Your pick' : ''}
                {item.id === answer.historicalId ? ' · Trophy pick' : ''}
              </Text>
              <Text style={styles.rankingMeta}>
                {item.id === answer.historicalId
                  ? '100 points'
                  : `${relativeSupport(item.support, leaderSupport)} of leader · ${item.score} points`}
              </Text>
            </View>
          ))}
          <Text style={styles.analysisSubhead}>Compare all {displayRanking.length} choices</Text>
          {supportRanking.map((item) => (
            <View key={`all-${item.id}`} style={styles.rankingLine}>
              <Text style={styles.rankingName}>
                {item.name}
                {item.id === answer.selectedId ? ' · Your pick' : ''}
                {item.id === answer.historicalId ? ' · Trophy pick' : ''}
              </Text>
              <Text style={styles.rankingMeta}>
                {item.id === answer.historicalId ? 'N/A support' : `${relativeSupport(item.support, leaderSupport)} support`}
                {' · '}{item.score} points
              </Text>
            </View>
          ))}
        </>
      ) : null}

      <Text style={styles.modelNote}>
        Model support reflects held-out strong-player choices. It does not establish a correct pick or predict a win rate.
      </Text>
    </View>
  );
}

function PackReview({
  answer,
  onZoom,
}: {
  answer: DraftRunAnswer;
  onZoom: (card: DraftRunCard) => void;
}) {
  return (
    <View style={styles.packReview}>
      {answer.puzzle.prior_picks.length ? (
        <>
          <Text style={styles.analysisSubhead}>Previous cards</Text>
          <Text style={styles.sectionBody}>Already selected by this drafter.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.poolRow}>
            {answer.puzzle.prior_picks.map((card, index) => (
              <Pressable
                key={`${card.id}-review-${index}`}
                accessibilityRole="button"
                accessibilityLabel={`View previous pick ${index + 1}: ${card.name}`}
                onPress={() => onZoom(card)}
                style={styles.poolCard}
              >
                {card.image_url ? (
                  <Image source={card.image_url} style={styles.poolImage} contentFit="cover" cachePolicy="memory-disk" />
                ) : null}
                <Text style={styles.poolName} numberOfLines={2}>{index + 1}. {card.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}
      <Text style={styles.analysisSubhead}>Revealed pack</Text>
      <View style={styles.grid}>
        {answer.puzzle.candidates.map((card) => (
          <Pressable
            key={`review-${card.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${card.name}${card.id === answer.selectedId ? ', your pick' : ''}${card.id === answer.historicalId ? ', trophy pick' : ''}. Open enlarged card.`}
            onPress={() => onZoom(card)}
            style={[
              styles.card,
              card.id === answer.selectedId && styles.reviewYourPick,
              card.id === answer.historicalId && styles.reviewTrophyPick,
            ]}
          >
            {card.image_url ? (
              <Image
                source={card.image_url}
                style={styles.cardImage}
                contentFit="cover"
                cachePolicy="memory-disk"
                accessibilityLabel={card.name}
              />
            ) : (
              <View style={styles.cardFallback}>
                <Text style={styles.cardFallbackText}>{card.name}</Text>
              </View>
            )}
            <Text style={styles.cardName} numberOfLines={2}>{card.name}</Text>
            {card.id === answer.selectedId ? <Text style={styles.reviewBadge}>YOUR PICK</Text> : null}
            {card.id === answer.historicalId ? <Text style={styles.reviewBadge}>TROPHY PICK</Text> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function parsePracticeSets(value: string) {
  const sets = value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^[-a-z0-9]{2,40}$/.test(item));
  return [...new Set(sets)].sort();
}

async function loadDraftSurface(
  environment: DailyEnvironment,
  practice: boolean,
  setIds: string[],
) {
  const session = await ensureGuestSession();
  if (practice) {
    if (!session.accountToken) return { status: 'signin-required' as const };
    const practiceEnvironment: PracticeEnvironment = environment === 'powered-cube' ? 'powered-cube' : 'mixed';
    const fingerprint = `${practiceEnvironment}:${setIds.join(',')}`;
    const key = await practiceIdempotencyKey(fingerprint);
    const run = await startPracticeDraftRun(session, {
      environment: practiceEnvironment,
      setIds,
      idempotencyKey: key,
    });
    if (run.complete) await clearPracticeIdempotencyKey();
    return { status: 'ready' as const, run, session };
  }
  const run = await startDailyDraftRun(session, environment);
  return { status: 'ready' as const, run, session };
}

export default function DraftRunScreen() {
  const params = useLocalSearchParams<{ environment?: string; mode?: string; setIds?: string }>();
  const practice = params.mode === 'practice';
  const requestedEnvironment = typeof params.environment === 'string' ? params.environment : 'mixed';
  const practiceEnvironment: PracticeEnvironment = requestedEnvironment === 'powered-cube' ? 'powered-cube' : 'mixed';
  const environment: DailyEnvironment = practice
    ? practiceEnvironment
    : isDailyEnvironment(requestedEnvironment) ? requestedEnvironment : 'mixed';
  const setIdsParam = practice && typeof params.setIds === 'string' ? params.setIds : '';
  const setIds = useMemo(() => parsePracticeSets(setIdsParam), [setIdsParam]);
  const dailyMeta = DAILY_ENVIRONMENT_META[environment];
  const surfaceMeta = practice
    ? {
        eyebrow: setIds.length
          ? 'CUSTOM SET PRACTICE'
          : environment === 'powered-cube' ? 'POWERED CUBE PRACTICE' : 'PRACTICE DRAFT RUN',
        resultTitle: setIds.length
          ? 'Custom practice complete.'
          : environment === 'powered-cube' ? 'Powered Cube practice complete.' : 'Practice complete.',
      }
    : dailyMeta;
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [mode, setMode] = useState<ViewMode>('pick');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [zoomedCard, setZoomedCard] = useState<DraftRunCard | null>(null);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showPackReview, setShowPackReview] = useState(false);
  const scroll = useRef<ScrollView>(null);

  useAppResume(async () => {
    if (state.status !== 'ready' || busy) return;
    try {
      const previousRun = state.run;
      const run = practice
        ? await loadDraftRun(previousRun.id, state.session)
        : await startDailyDraftRun(state.session, environment);
      setState({ status: 'ready', run, session: state.session });
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
    void loadDraftSurface(environment, practice, setIds)
      .then((loaded) => {
        if (!active) return;
        if (loaded.status === 'signin-required') {
          setState({ status: 'signin-required' });
          return;
        }
        setMode(loaded.run.complete ? 'result' : 'pick');
        setState({ status: 'ready', run: loaded.run, session: loaded.session });
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
  }, [environment, practice, setIds]);

  const retry = async () => {
    setState({ status: 'loading' });
    setSelected(null);
    setActionError(null);
    setMode('pick');
    try {
      const loaded = await loadDraftSurface(environment, practice, setIds);
      if (loaded.status === 'signin-required') {
        setState({ status: 'signin-required' });
        return;
      }
      setMode(loaded.run.complete ? 'result' : 'pick');
      setState({ status: 'ready', run: loaded.run, session: loaded.session });
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
    setActionError(null);
    void Haptics.selectionAsync();
  };

  const confirm = async () => {
    if (state.status !== 'ready' || !selected || !state.run.current || busy) return;
    setBusy(true);
    try {
      const run = await submitDraftRunPick(state.run, selected, state.session);
      if (run.current) {
        const urls = run.current.candidates.map((card) => card.image_url).filter((url): url is string => Boolean(url));
        if (urls.length) void Image.prefetch(urls);
      }
      if (run.complete && practice) {
        await clearPracticeIdempotencyKey().catch(() => undefined);
      }
      setState({ status: 'ready', run, session: state.session });
      setActionError(null);
      setReviewIndex(run.answers.length - 1);
      setShowAnalysis(false);
      setShowPackReview(false);
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

  const shareResult = async () => {
    if (state.status !== 'ready' || !state.run.complete) return;
    const matches = state.run.answers.filter((item) => item.historicalMatch).length;
    const label = environment === 'latest' ? 'Latest Set' : environment === 'powered-cube' ? 'Powered Cube' : 'Draft Run';
    const squares = state.run.answers.map((item) => (
      item.historicalMatch ? '🟩' : item.score >= 85 ? '🟦' : item.score >= 60 ? '🟨' : item.score >= 25 ? '🟧' : '⬛'
    )).join('');
    setShareError(null);
    try {
      const setParam = environment === 'mixed' ? '' : `&set=${environment}`;
      const url = state.run.day
        ? `https://packone.pro/?game=draft-run${setParam}&daily=1&ref=result_share`
        : `https://packone.pro/?game=draft-run${setParam}&shared=${(await createDraftRunShare(state.run.id, state.session)).id}`;
      const text = state.run.day
        ? `I scored ${state.run.score ?? 0}/100 on today’s Pack One ${label}. Can you beat it?\n${squares}\n${matches}/${state.run.run_length} trophy picks matched · Daily ${state.run.day}`
        : `Pack One · ${label} · Practice\n${state.run.score ?? 0}/100  ${squares}\n${matches}/${state.run.run_length} trophy picks matched. Play this run and compare.`;
      await Share.share({ message: `${text}\n${url}` });
    } catch {
      setShareError('Could not open sharing. Your result is still saved.');
    }
  };

  const reroll = async (type: 'set' | 'pack') => {
    if (state.status !== 'ready' || !practice || mode !== 'pick' || !state.run.current || busy) return;
    setBusy(true);
    setSelected(null);
    setActionError(null);
    try {
      const run = await rerollDraftRun(state.run, type, state.session);
      if (run.current) {
        const urls = run.current.candidates.map((card) => card.image_url).filter((url): url is string => Boolean(url));
        if (urls.length) void Image.prefetch(urls);
      }
      setState({ status: 'ready', run, session: state.session });
      void Haptics.selectionAsync();
      scroll.current?.scrollTo({ y: 0, animated: true });
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : 'That reroll could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (state.status !== 'ready') return;
    setReviewIndex(null);
    setShowAnalysis(false);
    setShowPackReview(false);
    if (state.run.complete) {
      setMode('result');
    } else {
      setSelected(null);
      setMode('pick');
    }
    scroll.current?.scrollTo({ y: 0, animated: true });
  };

  const reviewAnswer = (index: number) => {
    setReviewIndex(index);
    setShowAnalysis(false);
    setShowPackReview(false);
    setSelected(null);
    setMode('feedback');
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

  if (state.status === 'signin-required') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.eyebrow}>PRACTICE</Text>
          <Text style={styles.errorTitle}>Sign in to start practice.</Text>
          <Text style={styles.errorBody}>A free Pack One account includes unlimited regular Draft Run practice.</Text>
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
  const answer = mode === 'feedback' && reviewIndex !== null
    ? run.answers[reviewIndex]
    : run.answers.at(-1);

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
          <View style={styles.resultReview}>
            <Text style={styles.analysisTitle}>Your {run.run_length} picks</Text>
            {run.answers.map((item, index) => (
              <Pressable
                key={`${item.puzzle.puzzle_id}-result-review`}
                accessibilityRole="button"
                accessibilityLabel={`Review pick ${index + 1}, ${item.selectedName}, ${item.score} points`}
                onPress={() => reviewAnswer(index)}
                style={styles.resultReviewRow}
              >
                <Text style={styles.resultReviewIndex}>{index + 1}</Text>
                <View style={styles.resultReviewCopy}>
                  <Text style={styles.resultReviewTitle}>
                    {item.puzzle.set_id.toUpperCase()} · Pick {item.pickNumber ?? item.puzzle.pick_number}
                  </Text>
                  <Text style={styles.rankingMeta}>
                    {item.selectedName}{item.historicalMatch ? ' · Trophy match' : ''}
                  </Text>
                </View>
                <Text style={styles.resultReviewScore}>{item.score}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share Pack One result"
            onPress={() => void shareResult()}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Share result</Text>
          </Pressable>
          {shareError ? <Text accessibilityRole="alert" style={styles.actionError}>{shareError}</Text> : null}
          <View style={styles.guestNote}>
            <Text style={styles.guestNoteTitle}>
              {practice ? 'Saved to your career' : state.session.accountToken ? 'Saved to your account' : 'Guest result'}
            </Text>
            <Text style={styles.resultBody}>
              {practice
                ? 'Practice uses your signed-in Pack One identity and does not enter the Daily leaderboard.'
                : state.session.accountToken
                  ? 'This result used your signed-in Pack One identity and the same server eligibility rules as web.'
                  : 'Sign in or create your Pack One account to validate this Daily score and keep your career across devices.'}
            </Text>
            {!practice && !state.session.accountToken ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({
                  pathname: '/account',
                  params: { validateDailyRunId: run.id, environment },
                })}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>Sign in to save this score</Text>
              </Pressable>
            ) : null}
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
          <Text style={styles.eyebrow}>
            {practice ? surfaceMeta.eyebrow : `${dailyMeta.eyebrow} · ${run.day ?? 'TODAY'}`}
          </Text>
          <Text style={styles.title}>
            {puzzle.set_id.toUpperCase()} <Text style={styles.titleMeta}>· Pack 1 · Pick {puzzle.pick_number}</Text>
          </Text>
          <Progress run={run} />

          {mode === 'feedback' && answer ? (
            <>
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
                  <Text style={styles.feedbackBody}>You chose {answer.selectedName}.</Text>
                </View>
              </View>

              <View style={styles.feedbackComparison}>
                <FeedbackCard
                  card={puzzle.candidates.find((card) => card.id === answer.selectedId)}
                  label={answer.historicalMatch ? 'Trophy and Your Pick' : 'Your Pick'}
                  onZoom={setZoomedCard}
                />
                {!answer.historicalMatch ? (
                  <FeedbackCard
                    card={puzzle.candidates.find((card) => card.id === answer.historicalId)}
                    label="Trophy Pick"
                    onZoom={setZoomedCard}
                  />
                ) : null}
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showAnalysis }}
                onPress={() => setShowAnalysis((value) => !value)}
                style={styles.disclosureButton}
              >
                <Text style={styles.disclosureText}>{showAnalysis ? 'Hide score analysis' : 'Why this score?'}</Text>
              </Pressable>
              {showAnalysis ? <FeedbackAnalysis answer={answer} onZoom={setZoomedCard} /> : null}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showPackReview }}
                onPress={() => setShowPackReview((value) => !value)}
                style={styles.disclosureButton}
              >
                <Text style={styles.disclosureText}>{showPackReview ? 'Hide revealed pack' : 'Review the pack'}</Text>
              </Pressable>
              {showPackReview ? <PackReview answer={answer} onZoom={setZoomedCard} /> : null}
            </>
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

              {practice && (run.rerolls.pack > 0 || (run.set_reroll_allowed && run.rerolls.set > 0)) ? (
                <View style={styles.rerollPanel}>
                  <Text style={styles.sectionTitle}>Want a different decision?</Text>
                  <View style={styles.rerollRow}>
                    {run.rerolls.pack > 0 ? (
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => void reroll('pack')}
                        style={[styles.rerollButton, busy && styles.primaryButtonDisabled]}
                      >
                        <Text style={styles.rerollButtonText}>New pack · {run.rerolls.pack} left</Text>
                      </Pressable>
                    ) : null}
                    {run.set_reroll_allowed && run.rerolls.set > 0 ? (
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => void reroll('set')}
                        style={[styles.rerollButton, busy && styles.primaryButtonDisabled]}
                      >
                        <Text style={styles.rerollButtonText}>New set · {run.rerolls.set} left</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
                </View>
              ) : actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

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
                  <Text style={styles.zoomFallbackName}>{zoomedCard?.name}</Text>
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
  reviewYourPick: { borderColor: colors.accent },
  reviewTrophyPick: { borderColor: colors.lineStrong },
  reviewBadge: { color: colors.accentDark, fontSize: 9, fontWeight: '800', paddingHorizontal: 5, paddingBottom: 4 },
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
  actionError: { color: colors.danger, fontSize: 13, lineHeight: 18 },
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
  feedback: {
    marginTop: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderTopWidth: 3,
    borderColor: colors.line,
    borderTopColor: colors.accent,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  feedbackScore: { flexDirection: 'row', alignItems: 'baseline' },
  feedbackScoreNumber: { color: colors.ink, fontSize: 44, lineHeight: 48, fontWeight: '800' },
  feedbackScoreSuffix: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  feedbackCopy: { flex: 1, minWidth: 220, gap: spacing.xs, justifyContent: 'center' },
  feedbackTitle: { color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: '800' },
  feedbackBody: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  feedbackComparison: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  feedbackCard: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  feedbackCardLabel: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  feedbackCardImage: { width: '100%', aspectRatio: 0.716, backgroundColor: colors.surfaceSoft },
  feedbackCardFallback: {
    width: '100%',
    aspectRatio: 0.716,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    backgroundColor: colors.surfaceSoft,
  },
  feedbackCardName: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  disclosureButton: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disclosureText: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
  analysisPanel: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.md },
  analysisLead: { color: colors.ink, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  analysisTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: '800' },
  analysisSubhead: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  analysisBody: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  rankingLine: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.sm, gap: 2 },
  rankingName: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  rankingMeta: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  modelNote: { color: colors.muted, fontSize: 12, lineHeight: 18, fontStyle: 'italic' },
  packReview: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.md },
  resultReview: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  resultReviewRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  resultReviewIndex: { width: 28, color: colors.accentDark, fontSize: 16, fontWeight: '800' },
  resultReviewCopy: { flex: 1, gap: 2 },
  resultReviewTitle: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  resultReviewScore: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  resultPage: { padding: spacing.lg, paddingTop: spacing.xxl, gap: spacing.lg },
  scoreBlock: { borderTopWidth: 3, borderColor: colors.accent, backgroundColor: colors.surface, padding: spacing.xl },
  score: { color: colors.ink, fontSize: 72, lineHeight: 76, fontWeight: '800', letterSpacing: -2 },
  scoreMeta: { color: colors.muted, fontSize: 15, fontWeight: '700' },
  resultBody: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  guestNote: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.lg, gap: spacing.xs },
  guestNoteTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  secondaryButton: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  secondaryButtonText: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
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
  zoomFallbackName: { color: colors.ink, fontSize: 18, lineHeight: 24, fontWeight: '800', textAlign: 'center' },
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
