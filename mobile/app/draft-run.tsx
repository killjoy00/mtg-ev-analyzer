import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  type LayoutChangeEvent,
  type TextLayoutEvent,
  type StyleProp,
  type ViewStyle,
  View,
} from 'react-native';
import { Text } from '@/src/components/Text';

import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';

import { ensureGuestSession } from '@/src/api/guest';
import {
  createDraftRunShare,
  DAILY_ENVIRONMENT_META,
  isDailyEnvironment,
  loadDraftRun,
  rerollDraftRun,
  startDailyDraftRun,
  startPracticeDraftRun,
  submitDraftRunDecisionReport,
  submitDraftRunPick,
  type DailyEnvironment,
  type DecisionReportReason,
  type DraftRunAnswer,
  type DraftRunCard,
  type DraftRunState,
  type PracticeEnvironment,
} from '@/src/api/draftRun';
import { config } from '@/src/config';
import { useAppResume } from '@/src/hooks/useAppResume';
import { clearPracticeIdempotencyKey, practiceIdempotencyKey } from '@/src/storage/idempotency';
import { readSession, subscribeSession, type MobileSession } from '@/src/storage/session';
import type { SharedRunSurface } from '@/src/state/sharedRunSurface';
import { tcgplayerUrl } from '@/src/tcgplayer';
import { colors, spacing } from '@/src/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'signin-required' }
  | { status: 'ready'; run: DraftRunState; session: MobileSession }
  | { status: 'error'; message: string };

type ViewMode = 'pick' | 'feedback' | 'result';

type ReadyState = Extract<LoadState, { status: 'ready' }>;

type RunResponseToken = {
  request: number;
  mutation: number;
  session: string;
  runId: string;
  revision: number;
};

function mobileSessionIdentity(session: MobileSession) {
  return `${session.playerToken}\n${session.accountToken ?? ''}`;
}

function recordLayout(label: string, event: LayoutChangeEvent) {
  if (config.screenshots.fixtures) console.info('PACKONE_LAYOUT', JSON.stringify({ label, ...event.nativeEvent.layout }));
}
function recordText(label: string, event: TextLayoutEvent) {
  if (config.screenshots.fixtures) console.info('PACKONE_TEXT', JSON.stringify({ label, lines: event.nativeEvent.lines.map(({ x, y, width, height, text }) => ({ x, y, width, height, text })) }));
}

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

// Keep card names and picking available when artwork is offline. Zoom supplies
// an explicit retry without adding another action inside the pick target.
function CardArtwork({ uri, name, style, zoom = false }: {
  uri: string; name: string; style: StyleProp<ViewStyle>; zoom?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  return <View style={[style, { backgroundColor: colors.surfaceSoft }]}>
    {failed === uri ? <View style={styles.imageError}>
      <Text style={styles.imageErrorText}>Image unavailable</Text>
      {zoom ? <Pressable accessibilityRole="button" accessibilityLabel={`Retry image for ${name}`}
        onPress={() => { setFailed(null); setAttempt(value => value + 1); }} style={styles.disclosureButton}>
        <Text style={styles.disclosureText}>Retry image</Text>
      </Pressable> : null}
    </View> : <Image key={`${uri}:${attempt}`} source={uri} style={StyleSheet.absoluteFill}
      contentFit={zoom ? 'contain' : 'cover'} cachePolicy="memory-disk" accessibilityLabel={name}
      onError={() => setFailed(uri)} />}
  </View>;
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
        <CardArtwork key={card.image_url} uri={card.image_url} name={card.name} style={styles.cardImage} />
      ) : (
        <View style={styles.cardFallback}>
          <Text style={styles.cardFallbackText}>{card.name}</Text>
        </View>
      )}
      <Text style={styles.cardName}>{card.name}</Text>
    </Pressable>
  );
}


function relativeSupport(support: number | undefined, leader: number) {
  if (!Number.isFinite(Number(support)) || leader <= 0) return 'Unavailable';
  return `${Math.round(100 * Number(support) / leader)}%`;
}

const REPORT_SENT_TEXT = 'Thanks \u2014 report sent.';
const ReportKeyboardAvoidingView = KeyboardAvoidingView ?? View;

const DECISION_REPORT_OPTIONS: readonly { value: DecisionReportReason; label: string }[] = [
  { value: 'draft_context', label: 'Draft context looks wrong' },
  { value: 'card_or_image', label: 'Card or image issue' },
  { value: 'score_recommendation', label: 'Score / recommendation seems wrong' },
  { value: 'broken', label: 'Something is broken' },
  { value: 'other', label: 'Other' },
];

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
  affiliate = false,
  onAffiliatePress,
}: {
  card: DraftRunCard | undefined;
  label: string;
  onZoom: (card: DraftRunCard) => void;
  affiliate?: boolean;
  onAffiliatePress?: (card: DraftRunCard) => void;
}) {
  if (!card) return null;
  return (
    <View style={styles.feedbackCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${card.name}. Open enlarged card.`}
        onPress={() => onZoom(card)}
        style={styles.feedbackCardZoom}
      >
        <Text style={styles.feedbackCardLabel}>{label}</Text>
        {card.image_url ? (
          <CardArtwork key={card.image_url} uri={card.image_url} name={card.name} style={styles.feedbackCardImage} />
        ) : (
          <View style={styles.feedbackCardFallback}>
            <Text style={styles.cardFallbackText}>{card.name}</Text>
          </View>
        )}
        <Text style={styles.feedbackCardName}>{card.name}</Text>
      </Pressable>
      {affiliate && onAffiliatePress ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Find ${card.name} on TCGplayer, affiliate link`}
          onPress={() => onAffiliatePress(card)}
          style={styles.shopLink}
        >
          <Text style={styles.shopLinkText}>Find on TCGplayer (affiliate link)</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function FeedbackAnalysis({
  answer,
  onZoom,
  onAffiliatePress,
}: {
  answer: DraftRunAnswer;
  onZoom: (card: DraftRunCard) => void;
  onAffiliatePress: (card: DraftRunCard) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const stackComparison = width < 360 || fontScale > 1.35;
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
      <View style={[styles.feedbackComparison, stackComparison && { flexDirection: 'column' }]}>
        <FeedbackCard
          affiliate
          card={selected}
          label={answer.historicalMatch ? 'Your pick · Trophy pick' : 'Your pick'}
          onAffiliatePress={onAffiliatePress}
          onZoom={onZoom}
        />
        {!answer.historicalMatch ? (
          <FeedbackCard affiliate card={trophy} label="Trophy pick" onAffiliatePress={onAffiliatePress} onZoom={onZoom} />
        ) : null}
      </View>
      <Text style={styles.affiliateDisclosure}>
        Affiliate links. Pack One may earn a commission from eligible TCGplayer purchases at no added cost to you.
      </Text>

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
                <Text style={styles.poolName}>{index + 1}. {card.name}</Text>
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
            <Text style={styles.cardName}>{card.name}</Text>
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

export default function DraftRunScreen({
  shared,
  screenshotFeedback: screenshotFeedbackOverride = false,
}: { shared?: SharedRunSurface; screenshotFeedback?: boolean } = {}) {
  const params = useLocalSearchParams<{ environment?: string; mode?: string; setIds?: string; screenshot?: string }>();
  const screenshotFeedback = config.screenshots.fixtures
    && (screenshotFeedbackOverride || params.screenshot === 'feedback');
  const practice = !shared && params.mode === 'practice';
  const requestedEnvironment = shared?.initialRun.environment
    ?? (typeof params.environment === 'string' ? params.environment : 'mixed');
  const practiceEnvironment: PracticeEnvironment = requestedEnvironment === 'powered-cube' ? 'powered-cube' : 'mixed';
  const environment: DailyEnvironment = practice
    ? practiceEnvironment
    : isDailyEnvironment(requestedEnvironment) ? requestedEnvironment : 'mixed';
  const setIdsParam = practice && typeof params.setIds === 'string' ? params.setIds : '';
  const setIds = useMemo(() => parsePracticeSets(setIdsParam), [setIdsParam]);
  const dailyMeta = DAILY_ENVIRONMENT_META[environment];
  const creatorChallenge = shared?.initialRun.comparison?.kind === 'creator';
  const surfaceMeta = shared
    ? shared.kind==='source'
      ? shared.sourceType==='daily'
        ? { eyebrow: 'DAILY DRAFT RUN', resultTitle: 'Your Draft Run.' }
        : { eyebrow: 'PRACTICE DRAFT RUN', resultTitle: 'Practice complete.' }
      : creatorChallenge
        ? { eyebrow: 'BEAT THE CREATOR', resultTitle: 'Creator challenge complete.' }
        : { eyebrow: 'SHARED DRAFT RUN', resultTitle: 'Shared run complete.' }
    : practice
      ? {
          eyebrow: setIds.length
            ? 'CUSTOM SET PRACTICE'
            : environment === 'powered-cube' ? 'POWERED CUBE PRACTICE' : 'PRACTICE DRAFT RUN',
          resultTitle: setIds.length
            ? 'Custom practice complete.'
            : environment === 'powered-cube' ? 'Powered Cube practice complete.' : 'Practice complete.',
        }
      : dailyMeta;
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const [feedbackWidth, setFeedbackWidth] = useState(0);
  const wideFeedback = feedbackWidth >= 520 * fontScale;
  const stackComparison = windowWidth < 360 || fontScale > 1.35;
  useEffect(() => {
    if (config.screenshots.fixtures) console.info('PACKONE_WINDOW', JSON.stringify({ width: windowWidth, fontScale }));
  }, [windowWidth, fontScale]);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const stateRef = useRef<LoadState>(state);
  const refreshGeneration = useRef(0);
  const mutationGeneration = useRef(0);
  const identityGeneration = useRef(0);
  const [mode, setMode] = useState<ViewMode>('pick');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [affiliateError, setAffiliateError] = useState<string | null>(null);
  const [zoomedCard, setZoomedCard] = useState<DraftRunCard | null>(null);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showPackReview, setShowPackReview] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<DecisionReportReason | null>(null);
  const [reportComment, setReportComment] = useState('');
  const [reportSending, setReportSending] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportedDecision, setReportedDecision] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  const commitState = (next: LoadState) => {
    stateRef.current = next;
    setState(next);
  };

  useEffect(() => subscribeSession((next) => {
    const current = stateRef.current;
    if (current.status !== 'ready' || (next && mobileSessionIdentity(next) === mobileSessionIdentity(current.session))) return;
    identityGeneration.current += 1;
    refreshGeneration.current += 1;
    mutationGeneration.current += 1;
    setSelected(null);
    setZoomedCard(null);
    setBusy(false);
    commitState({ status: 'error', message: 'Your account changed. Return to Daily or Practice to open a run for your current account.' });
  }), []);

  const beginRefresh = (current: ReadyState): RunResponseToken => ({
    request: ++refreshGeneration.current,
    mutation: mutationGeneration.current,
    session: mobileSessionIdentity(current.session),
    runId: current.run.id,
    revision: current.run.revision,
  });

  const refreshStillCurrent = (token: RunResponseToken, run: DraftRunState) => {
    const current = stateRef.current;
    return current.status === 'ready'
      && token.request === refreshGeneration.current
      && token.mutation === mutationGeneration.current
      && mobileSessionIdentity(current.session) === token.session
      && current.run.id === token.runId
      && current.run.revision === token.revision
      && run.id === token.runId
      && run.revision >= token.revision;
  };

  const beginMutation = (current: ReadyState): RunResponseToken => {
    const token = {
      request: ++refreshGeneration.current,
      mutation: ++mutationGeneration.current,
      session: mobileSessionIdentity(current.session),
      runId: current.run.id,
      revision: current.run.revision,
    };
    return token;
  };

  const mutationStillCurrent = (token: RunResponseToken, run?: DraftRunState) => {
    const current = stateRef.current;
    return current.status === 'ready'
      && token.mutation === mutationGeneration.current
      && mobileSessionIdentity(current.session) === token.session
      && current.run.id === token.runId
      && current.run.revision === token.revision
      && (!run || (run.id === token.runId && run.revision >= token.revision));
  };

  useAppResume(async () => {
    const current = stateRef.current;
    if (current.status !== 'ready' || busy) return;
    const token = beginRefresh(current);
    try {
      const previousRun = current.run;
      const run = shared
        ? await shared.loadRun()
        : practice
          ? await loadDraftRun(previousRun.id, current.session)
          : await startDailyDraftRun(current.session, environment);
      if (!refreshStillCurrent(token, run)) return;
      commitState({ status: 'ready', run, session: current.session });
      setSelected((selection) => (
        run.current?.puzzle_id === previousRun.current?.puzzle_id ? selection : null
      ));
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
    const identityEpoch = identityGeneration.current;
    const initial = shared
      ? Promise.resolve({ status: 'ready' as const, run: shared.initialRun, session: shared.session })
      : loadDraftSurface(environment, practice, setIds);
    void initial
      .then(async (loaded) => {
        if (!active) return;
        if (loaded.status === 'signin-required') {
          commitState({ status: 'signin-required' });
          return;
        }
        const persisted = await readSession();
        if (!active || identityEpoch !== identityGeneration.current) return;
        if (!persisted || mobileSessionIdentity(persisted) !== mobileSessionIdentity(loaded.session)) {
          commitState({ status: 'error', message: 'Your account changed while opening this run. Return to Daily or Practice.' });
          return;
        }
        let run = loaded.run;
        const screenshotCandidate = run.current?.candidates[0];
        if (
          screenshotFeedback
          && !shared
          && !run.complete
          && run.answers.length === 0
          && screenshotCandidate
        ) {
          run = await submitDraftRunPick(run, screenshotCandidate.id, loaded.session);
          if (!active) return;
        }
        const recoveredFeedback = Boolean(
          (shared || screenshotFeedback) && !run.complete && run.answers.length,
        );
        setReviewIndex(recoveredFeedback ? run.answers.length - 1 : null);
        setMode(run.complete ? 'result' : recoveredFeedback ? 'feedback' : 'pick');
        commitState({ status: 'ready', run, session: loaded.session });
      })
      .catch((error: unknown) => {
        if (!active) return;
        commitState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Draft Run is unavailable.',
        });
      });
    return () => {
      active = false;
      refreshGeneration.current += 1;
      mutationGeneration.current += 1;
    };
  }, [environment, practice, screenshotFeedback, setIds, shared]);

  const retry = async () => {
    refreshGeneration.current += 1;
    mutationGeneration.current += 1;
    commitState({ status: 'loading' });
    setSelected(null);
    setActionError(null);
    setMode('pick');
    const identityEpoch = identityGeneration.current;
    try {
      const loaded = shared
        ? { status: 'ready' as const, run: await shared.loadRun(), session: shared.session }
        : await loadDraftSurface(environment, practice, setIds);
      if (loaded.status === 'signin-required') {
        commitState({ status: 'signin-required' });
        return;
      }
      const persisted = await readSession();
      if (identityEpoch !== identityGeneration.current) return;
      if (!persisted || mobileSessionIdentity(persisted) !== mobileSessionIdentity(loaded.session)) {
        commitState({ status: 'error', message: 'Your account changed while opening this run. Return to Daily or Practice.' });
        return;
      }
      const recoveredFeedback = Boolean(shared && !loaded.run.complete && loaded.run.answers.length);
      setReviewIndex(recoveredFeedback ? loaded.run.answers.length - 1 : null);
      setMode(loaded.run.complete ? 'result' : recoveredFeedback ? 'feedback' : 'pick');
      commitState({ status: 'ready', run: loaded.run, session: loaded.session });
    } catch (error: unknown) {
      commitState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Draft Run is unavailable.',
      });
    }
  };

  const choose = (id: string) => {
    if (busy || mode !== 'pick') return;
    setSelected(id);
    setActionError(null);
    setAffiliateError(null);
    void Haptics.selectionAsync();
  };

  const showCommittedPick = async (
    run: DraftRunState,
    session: MobileSession,
    feedbackIndex: number,
    token: RunResponseToken,
  ) => {
    if (run.current) {
      const urls = run.current.candidates.map((card) => card.image_url).filter((url): url is string => Boolean(url));
      if (urls.length) void Image.prefetch(urls);
    }
    if (run.complete && practice) {
      await clearPracticeIdempotencyKey().catch(() => undefined);
    }
    // Clearing a completed practice key is asynchronous too. A route change
    // during that wait must not bring the previous run back onto the screen.
    if (!mutationStillCurrent(token, run)) return;
    commitState({ status: 'ready', run, session });
    setActionError(null);
    setReviewIndex(feedbackIndex);
    setShowAnalysis(false);
    setShowPackReview(false);
    setReportOpen(false);
    setReportReason(null);
    setReportComment('');
    setReportError(null);
    setReportedDecision(null);
    setMode('feedback');
    const latestAnswer = run.answers[feedbackIndex];
    if (latestAnswer) {
      AccessibilityInfo.announceForAccessibility(
        `${latestAnswer.score} out of 100. ${latestAnswer.historicalMatch
          ? 'You matched the trophy drafter.'
          : `The trophy drafter took ${latestAnswer.historicalName ?? 'another card'}.`}`,
      );
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    scroll.current?.scrollTo({ y: 0, animated: true });
  };

  const confirm = async () => {
    const current = stateRef.current;
    if (current.status !== 'ready' || !selected || !current.run.current || busy) return;
    const token = beginMutation(current);
    setBusy(true);
    try {
      const run = shared
        ? await shared.submitPick(current.run, selected)
        : await submitDraftRunPick(current.run, selected, current.session);
      if (!mutationStillCurrent(token, run)) return;
      await showCommittedPick(run, current.session, current.run.answers.length, token);
    } catch (error: unknown) {
      if (!mutationStillCurrent(token)) return;
      const message = error instanceof Error ? error.message : 'Your pick could not be saved.';
      try {
        const reconciled = shared ? await shared.loadRun() : await loadDraftRun(current.run.id, current.session);
        if (!mutationStillCurrent(token, reconciled)) return;
        const expectedRound = current.run.answers.length;
        const recovered = reconciled.answers[expectedRound];
        if (
          recovered
          && recovered.puzzle.puzzle_id === current.run.current.puzzle_id
          && recovered.selectedId === selected
        ) {
          await showCommittedPick(reconciled, current.session, expectedRound, token);
          return;
        }
        if (reconciled.revision !== current.run.revision) {
          commitState({ status: 'ready', run: reconciled, session: current.session });
          setSelected(null);
          setMode(reconciled.complete ? 'result' : 'pick');
          setActionError('Your run changed elsewhere. The latest server state is loaded.');
          return;
        }
      } catch {
        // A failed reconciliation does not erase the still-valid mounted run.
      }
      if (mutationStillCurrent(token)) setActionError(message);
    } finally {
      setBusy(false);
    }
  };

  const openDecisionReport = () => {
    const current = stateRef.current;
    const answer = current.status === 'ready' && reviewIndex !== null ? current.run.answers[reviewIndex] : null;
    if (!answer) return;
    setReportReason(null);
    setReportComment('');
    setReportError(null);
    setReportOpen(true);
  };

  const sendDecisionReport = async () => {
    const current = stateRef.current;
    if (current.status !== 'ready' || reviewIndex === null || !reportReason || reportSending) return;
    const answer = current.run.answers[reviewIndex];
    if (!answer) return;
    setReportSending(true);
    setReportError(null);
    try {
      await submitDraftRunDecisionReport(
        current.run,
        reviewIndex,
        reportReason,
        reportComment,
        current.session,
      );
      setReportedDecision(answer.puzzle.puzzle_id);
      setReportOpen(false);
      setReportReason(null);
      setReportComment('');
      AccessibilityInfo.announceForAccessibility(REPORT_SENT_TEXT);
    } catch (error: unknown) {
      setReportError(error instanceof Error ? error.message : 'Could not send the report. Try again.');
    } finally {
      setReportSending(false);
    }
  };

  const openAffiliateCard = (card: DraftRunCard) => {
    setAffiliateError(null);
    let url: string;
    try {
      url = tcgplayerUrl(card.name);
    } catch {
      setAffiliateError('This card could not be opened on TCGplayer.');
      return;
    }
    void Linking.openURL(url).catch(() => {
      setAffiliateError('Could not open TCGplayer. You can try the affiliate link again.');
    });
  };

  const shareResult = async () => {
    if (state.status !== 'ready' || !state.run.complete) return;
    const matches = state.run.answers.filter((item) => item.historicalMatch).length;
    const resultEnvironment = state.run.environment;
    const label = resultEnvironment === 'latest' ? 'Latest Set' : resultEnvironment === 'powered-cube' ? 'Powered Cube' : 'Draft Run';
    const squares = state.run.answers.map((item) => (
      item.historicalMatch ? '🟩' : item.score >= 85 ? '🟦' : item.score >= 60 ? '🟨' : item.score >= 25 ? '🟧' : '⬛'
    )).join('');
    setShareError(null);
    try {
      const setParam = resultEnvironment === 'powered-cube' || resultEnvironment === 'latest' ? `&set=${resultEnvironment}` : '';
      const share = state.run.day ? null : (shared ? await shared.createShare() : await createDraftRunShare(state.run.id, state.session));
      const url = state.run.day
        ? `https://packone.pro/share/daily/?environment=${encodeURIComponent(resultEnvironment)}&ref=result_share`
        : share?.creator && share.url
          ? share.url
          : `https://packone.pro/?game=draft-run${setParam}&shared=${share?.id}`;
      const creator = state.run.comparison?.kind === 'creator' ? state.run.comparison : null;
      const text = state.run.day
        ? `I scored ${state.run.score ?? 0}/100 on today’s Pack One ${label}. Can you beat it?\n${squares}\n${matches}/${state.run.run_length} trophy picks matched · Daily ${state.run.day}`
        : creator
          ? `I scored ${state.run.score ?? 0}/100 trying to beat ${creator.name} on Pack One.\n${Number(creator.creator_matches ?? 0)}/${state.run.run_length} creator picks matched · ${Number(creator.trophy_matches ?? matches)}/${state.run.run_length} trophy picks matched.`
          : `Pack One · ${label} · ${shared ? 'Shared run' : 'Practice'}\n${state.run.score ?? 0}/100  ${squares}\n${matches}/${state.run.run_length} trophy picks matched. Play this run and compare.`;
      await Share.share({ message: `${text}\n${url}` });
    } catch {
      setShareError('Could not open sharing. Your result is still saved.');
    }
  };

  const reroll = async (type: 'set' | 'pack') => {
    const current = stateRef.current;
    if (current.status !== 'ready' || !practice || mode !== 'pick' || !current.run.current || busy) return;
    const token = beginMutation(current);
    setBusy(true);
    setSelected(null);
    setActionError(null);
    try {
      const run = await rerollDraftRun(current.run, type, current.session);
      if (!mutationStillCurrent(token, run)) return;
      if (run.current) {
        const urls = run.current.candidates.map((card) => card.image_url).filter((url): url is string => Boolean(url));
        if (urls.length) void Image.prefetch(urls);
      }
      commitState({ status: 'ready', run, session: current.session });
      void Haptics.selectionAsync();
      scroll.current?.scrollTo({ y: 0, animated: true });
    } catch (error: unknown) {
      if (mutationStillCurrent(token)) {
        setActionError(error instanceof Error ? error.message : 'That reroll could not be saved.');
      }
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (state.status !== 'ready') return;
    setReviewIndex(null);
    setShowAnalysis(false);
    setShowPackReview(false);
    setAffiliateError(null);
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
    setAffiliateError(null);
    setSelected(null);
    setMode('feedback');
    scroll.current?.scrollTo({ y: 0, animated: true });
  };

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>{shared ? 'Recovering your shared run…' : 'Finding today’s packs…'}</Text>
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
    const creator = run.comparison?.kind === 'creator' ? run.comparison : null;
    const resultTitle = creator
      ? creator.outcome === 'win' ? `You beat ${creator.name}`
        : creator.outcome === 'tie' ? `You tied ${creator.name}`
          : creator.outcome === 'loss' ? `${creator.name} got you this time`
            : surfaceMeta.resultTitle
      : surfaceMeta.resultTitle;
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.resultPage}>
          <Text style={styles.eyebrow}>{surfaceMeta.eyebrow} COMPLETE</Text>
          <Text style={styles.title}>{resultTitle}</Text>
          <View style={styles.scoreBlock}>
            <Text style={styles.score}>{run.score ?? 0}</Text>
            <Text style={styles.scoreMeta}>/100 · {creator
              ? `${Number(creator.creator_matches ?? 0)}/${run.run_length} creator picks · ${Number(creator.trophy_matches ?? matches)}/${run.run_length} trophy picks`
              : `${matches} trophy picks matched`}</Text>
          </View>
          {shared && run.comparison ? (
            <View style={styles.analysisPanel}>
              <Text style={styles.analysisTitle}>You: {run.score ?? 0} · {run.comparison.name}: {run.comparison.score}</Text>
              <Text style={styles.resultBody}>{creator
                ? creator.outcome === 'win' ? `You beat ${creator.name}.` : creator.outcome === 'loss' ? `${creator.name} won this challenge.` : 'This creator challenge was a tie.'
                : run.comparison.exact
                  ? Number(run.score) > run.comparison.score ? 'You won this shared run.' : Number(run.score) < run.comparison.score ? 'Your friend won this shared run.' : 'This shared run was a tie.'
                  : 'These results are not an exact same-decision comparison.'}</Text>
              {creator?.creator_post_run_note ? <Text style={styles.resultBody}>{creator.name} after the run: “{creator.creator_post_run_note}”</Text> : null}
            </View>
          ) : null}
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
          <Pressable accessibilityRole="button" onPress={() => router.dismissTo(creatorChallenge ? '/' : practice || shared ? '/practice' : '/')} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{creatorChallenge ? 'Back to Dailies' : practice || shared ? 'Return to Practice' : 'Home'}</Text>
          </Pressable>
          {shareError ? <Text accessibilityRole="alert" style={styles.actionError}>{shareError}</Text> : null}
          <View style={styles.guestNote}>
            <Text style={styles.guestNoteTitle}>
              {creatorChallenge ? 'Creator replay saved' : practice || shared ? 'Saved to your career' : state.session.accountToken ? 'Saved to your account' : 'Guest result'}
            </Text>
            <Text style={styles.resultBody}>
              {creatorChallenge
                ? 'This is an unranked creator replay. It does not consume or modify your Daily attempt, streak, or leaderboard result.'
                : shared
                  ? 'This is your saved shared run. Reopening the invitation recovers the same picks and result, not another attempt.'
                  : practice
                  ? 'Practice builds your career. Play the Dailies to join the leaderboard.'
                  : state.session.accountToken
                    ? 'Your result is saved to your Pack One account.'
                    : 'Sign in or create your Pack One account to validate this Daily score and keep your career across devices.'}
            </Text>
            {!shared && !practice && !state.session.accountToken ? (
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
            {practice || shared ? surfaceMeta.eyebrow : `${dailyMeta.eyebrow} · ${run.day ?? 'TODAY'}`}
          </Text>
          <Text style={styles.title}>
            {puzzle.set_id.toUpperCase()} <Text style={styles.titleMeta}>· Pack 1 · Pick {puzzle.pick_number}</Text>
          </Text>
          <Progress run={run} />

          {mode === 'feedback' && answer ? (
            <>
              <View testID="pick-feedback" onLayout={(event) => { setFeedbackWidth(event.nativeEvent.layout.width); recordLayout('feedback', event); }} style={[styles.feedback, wideFeedback && styles.feedbackWide]}>
                <Text testID="feedback-score" onLayout={(event) => recordLayout('score', event)} onTextLayout={(event) => recordText('score', event)} style={styles.feedbackScoreNumber}>{answer.score}<Text style={styles.feedbackScoreSuffix}>/100</Text></Text>
                <View testID="feedback-copy" onLayout={(event) => recordLayout('copy', event)} style={[styles.feedbackCopy, wideFeedback && styles.feedbackCopyWide]}>
                  <Text testID="feedback-title" onLayout={(event) => recordLayout('title', event)} onTextLayout={(event) => recordText('title', event)} style={styles.feedbackTitle}>
                    {answer.historicalMatch
                      ? 'You matched the trophy drafter.'
                      : `The trophy drafter took ${answer.historicalName ?? 'another card'}.`}
                  </Text>
                  <Text testID="feedback-choice" onLayout={(event) => recordLayout('choice', event)} onTextLayout={(event) => recordText('choice', event)} style={styles.feedbackBody}>You chose {answer.selectedName}.</Text>
                </View>
              </View>

              <View style={[styles.feedbackComparison, stackComparison && { flexDirection: 'column' }]}>
                {(() => {
                  const roles: { id: string; label: string }[] = [
                    { id: answer.selectedId, label: 'Your Pick' },
                    ...(run.comparison?.kind === 'creator' && answer.creatorId
                      ? [{ id: answer.creatorId, label: `${run.comparison.name}’s Pick` }]
                      : []),
                    ...(answer.historicalId ? [{ id: answer.historicalId, label: 'Trophy Pick' }] : []),
                  ];
                  const grouped = new Map<string, string[]>();
                  for (const role of roles) grouped.set(role.id, [...(grouped.get(role.id) ?? []), role.label]);
                  return [...grouped].map(([id, labels]) => (
                    <FeedbackCard
                      key={id}
                      card={puzzle.candidates.find((card) => card.id === id)}
                      label={labels.join(' · ')}
                      onZoom={setZoomedCard}
                    />
                  ));
                })()}
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showAnalysis }}
                onPress={() => setShowAnalysis((value) => !value)}
                style={styles.disclosureButton}
              >
                <Text style={styles.disclosureText}>{showAnalysis ? 'Hide score analysis' : 'Why this score?'}</Text>
              </Pressable>
              {showAnalysis ? (
                <>
                  <FeedbackAnalysis answer={answer} onAffiliatePress={openAffiliateCard} onZoom={setZoomedCard} />
                  {affiliateError ? <Text accessibilityRole="alert" style={styles.actionError}>{affiliateError}</Text> : null}
                  <View style={styles.decisionReport}>
                    <Pressable accessibilityRole="button" onPress={openDecisionReport} style={styles.decisionReportButton}>
                      <Text style={styles.decisionReportText}>Report this decision</Text>
                    </Pressable>
                    {reportedDecision === answer.puzzle.puzzle_id ? (
                      <Text style={styles.decisionReportStatus}>{REPORT_SENT_TEXT}</Text>
                    ) : null}
                  </View>
                </>
              ) : null}

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
                      <Pressable
                        key={`${card.id}-${index}`}
                        accessibilityRole="button"
                        accessibilityLabel={`View earlier pick ${index + 1}: ${card.name}`}
                        onPress={() => setZoomedCard(card)}
                        style={styles.poolCard}
                      >
                        {card.image_url ? (
                          <Image source={card.image_url} style={styles.poolImage} contentFit="cover" cachePolicy="memory-disk" />
                        ) : null}
                        <Text style={styles.poolName}>{index + 1}. {card.name}</Text>
                      </Pressable>
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
          animationType="slide"
          onRequestClose={() => { if (!reportSending) setReportOpen(false); }}
          transparent
          visible={reportOpen}
        >
          <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.reportModalSafe}>
            <ReportKeyboardAvoidingView behavior={Platform?.OS === 'ios' ? 'padding' : undefined} style={styles.reportKeyboard}>
              <View accessibilityViewIsModal style={styles.reportSheet}>
                <Text style={styles.reportTitle}>What seems wrong?</Text>
                <View accessibilityRole="radiogroup" style={styles.reportReasons}>
                  {DECISION_REPORT_OPTIONS.map((option) => (
                    <Pressable
                      key={option.value}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: reportReason === option.value }}
                      disabled={reportSending}
                      onPress={() => setReportReason(option.value)}
                      style={[styles.reportReason, reportReason === option.value && styles.reportReasonSelected]}
                    >
                      <View style={[styles.reportRadio, reportReason === option.value && styles.reportRadioSelected]} />
                      <Text style={styles.reportReasonText}>{option.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.reportCommentLabel}>Anything else?</Text>
                <TextInput
                  accessibilityLabel="Anything else?"
                  editable={!reportSending}
                  maxLength={500}
                  multiline
                  onChangeText={setReportComment}
                  placeholder="Optional"
                  style={styles.reportComment}
                  value={reportComment}
                />
                {reportError ? <Text accessibilityRole="alert" style={styles.actionError}>{reportError}</Text> : null}
                <View style={styles.reportActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!reportReason || reportSending}
                    onPress={() => void sendDecisionReport()}
                    style={[styles.reportSend, (!reportReason || reportSending) && styles.primaryButtonDisabled]}
                  >
                    {reportSending ? <ActivityIndicator color="#fff" /> : <Text style={styles.reportSendText}>Send report</Text>}
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={reportSending}
                    onPress={() => setReportOpen(false)}
                    style={styles.reportCancel}
                  >
                    <Text style={styles.reportCancelText}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            </ReportKeyboardAvoidingView>
          </SafeAreaView>
        </Modal>

        <Modal
          animationType="fade"
          onRequestClose={() => setZoomedCard(null)}
          transparent
          visible={zoomedCard !== null}
        >
          <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.zoomSafe}>
            <View accessibilityViewIsModal style={styles.zoomPanel}>
              {zoomedCard?.image_url ? (
                <CardArtwork key={zoomedCard.image_url} uri={zoomedCard.image_url} name={`${zoomedCard.name} enlarged card`} style={styles.zoomImage} zoom />
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
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, alignSelf: 'center', width: '100%', maxWidth: 980 },
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
    minHeight: 44,
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
    paddingVertical: spacing.sm,
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
    flexDirection: 'column',
    gap: spacing.md,
  },
  feedbackWide: { flexDirection: 'row', alignItems: 'center' },
  feedbackCopyWide: { flex: 1 },
  feedbackScore: { flexDirection: 'row', alignItems: 'baseline' },
  feedbackScoreNumber: { flexShrink: 1, color: colors.ink, fontSize: 44, lineHeight: 48, fontWeight: '800' },
  feedbackScoreSuffix: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  feedbackCopy: { minWidth: 0, flexShrink: 1, gap: spacing.sm, justifyContent: 'center' },
  feedbackTitle: { color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: '800' },
  feedbackBody: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  feedbackComparison: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  feedbackCard: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    width: '100%',
    maxWidth: 420,
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
  feedbackCardZoom: { gap: spacing.xs },
  shopLink: { minHeight: 44, justifyContent: 'center', paddingVertical: spacing.xs },
  shopLinkText: { color: colors.accentDark, fontSize: 12, lineHeight: 16, fontWeight: '800', textDecorationLine: 'underline' },
  affiliateDisclosure: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  analysisPanel: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.md },
  analysisLead: { color: colors.ink, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  analysisTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: '800' },
  analysisSubhead: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  analysisBody: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  rankingLine: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.sm, gap: 2 },
  rankingName: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  rankingMeta: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  modelNote: { color: colors.muted, fontSize: 12, lineHeight: 18, fontStyle: 'italic' },
  decisionReport: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.sm, gap: spacing.xs, alignItems: 'flex-start' },
  decisionReportButton: { minHeight: 44, justifyContent: 'center', paddingVertical: spacing.xs },
  decisionReportText: { color: colors.muted, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  decisionReportStatus: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  reportModalSafe: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16, 24, 32, 0.58)' },
  reportKeyboard: { flex: 1, justifyContent: 'flex-end' },
  reportSheet: { backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.line, padding: spacing.lg, gap: spacing.md },
  reportTitle: { color: colors.ink, fontSize: 20, lineHeight: 25, fontWeight: '800' },
  reportReasons: { gap: spacing.xs },
  reportReason: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  reportReasonSelected: { borderColor: colors.accent },
  reportRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.lineStrong },
  reportRadioSelected: { borderWidth: 6, borderColor: colors.accent },
  reportReasonText: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 20 },
  reportCommentLabel: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  reportComment: { minHeight: 84, maxHeight: 150, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, color: colors.ink, padding: spacing.sm, textAlignVertical: 'top', fontSize: 14 },
  reportActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  reportSend: { minHeight: 48, minWidth: 120, paddingHorizontal: spacing.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  reportSendText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  reportCancel: { minHeight: 48, minWidth: 90, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  reportCancelText: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
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
  resultReviewCopy: { flex: 1, minWidth: 0, gap: 2 },
  resultReviewTitle: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  resultReviewScore: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  resultPage: { padding: spacing.lg, paddingTop: spacing.xxl, paddingBottom: spacing.xxl, gap: spacing.lg, alignSelf: 'center', width: '100%', maxWidth: 980 },
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
  imageError: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.sm, gap: spacing.sm },
  imageErrorText: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
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
