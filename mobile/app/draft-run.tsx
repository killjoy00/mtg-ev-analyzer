import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Settings,
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
import { CardFaceViewer } from '@/src/components/CardFaceViewer';
import { TrophyDeckSheet } from '@/src/components/TrophyDeckSheet';
import { cardFaceIndicator } from '../../card-faces.mjs';

import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';

import { ensureGuestSession } from '@/src/api/guest';
import {
  createDraftRunShare,
  DAILY_ENVIRONMENT_META,
  isDailyEnvironment,
  loadDailyPeerStats,
  loadDailyStatus,
  loadDraftRun,
  loadTrophyDeck,
  rerollDraftRun,
  recordDraftRunView,
  startDailyDraftRun,
  startPracticeDraftRun,
  submitDraftRunDecisionReport,
  submitDraftRunPick,
  type DailyEnvironment,
  type DailyPeerStats,
  type DailyStatus,
  type DecisionReportReason,
  type DraftRunAnswer,
  type DraftRunCard,
  type DraftRunState,
  type PracticeEnvironment,
  type TrophyDeck,
} from '@/src/api/draftRun';
import { config } from '@/src/config';
import { maybeRequestPackOneRating } from '@/src/ratingPrompt';
import { useAppResume } from '@/src/hooks/useAppResume';
import { clearPracticeIdempotencyKey, practiceIdempotencyKey } from '@/src/storage/idempotency';
import { readSession, subscribeSession, type MobileSession } from '@/src/storage/session';
import type { SharedRunSurface } from '@/src/state/sharedRunSurface';
import { colors, spacing } from '@/src/theme';
import { themedStyles, themeColor, useAppTheme, withAppTheme } from '@/src/appearance';
import { cardColumnCount, nextCardSize, useCardSizePreference, writeCardSize } from '@/src/cardSize';
import { trophyDrafterFacts, trophyDrafterSentences } from '@/src/trophyDrafter';
import {
  compactRevealFeedback,
  compareAllRanking,
  MODEL_NOTE,
  modelSupportLabel,
  revealCardChoices,
  revealChoiceScore,
  SCORING_COPY,
  trophyRevealSentence,
} from '@/src/reveal';
import {
  completedAllDailies,
  dailySetRunIds,
  dailySetShareRuns,
  dailySetShareText,
  dailyShareUrl,
  draftRunShareText,
  nextUnfinishedDaily,
} from '@/src/dailyShare';
import { dailyResetCue, pacificDay } from '@/src/dailyClock';
import { createForegroundDecisionTimer } from '@/src/decisionTiming';
import { setGuideUrl } from '@/src/setGuides';
import setDisplayNames from '../../data/set-display-names.json';

const resultSetName = (id: string) => (setDisplayNames.names as Record<string, string>)[String(id || '').toLowerCase()] || String(id || '').toUpperCase();

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

function Progress({ run, tablet = false }: { run: DraftRunState; tablet?: boolean }) {
  const appearance = useAppTheme();
  // visual-c.css names the shared navy accent --green; it is not a green hue.
  const completedColor = appearance === 'dark' ? themeColor('accentDark') : themeColor('accent');
  const completed = run.answers.length;
  const scores = run.answers.map((answer, index) => `Pick ${index + 1}: ${answer.score} points`).join(', ');
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Draft Run progress"
      accessibilityValue={{ min: 0, max: run.run_length, now: completed,
        text: `${completed} of ${run.run_length} picks completed${scores ? `. ${scores}` : ''}` }}
      style={[styles.progress, tablet && styles.progressTablet]}>
      {Array.from({ length: run.run_length }, (_, index) => {
        const answer = run.answers[index];
        const current = index === completed && !run.complete;
        return <View key={index} style={[styles.progressStep,
          answer && { borderBottomColor: completedColor }, current && styles.progressCurrent]}>
          <Text style={[styles.progressIndex, current && styles.progressIndexCurrent]}>{index + 1}</Text>
          {answer ? <Text style={[styles.progressScore, { color: completedColor }]}>
            {answer.score}{tablet ? ' pts' : ''}
          </Text> : null}
        </View>;
      })}
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
  return <View style={[style, { backgroundColor: themeColor('surfaceSoft') }]}>
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
  tablet = false,
  sizeStyle,
}: {
  card: DraftRunCard;
  tablet?: boolean;
  sizeStyle?: StyleProp<ViewStyle>;
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
      style={[styles.card, tablet && styles.tabletPickCard, sizeStyle, selected && styles.cardSelected]}
    >
      {card.image_url ? (
        <CardArtwork key={card.image_url} uri={card.image_url} name={card.name} style={styles.cardImage} />
      ) : (
        <View style={styles.cardFallback}>
          <Text style={styles.cardFallbackText}>{card.name}</Text>
        </View>
      )}
      <Text style={styles.cardName}>{card.name}</Text>
      {cardFaceIndicator(card) ? <Text style={styles.cardName}>{cardFaceIndicator(card)} · Hold to view</Text> : null}
    </Pressable>
  );
}


// Same copy as the web report dialog in draft-run-product.mjs.
const REPORT_SENT_TEXT = 'Thanks for letting me know.';
const ReportKeyboardAvoidingView = KeyboardAvoidingView ?? View;

const DECISION_REPORT_OPTIONS: readonly { value: DecisionReportReason; label: string }[] = [
  { value: 'draft_context', label: 'The draft context looks wrong' },
  { value: 'card_or_image', label: 'The card or image looks wrong' },
  { value: 'score_recommendation', label: 'The pick or score looks wrong' },
  { value: 'uninteresting', label: 'This isn’t an interesting pick' },
  { value: 'broken', label: 'Something isn’t working' },
  { value: 'other', label: 'Other' },
];

type ChoiceTone = 'mine' | 'trophy' | 'match' | 'other';
type CardShares = Record<string, number> | null;

// Per-card shares arrive with an available Daily summary. Cards nobody picked show 0%.
function peerShare(shares: CardShares, id: string) {
  if (!shares) return null;
  const value = Number(shares[id]);
  return `${Number.isFinite(value) ? value : 0}%`;
}

function RevealChoiceCard({
  card,
  label,
  tone,
  score,
  support,
  players,
  onZoom,
  stack = false,
}: {
  card: DraftRunCard;
  label: string;
  tone: ChoiceTone;
  score: number | null;
  support: string;
  players: string | null;
  onZoom: (card: DraftRunCard) => void;
  stack?: boolean;
}) {
  const toneStyle = tone === 'match' ? styles.choiceMatch : tone === 'trophy' ? styles.choiceTrophy : tone === 'mine' ? styles.choiceMine : null;
  const labelStyle = tone === 'match' ? styles.choiceLabelMatch : tone === 'trophy' ? styles.choiceLabelTrophy : tone === 'mine' ? styles.choiceLabelMine : null;
  return (
    <View style={[styles.feedbackCard, !stack && styles.feedbackCardRowItem, toneStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${card.name}. Open enlarged card.`}
        onPress={() => onZoom(card)}
        style={styles.feedbackCardZoom}
      >
        <Text style={[styles.feedbackCardLabel, labelStyle]}>{label}</Text>
        {card.image_url ? (
          <CardArtwork key={card.image_url} uri={card.image_url} name={card.name} style={styles.feedbackCardImage} />
        ) : (
          <View style={styles.feedbackCardFallback}>
            <Text style={styles.cardFallbackText}>{card.name}</Text>
          </View>
        )}
        <Text style={styles.feedbackCardName}>{card.name}</Text>
      </Pressable>
      <View accessible accessibilityLabel={`Score ${score == null ? 'not available' : `${score} out of 100`}. Model support ${support === '-' ? 'not shown for the trophy pick' : support}.${players ? ` Players’ picks ${players}.` : ''}`} style={styles.choiceStats}>
        <Text style={styles.choiceStatLabel}>Score</Text>
        <Text style={styles.choiceScore}>{score == null ? 'N/A' : score}<Text style={styles.feedbackScoreSuffix}>/100</Text></Text>
        <View style={styles.choiceStatRow}>
          <Text style={styles.choiceStatLabel}>Model support</Text>
          <Text style={styles.choiceStatValue}>{support}</Text>
        </View>
        {players ? (
          <View style={styles.choiceStatRow}>
            <Text style={styles.choiceStatLabel}>Players’ picks</Text>
            <Text style={styles.choiceStatValue}>{players}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// The trophy pick, your pick, then the model's next strongest card, as on the
// web reveal. Points are the saved scores; support is relative to the leader.
function RevealComparison({
  answer,
  creatorName,
  shares,
  stack,
  onZoom,
}: {
  answer: DraftRunAnswer;
  creatorName: string | null;
  shares: CardShares;
  stack: boolean;
  onZoom: (card: DraftRunCard) => void;
}) {
  const byId = new Map(answer.puzzle.candidates.map((card) => [card.id, card]));
  const choices = revealCardChoices(answer);
  const creator = creatorName && answer.creatorId && !choices.some((choice) => choice.id === answer.creatorId)
    ? byId.get(answer.creatorId)
    : null;
  return (
    <>
      <View style={[styles.feedbackComparison, stack && { flexDirection: 'column' }]}>
        {choices.map((choice) => {
          const card = byId.get(choice.id);
          if (!card) return null;
          const mine = card.id === answer.selectedId;
          const trophy = card.id === answer.historicalId;
          const ranked = answer.ranking?.find((item) => item.id === card.id);
          return (
            <RevealChoiceCard
              key={card.id}
              card={card}
              label={choice.label + (creatorName && card.id === answer.creatorId ? ` · ${creatorName}’s pick` : '')}
              tone={mine && trophy ? 'match' : trophy ? 'trophy' : mine ? 'mine' : 'other'}
              score={revealChoiceScore(answer, card.id)}
              support={modelSupportLabel(ranked?.support, answer.consensusSupport, trophy)}
              players={peerShare(shares, card.id)}
              onZoom={onZoom}
              stack={stack}
            />
          );
        })}
      </View>
      {creator ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${creatorName} picked ${creator.name}. Open enlarged card.`} onPress={() => onZoom(creator)} style={styles.inlineLink}>
          <Text style={styles.analysisBody}>{creatorName} picked <Text style={styles.inlineLinkText}>{creator.name}</Text>.</Text>
        </Pressable>
      ) : null}
    </>
  );
}

// Source-drafter background stays below the score explanation. The decklist
// link appears only when the server says this revealed pick has one.
function TrophyDrafterDetails({ answer, onOpenDeck }: { answer: DraftRunAnswer; onOpenDeck: () => void }) {
  const lines = trophyDrafterSentences(trophyDrafterFacts(answer));
  const deck = answer.deckAvailable === true;
  if (!lines.length && !deck) return null;
  return (
    <View style={styles.trophyRecord}>
      {lines.slice(0, 1).map((line) => <Text key={line} style={styles.trophyRecordLead}>{line}</Text>)}
      {deck ? (
        <Pressable accessibilityRole="button" accessibilityHint="Opens the decklist" onPress={onOpenDeck} style={styles.inlineLink}>
          <Text style={styles.inlineLinkText}>See the trophy drafter’s deck</Text>
        </Pressable>
      ) : null}
      {lines.slice(1).map((line) => <Text key={line} style={styles.analysisBody}>{line}</Text>)}
    </View>
  );
}

// Expanded analysis: every card by model support. Card names still enlarge;
// no marketplace links or affiliate disclosures appear in the revealed pack.
function CompareAllCards({
  answer,
  shares,
  onZoom,
}: {
  answer: DraftRunAnswer;
  shares: CardShares;
  onZoom: (card: DraftRunCard) => void;
}) {
  const byId = new Map(answer.puzzle.candidates.map((card) => [card.id, card]));
  // Every scored answer carries a ranking; an older one without it still
  // lists the pack, using only the saved scores.
  const ranked = compareAllRanking(answer);
  const ranking = ranked.length ? ranked : answer.puzzle.candidates.map((card) => ({
    id: card.id, name: card.name, support: undefined as number | undefined, score: revealChoiceScore(answer, card.id),
  }));
  return (
    <View style={styles.analysisPanel}>
      <Text style={styles.modelNote}>
        Model support is relative to the model’s top choice.{shares ? ' See what other Pack One players picked today.' : ''}
      </Text>
      {ranking.map((item) => {
        const card = byId.get(item.id);
        const players = peerShare(shares, item.id);
        return (
          <View key={`all-${item.id}`} style={styles.rankingLine}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name}${item.id === answer.selectedId ? ', your pick' : ''}${item.id === answer.historicalId ? ', trophy pick' : ''}. Open enlarged card.`}
              disabled={!card}
              onPress={() => { if (card) onZoom(card); }}
            >
              <Text style={styles.rankingName}>
                {item.name}
                {item.id === answer.selectedId ? ' · Your pick' : ''}
                {item.id === answer.historicalId ? ' · Trophy pick' : ''}
              </Text>
            </Pressable>
            <Text style={styles.rankingMeta}>
              Model support {modelSupportLabel(item.support, answer.consensusSupport, item.id === answer.historicalId)} · Score {item.score == null ? 'N/A' : Number(item.score)}
              {players ? ` · Players’ picks ${players}` : ''}
            </Text>
          </View>
        );
      })}
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
          <Text style={styles.analysisSubhead}>Earlier picks</Text>
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
            {cardFaceIndicator(card) ? <Text style={styles.cardName}>{cardFaceIndicator(card)} · Hold to view</Text> : null}
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

function DraftRunScreen({
  shared,
  screenshotFeedback: screenshotFeedbackOverride = false,
}: { shared?: SharedRunSurface; screenshotFeedback?: boolean } = {}) {
  const params = useLocalSearchParams<{ environment?: string; mode?: string; setIds?: string; screenshot?: string }>();
  const screenshotFeedback = config.screenshots.fixtures
    && (screenshotFeedbackOverride || params.screenshot === 'feedback');
  const screenshotFocusCards = config.screenshots.fixtures && (Settings?.get?.('packoneScreenshotScene') === 'daily-decision' || params.screenshot === 'decision');
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
  // A three-column grid keeps all five choices visible on full-width iPads.
  // This is the actual tablet gameplay layout, not a screenshot composite.
  const tabletPickGrid = windowWidth >= 840 && fontScale <= 1.35;
  const { size: cardSize, ready: cardSizeReady } = useCardSizePreference();
  const inlineProgress = windowWidth >= 960 && fontScale <= 1.15;
  const changeCardSize = useCallback(() => {
    void writeCardSize(nextCardSize(cardSize));
  }, [cardSize]);
  const cardColumns = cardColumnCount(cardSize, tabletPickGrid, fontScale > 1.35);
  const cardWidth = ({ 1: '100%', 2: '48.5%', 3: '32%', 4: '23.5%' } as const)[cardColumns as 1 | 2 | 3 | 4];
  const [feedbackWidth, setFeedbackWidth] = useState(0);
  const wideFeedback = feedbackWidth >= 520 * fontScale;
  const compactFeedback = wideFeedback || (windowWidth >= 350 && fontScale <= 1.3);
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
  const [rolloverNotice, setRolloverNotice] = useState<string | null>(null);
  const [newDailyAvailable, setNewDailyAvailable] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
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
  const [dailyPeers, setDailyPeers] = useState<{ runId: string; round: number; stats: DailyPeerStats } | null>(null);
  const [deckOpen, setDeckOpen] = useState(false);
  const deckCache = useRef(new Map<string, Promise<TrophyDeck>>());
  // Result-screen Daily status for the next-Daily action, reset cue, guest
  // handoff and three-Daily share. Bound to the run it was read for.
  const [resultStatus, setResultStatus] = useState<{ runId: string; status: DailyStatus } | null>(null);
  const [dailySet, setDailySet] = useState<{ runId: string; runs: DraftRunState[] } | null>(null);
  const [shareScope, setShareScope] = useState<'day' | 'run'>('run');
  const [sharing, setSharing] = useState(false);
  const dailySetDefaulted = useRef<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const screenshotCardPositioned = useRef(false);
  const lastObservedDecision = useRef<string | null>(null);
  const decisionTimer = useRef(createForegroundDecisionTimer());
  const mountedPacificDay = useRef(pacificDay());
  const refreshInFlight = useRef(false);
  const refreshRunRef = useRef<(openCompletedDaily?: boolean) => Promise<void>>(async () => {});
  const [screenFocused, setScreenFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  // A mounted route can remain obscured by another screen. Loading a pack
  // while backgrounded is not an observed decision.
  useFocusEffect(useCallback(() => {
    setScreenFocused(true);
    return () => {
      decisionTimer.current.pause();
      setScreenFocused(false);
    };
  }, []));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'active') decisionTimer.current.pause();
      setAppActive(next === 'active');
    });
    return () => subscription.remove();
  }, []);

  const commitState = (next: LoadState) => {
    stateRef.current = next;
    setState(next);
  };

  // Stop timing while backgrounded, on another route, on a reveal or while
  // submitting; each new decision receives a fresh foreground clock.
  useEffect(() => {
    const key = state.status === 'ready' && state.run.current
      ? `${state.run.id}:${state.run.revision}:${state.run.current.puzzle_id}` : null;
    decisionTimer.current.sync(key, Boolean(key && screenFocused && appActive && mode === 'pick' && !busy));
  }, [state, mode, screenFocused, appActive, busy]);

  // Only a visible pick screen counts as a native exposure. Do not delay
  // gameplay if the best-effort telemetry request fails.
  useEffect(() => {
    if (!screenFocused || !appActive) {
      // A later visit must renew last_seen_at for abandonment calculations.
      lastObservedDecision.current = null;
      return;
    }
    if (state.status !== 'ready' || mode !== 'pick' || !state.run.current) return;
    const key = `${state.run.id}:${state.run.revision}`;
    if (lastObservedDecision.current === key) return;
    lastObservedDecision.current = key;
    void recordDraftRunView(state.run, state.session).catch(() => {
      if (lastObservedDecision.current === key) lastObservedDecision.current = null;
    });
  }, [state, mode, screenFocused, appActive]);

  useEffect(() => {
    if (state.status !== 'ready' || !state.run.day || mode !== 'feedback' || reviewIndex === null) return;
    const runId = state.run.id;
    let current = true;
    void loadDailyPeerStats(runId, reviewIndex, state.session)
      .then((stats) => {
        if (current && stats.available) setDailyPeers({ runId, round: reviewIndex, stats });
      })
      .catch(() => undefined); // Peer comparison is optional, never block a reveal.
    return () => { current = false; };
  }, [state, mode, reviewIndex]);

  // After a completed real Daily, one authoritative status read decides the
  // next-Daily action, the reset cue, the guest handoff and whether all three
  // Dailies can be shared together. Any failed read keeps the safe defaults.
  useEffect(() => {
    if (state.status !== 'ready' || mode !== 'result' || shared || !state.run.day || !state.run.complete) return;
    const { run, session } = state;
    let current = true;
    void loadDailyStatus(session)
      .then(async (status) => {
        if (!current) return;
        setResultStatus({ runId: run.id, status });
        if (!completedAllDailies(status, run.day, run.environment)) return;
        const ids = dailySetRunIds(status.daily_history, run);
        if (!ids) return;
        const others = await Promise.all(ids.map((id) => loadDraftRun(id, session)));
        const runs = current ? dailySetShareRuns([run, ...others]) : null;
        if (!runs) return;
        setDailySet({ runId: run.id, runs });
        // Default to the whole day once, without undoing a later choice.
        if (dailySetDefaulted.current !== run.id) {
          dailySetDefaulted.current = run.id;
          setShareScope('day');
        }
      })
      .catch(() => undefined);
    return () => { current = false; };
  }, [state, mode, shared]);

  // Only consider the system StoreKit review prompt after repeat real Daily
  // completions, with the result visible and the app active for several seconds.
  // Never request a rating during a pick, reveal, shared run or screenshot capture.
  const ratingRun = state.status === 'ready' && state.run.complete
    && state.run.day === pacificDay() && !shared && !practice && mode === 'result'
    ? { id: state.run.id, day: state.run.day } : null;
  const ratingRunId = ratingRun?.id ?? null;
  const ratingDay = ratingRun?.day ?? null;
  useEffect(() => {
    if (!ratingRunId || !ratingDay || !screenFocused || !appActive || config.screenshots.fixtures) return;
    const timer = setTimeout(() => {
      void maybeRequestPackOneRating(ratingRunId, ratingDay);
    }, 4000);
    return () => clearTimeout(timer);
  }, [ratingRunId, ratingDay, screenFocused, appActive]);

  const openTrophyDeck = useCallback(() => setDeckOpen(true), []);
  const loadDeckForReview = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== 'ready' || reviewIndex === null) return Promise.reject(new Error('No revealed pick.'));
    const key = `${current.run.id}:${reviewIndex}`;
    let pending = deckCache.current.get(key);
    if (!pending) {
      pending = loadTrophyDeck(current.run.id, reviewIndex, current.session);
      deckCache.current.set(key, pending);
      // A failed read is retried on the next open, not served from the cache.
      pending.catch(() => { if (deckCache.current.get(key) === pending) deckCache.current.delete(key); });
    }
    return pending;
  }, [reviewIndex]);

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

  const refreshStillCurrent = (token: RunResponseToken, run: DraftRunState, allowNewDaily = false) => {
    const current = stateRef.current;
    return current.status === 'ready'
      && token.request === refreshGeneration.current
      && token.mutation === mutationGeneration.current
      && mobileSessionIdentity(current.session) === token.session
      && current.run.id === token.runId
      && current.run.revision === token.revision
      && ((run.id === token.runId && run.revision >= token.revision)
        || (allowNewDaily && Boolean(current.run.day) && Boolean(run.day)
          && run.day! > current.run.day! && run.environment === current.run.environment));
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

  const refreshMountedRun = async (openCompletedDaily = false) => {
    const current = stateRef.current;
    if (current.status !== 'ready' || busy || refreshInFlight.current) return;
    // A finished run is a review screen, not an invitation to start tomorrow.
    // Show a button; do not create a Daily session or change the screen until
    // the player explicitly chooses to open today's run.
    if (!shared && !practice && current.run.complete && current.run.day
      && current.run.day < pacificDay() && !openCompletedDaily) {
      mountedPacificDay.current = pacificDay();
      setNewDailyAvailable(true);
      return;
    }
    refreshInFlight.current = true;
    const token = beginRefresh(current);
    try {
      const previousRun = current.run;
      const run = shared
        ? await shared.loadRun()
        : practice
          ? await loadDraftRun(previousRun.id, current.session)
          : await startDailyDraftRun(current.session, environment);
      if (!refreshStillCurrent(token, run, !shared && !practice)) return;
      if (run.id !== previousRun.id) {
        // Only replace a Daily after the server confirms its newer date.
        // Clear any overlays, errors and old result data bound to yesterday.
        mountedPacificDay.current = pacificDay();
        setRolloverNotice(previousRun.complete ? null : 'The previous unfinished Daily expired. Here are today’s picks.');
        setNewDailyAvailable(false);
        lastObservedDecision.current = null;
        setReportOpen(false);
        setReportSending(false);
        setReportReason(null);
        setReportComment('');
        setReportError(null);
        setReportedDecision(null);
        setActionError(null);
        setShareError(null);
        setSharing(false);
        setShareScope('run');
        setZoomedCard(null);
        setReviewIndex(null);
        setDailyPeers(null);
        setResultStatus(null);
        setDailySet(null);
        setShowAnalysis(false);
        setShowPackReview(false);
        setDeckOpen(false);
        deckCache.current.clear();
      }
      commitState({ status: 'ready', run, session: current.session });
      setSelected((selection) => (
        run.id === previousRun.id && run.current?.puzzle_id === previousRun.current?.puzzle_id ? selection : null
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
      if (openCompletedDaily) setActionError('Today’s Daily could not be opened. Check your connection and try again.');
    } finally {
      refreshInFlight.current = false;
    }
  };
  // Updated after every committed render; keep timers pointed at current state.
  useEffect(() => {
    refreshRunRef.current = refreshMountedRun;
  });
  useAppResume(refreshMountedRun);

  // A foregrounded game can remain on screen across Pacific midnight without
  // triggering AppState resume. Poll the local calendar, not the game server;
  // contact the server only after the date actually changes. Retry after a
  // transient failure, and never overwrite an in-flight answer.
  useEffect(() => {
    if (practice || shared || !screenFocused || !appActive) return;
    const checkForRollover = () => {
      const today = pacificDay();
      if (today === mountedPacificDay.current) return;
      const current = stateRef.current;
      if (current.status !== 'ready' || !current.run.day) return;
      if (current.run.day < today) {
        if (current.run.complete) {
          mountedPacificDay.current = today;
          setNewDailyAvailable(true);
        } else void refreshRunRef.current();
      } else mountedPacificDay.current = today;
    };
    checkForRollover();
    const timer = setInterval(checkForRollover, 15_000);
    return () => clearInterval(timer);
  }, [practice, shared, screenFocused, appActive, state.status]);

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
    setDeckOpen(false);
    setReportOpen(false);
    setReportReason(null);
    setReportComment('');
    setReportError(null);
    setReportedDecision(null);
    setMode('feedback');
    const latestAnswer = run.answers[feedbackIndex];
    if (latestAnswer) {
      AccessibilityInfo.announceForAccessibility(
        `${latestAnswer.score} out of 100. ${trophyRevealSentence(latestAnswer)}`,
      );
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    scroll.current?.scrollTo({ y: 0, animated: true });
  };

  const confirm = async () => {
    const current = stateRef.current;
    if (current.status !== 'ready' || !selected || !current.run.current || busy) return;
    const today = pacificDay();
    if (current.run.day && mountedPacificDay.current !== today && current.run.day < today) {
      // The pick did not reach the server. If refresh fails or we're offline,
      // keep an actionable explanation rather than silently dropping the tap.
      setActionError('This Daily ended at midnight Pacific. Your pick was not submitted. Check your connection; today’s Daily will load when available.');
      void refreshRunRef.current();
      return;
    }
    const decisionKey = `${current.run.id}:${current.run.revision}:${current.run.current.puzzle_id}`;
    const activeMs = decisionTimer.current.sample(decisionKey);
    decisionTimer.current.sync(decisionKey, false);
    const token = beginMutation(current);
    setBusy(true);
    try {
      const run = shared
        ? await shared.submitPick(current.run, selected)
        : await submitDraftRunPick(current.run, selected, current.session, activeMs);
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

  const shareResult = async () => {
    if (state.status !== 'ready' || !state.run.complete || sharing) return;
    const resultRun = state.run;
    setShareError(null);
    setSharing(true);
    try {
      // After all three Dailies the whole day shares the regular Daily's link;
      // recipients open their own Daily. No card names in either message.
      const daySet = resultRun.day && shareScope === 'day' && dailySet?.runId === resultRun.id ? dailySet.runs : null;
      if (resultRun.day) {
        const url = dailyShareUrl(daySet ? { day: resultRun.day, environment: 'mixed' } : resultRun);
        const text = daySet ? dailySetShareText(daySet) : draftRunShareText({ ...resultRun, score: resultRun.score ?? 0 });
        await Share.share({ message: `${text}\n${url}` });
        return;
      }
      const share = shared ? await shared.createShare() : await createDraftRunShare(resultRun.id, state.session);
      if (!share?.creator && !/^[a-f0-9]{24}$/.test(share?.id ?? '')) {
        setShareError('Could not create this challenge link. Try sharing again.');
        return;
      }
      const url = share?.creator && share.url ? share.url : `https://packone.pro/open/shared/?id=${share?.id}`;
      const creator = resultRun.comparison?.kind === 'creator' ? resultRun.comparison : null;
      const matches = resultRun.answers.filter((item) => item.historicalMatch).length;
      const text = creator
        ? `I scored ${resultRun.score ?? 0}/100 trying to beat ${creator.name} on Pack One.\n${Number(creator.creator_matches ?? 0)}/${resultRun.run_length} creator picks matched · ${Number(creator.trophy_matches ?? matches)}/${resultRun.run_length} trophy picks matched.`
        : draftRunShareText({ ...resultRun, score: resultRun.score ?? 0 }).replace(' · Practice\n', shared ? ' · Shared run\n' : ' · Practice\n');
      await Share.share({ message: `${text}\n${url}` });
    } catch {
      setShareError('Could not open sharing. Your result is still saved.');
    } finally {
      setSharing(false);
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
    setDeckOpen(false);
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
    setDeckOpen(false);
    setSelected(null);
    setMode('feedback');
    scroll.current?.scrollTo({ y: 0, animated: true });
  };

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={themeColor('accentDark')} />
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

  if (mode === 'pick' && !cardSizeReady && !run.complete) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}>
      <ActivityIndicator color={themeColor('accentDark')} />
      <Text style={styles.loadingText}>Getting cards ready…</Text>
    </View></SafeAreaView>;
  }

  if (mode === 'result') {
    const matches = run.answers.filter((item) => item.historicalMatch).length;
    const creator = run.comparison?.kind === 'creator' ? run.comparison : null;
    const resultTitle = creator
      ? creator.outcome === 'win' ? `You beat ${creator.name}`
        : creator.outcome === 'tie' ? `You tied ${creator.name}`
          : creator.outcome === 'loss' ? `${creator.name} got you this time`
            : surfaceMeta.resultTitle
      : surfaceMeta.resultTitle;
    const realDaily = Boolean(run.day) && !shared;
    const dailyStatus = realDaily && !newDailyAvailable && resultStatus?.runId === run.id ? resultStatus.status : null;
    // Only an authoritative current-day status can turn the safe fallback into
    // a direct next Daily or show the guest handoff (today-status.mjs).
    const nextDaily = realDaily ? nextUnfinishedDaily(dailyStatus, run.day, run.environment) : null;
    const allDailiesDone = realDaily && completedAllDailies(dailyStatus, run.day, run.environment);
    const guest = !state.session.accountToken;
    const daySet = realDaily && dailySet?.runId === run.id ? dailySet.runs : null;
    const shareDay = Boolean(daySet) && shareScope === 'day';
    const dayShareLabel = newDailyAvailable ? 'Share the completed Dailies' : 'Share today’s Dailies';
    const streak = Number(dailyStatus?.daily_streak || 0);
    const back = creatorChallenge || realDaily
      ? { label: 'Back to Dailies', go: () => router.dismissTo('/') }
      : practice || shared
        ? { label: 'Return to Practice', go: () => router.dismissTo('/practice') }
        : { label: 'Back to Dailies', go: () => router.dismissTo('/') };
    const primary = nextDaily && !creatorChallenge
      ? { label: nextDaily.label, go: () => router.replace({ pathname: '/draft-run', params: { environment: nextDaily.environment } }) }
      : back;
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.resultPage}>
          <Text style={styles.eyebrow}>{surfaceMeta.eyebrow} COMPLETE</Text>
          <Text style={styles.title}>{resultTitle}</Text>
          {realDaily && newDailyAvailable ? (
            <View style={styles.dailyAvailableBanner}>
              <Text style={styles.resultBody}>Today’s Daily is ready. Your finished result is still here to review.</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Play today's Daily"
                onPress={() => void refreshRunRef.current(true)} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Play today’s Daily</Text>
              </Pressable>
              {actionError ? <Text accessibilityRole="alert" style={styles.actionError}>{actionError}</Text> : null}
            </View>
          ) : null}
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
                  : 'You and your friend played different packs, so the scores aren’t directly comparable.'}</Text>
              {creator?.creator_post_run_note ? <Text style={styles.resultBody}>{creator.name} after the run: “{creator.creator_post_run_note}”</Text> : null}
            </View>
          ) : null}
          {dailyStatus ? (
            <Text style={styles.resultCue}>{dailyResetCue()}{streak >= 2 ? ` · ${streak}-day streak` : ''}</Text>
          ) : null}
          {run.standing ? (
            <Text style={styles.resultBody}>
              #{run.standing.rank} of {run.standing.total} today
              {run.standing.percentile ? ` · Top ${run.standing.percentile}%` : ''}
              {run.standing.final ? '. Final result.' : '. The board closes at midnight Pacific.'}
            </Text>
          ) : null}
          {realDaily ? (
            <View accessibilityLabel={shareDay ? dayShareLabel : 'Share your result'} style={styles.sharePanel}>
              <Text accessibilityRole="header" style={styles.analysisSubhead}>{shareDay ? dayShareLabel : 'Share your result'}</Text>
              <Text style={styles.resultBody}>
                {shareDay
                  ? 'All three scores and colored squares in one message, not the cards.'
                  : 'Share your score and colored squares, not the cards. Friends can try their own Daily without signing up.'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share Pack One result"
                disabled={sharing}
                onPress={() => void shareResult()}
                style={[styles.primaryButton, sharing && styles.primaryButtonDisabled]}
              >
                <Text style={styles.primaryButtonText}>{shareDay ? 'Share all 3' : 'Share result'}</Text>
              </Pressable>
              {daySet ? (
                <Pressable accessibilityRole="button" onPress={() => setShareScope((value) => value === 'day' ? 'run' : 'day')} style={styles.inlineLink}>
                  <Text style={styles.inlineLinkText}>{shareDay ? 'Share just this Daily' : 'Share all 3 Dailies'}</Text>
                </Pressable>
              ) : null}
              {shareError ? <Text accessibilityRole="alert" style={styles.actionError}>{shareError}</Text> : null}
            </View>
          ) : null}
          {realDaily && guest && !run.leaderboard_eligible && allDailiesDone ? (
            <View style={styles.setComplete}>
              <Text style={styles.cardKicker}>FINISHED ALL 3 FREE DAILIES</Text>
              <Text style={styles.analysisSubhead}>Want another eight picks?</Text>
              <Text style={styles.resultBody}>Sign in or create a free account to play unlimited regular Draft Runs, save your scores, and join the leaderboard.</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/account', params: { validateDailyRunId: run.id, environment } })}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Sign in for unlimited runs</Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable accessibilityRole="button" onPress={primary.go} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{primary.label}</Text>
          </Pressable>
          {nextDaily && !creatorChallenge ? (
            <Pressable accessibilityRole="button" onPress={back.go} style={styles.inlineLink}>
              <Text style={styles.inlineLinkText}>All Dailies</Text>
            </Pressable>
          ) : null}
          {!realDaily ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share Pack One result"
                disabled={sharing}
                onPress={() => void shareResult()}
                style={[styles.secondaryButton, sharing && styles.primaryButtonDisabled]}
              >
                <Text style={styles.secondaryButtonText}>Share this run and compare</Text>
              </Pressable>
              {shareError ? <Text accessibilityRole="alert" style={styles.actionError}>{shareError}</Text> : null}
            </>
          ) : null}
          <View style={styles.resultReview}>
            <Text style={styles.analysisTitle}>Your {run.run_length} picks</Text>
            {run.answers.map((item, index) => {
              const candidates = Array.isArray(item.puzzle?.candidates) ? item.puzzle.candidates : [];
              const byId = new Map(candidates.map((card) => [card.id, card]));
              // A saved legacy answer without its selected card metadata can
              // still display the recap but cannot reopen a valid reveal.
              const canReview = Boolean(item.puzzle && byId.has(item.selectedId));
              const mine = byId.get(item.selectedId);
              const trophy = item.historicalMatch || !item.historicalId ? null : byId.get(item.historicalId) ?? null;
              return (
                <Pressable
                  key={`${item.puzzle?.puzzle_id ?? `saved-${index + 1}`}-result-review`}
                  accessibilityRole="button"
                  accessibilityLabel={`${canReview ? "Review" : "Saved"} pick ${index + 1}, ${item.selectedName}, ${item.score} points`}
                  disabled={!canReview}
                  onPress={() => { if (canReview) reviewAnswer(index); }}
                  style={styles.resultReviewRow}
                >
                  <Text style={styles.resultReviewIndex}>{index + 1}</Text>
                  {/* Names are in the row text, so thumbnails stay out of the accessibility tree. */}
                  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.resultThumbs}>
                    {[mine ? { card: mine, style: item.historicalMatch ? styles.thumbMatch : styles.thumbMine } : null,
                      trophy ? { card: trophy, style: styles.thumbTrophy } : null].map((thumb, slot) => (
                      <View key={slot} style={[styles.resultThumb, thumb?.style]}>
                        {thumb?.card.image_url ? <Image source={thumb.card.image_url} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" /> : null}
                      </View>
                    ))}
                  </View>
                  <View style={styles.resultReviewCopy}>
                    <Text style={styles.resultReviewTitle}>
                      {item.puzzle?.set_id ? resultSetName(item.puzzle.set_id) : "Saved pick"} · Pick {item.pickNumber ?? item.puzzle?.pick_number ?? index + 1}
                    </Text>
                    <Text style={styles.rankingMeta}>
                      {item.selectedName}{item.historicalMatch ? ' · Trophy match' : trophy ? ` · Trophy pick: ${trophy.name}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.resultReviewScore}>{item.score}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.modelNote}>
            Your final score is the average of your {run.run_length} picks. Matching the trophy drafter earns 100; other picks can score up to 95 based on the model.
          </Text>
          <View style={styles.guestNote}>
            <Text style={styles.guestNoteTitle}>
              {creatorChallenge ? 'Creator replay saved' : practice || shared ? 'Saved to your career' : state.session.accountToken ? 'Saved to your account' : 'Guest result'}
            </Text>
            <Text style={styles.resultBody}>
              {creatorChallenge
                ? 'Playing this won’t use up your Daily attempt, change your streak, or affect your leaderboard score.'
                : shared
                  ? 'This is your saved shared run. Reopening the invitation recovers the same picks and result, not another attempt.'
                  : practice
                  ? 'Practice builds your career. Play the Dailies to join the leaderboard.'
                  : state.session.accountToken
                    ? 'Your result is saved to your Pack One account.'
                    : 'Sign in or create a free account to add this score to today’s leaderboard and keep your scores across devices.'}
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
                <Text style={styles.secondaryButtonText}>Sign in to add this score to the leaderboard</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const puzzle = mode === 'feedback' ? answer?.puzzle : run.current;
  if (!puzzle) return null;
  const guideUrl = setGuideUrl(puzzle.set_id);
  const peersForReview = mode === 'feedback' && run.day && dailyPeers?.runId === run.id && dailyPeers.round === reviewIndex && dailyPeers.stats.available
    ? dailyPeers.stats
    : null;
  const cardShares: CardShares = peersForReview?.card_pick_pct && typeof peersForReview.card_pick_pct === 'object' ? peersForReview.card_pick_pct : null;
  const compactSentence = answer ? compactRevealFeedback(answer) : '';
  const picksLeft = run.run_length - run.answers.length;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.shell}>
        <ScrollView ref={scroll} contentContainerStyle={styles.page}>
          <View style={styles.runContext}>
            <Text style={styles.eyebrow}>
              {practice || shared ? surfaceMeta.eyebrow : `${dailyMeta.eyebrow} · ${run.day ?? 'TODAY'}`}
            </Text>
            {rolloverNotice && run.day && run.answers.length === 0 ? (
              <Text accessibilityRole="alert" style={styles.rolloverNotice}>{rolloverNotice}</Text>
            ) : null}
            <View style={styles.runContextRow}>
              <Text style={[styles.title, styles.runContextTitle]}>
                {puzzle.set_id.toUpperCase()} <Text style={styles.titleMeta}>· Pack 1 · Pick {puzzle.pick_number}</Text>
              </Text>
              {guideUrl ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`Set refresher for ${resultSetName(puzzle.set_id)}, opens packone.pro`}
                  onPress={() => { void WebBrowser.openBrowserAsync(guideUrl).catch(() => undefined); }}
                  style={styles.inlineLink}
                >
                  <Text style={styles.inlineLinkText}>Set refresher ↗</Text>
                </Pressable>
              ) : null}
              {inlineProgress ? <Progress run={run} tablet /> : null}
            </View>
            {!inlineProgress ? <Progress run={run} /> : null}
          </View>
          {mode === 'feedback' && answer ? (
            <>
              <View testID="pick-feedback" onLayout={(event) => { setFeedbackWidth(event.nativeEvent.layout.width); recordLayout('feedback', event); }} style={[styles.feedback, answer.historicalMatch && styles.feedbackMatch]}>
                <View onLayout={(event) => recordLayout('summary', event)} style={[styles.feedbackSummary, !compactFeedback && styles.feedbackSummaryStack]}>
                  <Text testID="feedback-score" onLayout={(event) => recordLayout('score', event)} onTextLayout={(event) => recordText('score', event)} style={[styles.feedbackScoreNumber, compactFeedback && styles.feedbackScoreCompact]}>{answer.score}<Text style={styles.feedbackScoreSuffix}>/100</Text></Text>
                  <View testID="feedback-copy" onLayout={(event) => recordLayout('copy', event)} style={styles.feedbackCopy}>
                    <Text testID="feedback-title" onLayout={(event) => recordLayout('title', event)} onTextLayout={(event) => recordText('title', event)} style={styles.feedbackTitle}>
                      {trophyRevealSentence(answer)}
                    </Text>
                    {compactSentence ? (
                      <Text testID="feedback-choice" onLayout={(event) => recordLayout('choice', event)} onTextLayout={(event) => recordText('choice', event)} style={styles.feedbackBody}>{compactSentence}</Text>
                    ) : null}
                  </View>
                </View>
                {peersForReview ? (
                  <Text accessibilityRole="text" style={styles.dailyPeerStats}>
                    {peersForReview.matching_pick_pct}% picked this · {peersForReview.trophy_pick_pct}% matched the trophy drafter · {peersForReview.players} players
                  </Text>
                ) : null}
              </View>

              <View style={styles.revealSection}>
                <Text accessibilityRole="header" style={styles.analysisTitle}>Why this score?</Text>
                <RevealComparison
                  answer={answer}
                  creatorName={run.comparison?.kind === 'creator' ? run.comparison.name : null}
                  shares={cardShares}
                  stack={stackComparison}
                  onZoom={setZoomedCard}
                />
                {answer.consensusName ? (
                  <>
                    <Text style={styles.analysisLead}>{SCORING_COPY}</Text>
                    <Text style={styles.modelNote}>{MODEL_NOTE}</Text>
                  </>
                ) : null}
                <TrophyDrafterDetails answer={answer} onOpenDeck={openTrophyDeck} />
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showAnalysis }}
                onPress={() => setShowAnalysis((value) => !value)}
                style={styles.disclosureButton}
              >
                <Text style={styles.disclosureText}>{showAnalysis ? 'Hide all cards' : `Compare all ${answer.ranking?.length || answer.puzzle.candidates.length} cards`}</Text>
              </Pressable>
              {showAnalysis ? <CompareAllCards answer={answer} shares={cardShares} onZoom={setZoomedCard} /> : null}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showPackReview }}
                onPress={() => setShowPackReview((value) => !value)}
                style={styles.disclosureButton}
              >
                <Text style={styles.disclosureText}>{showPackReview ? 'Hide revealed pack' : 'Review the pack'}</Text>
              </Pressable>
              {showPackReview ? <PackReview answer={answer} onZoom={setZoomedCard} /> : null}

              <View style={styles.decisionReport}>
                <Pressable accessibilityRole="button" accessibilityLabel="Does something look wrong? Let me know." onPress={openDecisionReport} style={styles.decisionReportButton}>
                  <Text style={styles.decisionReportText}>Does something look wrong? <Text style={styles.decisionReportLink}>Let me know.</Text></Text>
                </Pressable>
                {reportedDecision === answer.puzzle.puzzle_id ? (
                  <Text accessibilityRole="text" style={styles.decisionReportStatus}>{REPORT_SENT_TEXT}</Text>
                ) : null}
              </View>
            </>
          ) : (
            <>
              {puzzle.prior_picks.length ? <View style={styles.pool}>
                <Text style={styles.poolLabel}>Earlier picks · {puzzle.prior_picks.length} {puzzle.prior_picks.length === 1 ? 'card' : 'cards'}</Text>
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
              </View> : null}

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

              <View style={styles.pickToolbar}>
                <Text style={styles.sectionTitle}>Choose one</Text>
                <Pressable accessibilityRole="button" testID="cycle-card-size"
                  accessibilityLabel={`Card size: ${cardSize}. Tap for ${nextCardSize(cardSize)}.`}
                  accessibilityHint="Switch between compact, standard and large cards. All three sizes are in Settings, Appearance."
                  onPress={changeCardSize} style={styles.sizeButton}>
                  <Text style={styles.sizeButtonText}>Cards: {cardSize === 'standard' ? 'Standard' : cardSize === 'compact' ? 'Compact' : 'Large'}</Text>
                </Pressable>
              </View>
              {run.answers.length === 0 ? <Text style={styles.pickHint}>Tap to pick. Hold to enlarge.</Text> : null}
              <View style={styles.grid} onLayout={screenshotFocusCards ? (event) => {
                // Scroll the real app's choice grid into view only in isolated screenshot builds.
                if (screenshotCardPositioned.current) return;
                screenshotCardPositioned.current = true;
                const y = event.nativeEvent.layout.y;
                requestAnimationFrame(() => scroll.current?.scrollTo({ y: Math.max(0, y - 54), animated: false }));
                console.info('PACKONE_SCREENSHOT_FOCUS', JSON.stringify({ scene: 'real-draft-cards', y }));
              } : undefined}>
                {puzzle.candidates.map((card) => (
                  <CardTile
                    key={card.id}
                    card={card}
                    tablet={tabletPickGrid}
                    sizeStyle={{ width: cardWidth }}
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
                <Text style={styles.reportTitle}>Does something look wrong?</Text>
                <Text style={styles.feedbackBody}>Tell me what you noticed.</Text>
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

        <CardFaceViewer card={zoomedCard} onClose={() => setZoomedCard(null)} />
        {mode === 'feedback' && answer ? (
          <TrophyDeckSheet
            visible={deckOpen}
            load={loadDeckForReview}
            context={{
              record: trophyDrafterFacts(answer)?.record,
              trophyName: answer.historicalName,
              priorNames: answer.puzzle.prior_picks.map((card) => card.name),
            }}
            onClose={() => setDeckOpen(false)}
          />
        ) : null}

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
            <View style={styles.nextDock}>
              <Text style={styles.nextNote}>{run.complete ? 'Run complete' : `${picksLeft} of ${run.run_length} picks left`}</Text>
              <Pressable accessibilityRole="button" onPress={next} style={[styles.primaryButton, styles.nextButton]}>
                <Text style={styles.primaryButtonText}>{run.complete ? 'See result' : 'Next pick'}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = themedStyles(StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  shell: { flex: 1 },
  runContext: { gap: spacing.xs },
  runContextRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  runContextTitle: { flexGrow: 1, flexShrink: 1, minWidth: 150 },
  page: { padding: spacing.md, paddingBottom: spacing.xxl, gap: 10, alignSelf: 'center', width: '100%', maxWidth: 980 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  loadingText: { color: colors.muted, fontSize: 15 },
  rolloverNotice: { color: colors.ink, fontSize: 14, lineHeight: 20, padding: spacing.md, backgroundColor: colors.surfaceSoft, borderLeftWidth: 3, borderLeftColor: colors.accent },
  dailyAvailableBanner: { gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSoft, borderRadius: 8 },
  errorTitle: { color: colors.ink, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  errorBody: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  title: { color: colors.ink, fontSize: 28, lineHeight: 32, fontWeight: '800' },
  titleMeta: { color: colors.muted, fontSize: 15, fontWeight: '700' },
  progress: { flexDirection: 'row', gap: 4, marginVertical: 0 },
  progressTablet: { flexBasis: 380, flexGrow: 0, flexShrink: 1, minWidth: 340 },
  progressStep: { flex: 1, minWidth: 0, minHeight: 36, alignItems: 'center', justifyContent: 'center', paddingBottom: 1, borderBottomWidth: 3, borderBottomColor: colors.line },
  progressCurrent: { borderBottomColor: colors.lineStrong },
  progressIndex: { color: colors.muted, fontSize: 11, fontWeight: '700', lineHeight: 14 },
  progressIndexCurrent: { color: colors.ink, fontWeight: '900' },
  progressScore: { color: colors.ink, fontSize: 11, fontWeight: '800', lineHeight: 15 },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  pickToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: spacing.sm },
  sizeButton: { minHeight: 44, minWidth: 124, paddingHorizontal: 10, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  sizeButtonText: { color: colors.accentDark, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  pickHint: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  sectionBody: { color: colors.muted, fontSize: 14, marginTop: -8 },
  pool: { gap: spacing.xs, paddingVertical: 0 },
  poolLabel: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: '800' },
  poolRow: { gap: spacing.sm, paddingRight: spacing.lg },
  poolCard: { width: 92, gap: 5 },
  poolImage: { width: 92, aspectRatio: 0.716, backgroundColor: colors.surfaceSoft },
  poolName: { color: colors.muted, fontSize: 11, lineHeight: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.sm },
  card: {
    width: '48.5%',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
    padding: 3,
  },
  tabletPickCard: { width: '32%' },
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
    padding: spacing.sm,
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
    marginTop: 0,
    padding: 12,
    borderWidth: 1,
    borderTopWidth: 3,
    borderColor: colors.line,
    borderTopColor: colors.accent,
    backgroundColor: colors.surface,
    flexDirection: 'column',
    gap: spacing.sm,
  },
  feedbackSummary: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  feedbackSummaryStack: { flexDirection: 'column', gap: spacing.xs },
  feedbackScoreCompact: { fontSize: 36, lineHeight: 40 },
  feedbackWide: { flexDirection: 'row', alignItems: 'center' },
  feedbackCopyWide: { flex: 1 },
  feedbackScore: { flexDirection: 'row', alignItems: 'baseline' },
  feedbackScoreNumber: { flexShrink: 1, color: colors.ink, fontSize: 40, lineHeight: 44, fontWeight: '800' },
  feedbackScoreSuffix: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  feedbackCopy: { flex: 1, minWidth: 0, gap: spacing.xs, justifyContent: 'center' },
  feedbackTitle: { color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: '800' },
  feedbackBody: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  dailyPeerStats: { color: colors.accent, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  feedbackComparison: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
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
    padding: 6,
    gap: spacing.xs,
  },
  // Row cards share available width. The base 100%-width style must apply only
  // to stacked/narrow or large-font layouts, not the wide iPad row.
  feedbackCardRowItem: { flexBasis: 0, width: 0 },
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
  // Reveal role colors match draft-run.css: blue yours, gold trophy, green match.
  feedbackMatch: { borderTopColor: colors.revealMatchBorder },
  choiceMine: { borderColor: colors.revealMineBorder },
  choiceTrophy: { borderColor: colors.revealTrophyBorder },
  choiceMatch: { borderColor: colors.revealMatchBorder, borderWidth: 2 },
  choiceLabelMine: { color: colors.revealMineText },
  choiceLabelTrophy: { color: colors.revealTrophyText },
  choiceLabelMatch: { color: colors.revealMatchText },
  choiceStats: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.xs, gap: 2 },
  choiceStatLabel: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  choiceScore: { color: colors.ink, fontSize: 26, lineHeight: 30, fontWeight: '800' },
  choiceStatRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 4 },
  choiceStatValue: { color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  revealSection: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 12, gap: spacing.sm },
  inlineLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  inlineLinkText: { color: colors.accentDark, fontSize: 14, lineHeight: 20, fontWeight: '800', textDecorationLine: 'underline' },
  trophyRecord: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.sm, gap: spacing.xs },
  trophyRecordLead: { color: colors.ink, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  sharePanel: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 12, gap: spacing.sm },
  setComplete: { borderWidth: 1, borderColor: colors.line, borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm },
  cardKicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  resultCue: { color: colors.accentDark, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  resultThumbs: { flexDirection: 'row', gap: 4 },
  resultThumb: { width: 30, aspectRatio: 0.716, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  thumbMine: { borderColor: colors.revealMineBorder, backgroundColor: colors.surfaceSoft },
  thumbTrophy: { borderColor: colors.revealTrophyBorder, backgroundColor: colors.surfaceSoft },
  thumbMatch: { borderColor: colors.revealMatchBorder, backgroundColor: colors.surfaceSoft },
  nextDock: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  nextNote: { color: colors.muted, fontSize: 13, lineHeight: 18, fontWeight: '700', flexShrink: 1 },
  nextButton: { flexGrow: 1 },
  decisionReportLink: { textDecorationLine: 'underline', color: colors.accentDark },
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
  analysisPanel: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm },
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
  decisionReportText: { color: colors.muted, fontSize: 14, lineHeight: 20, fontWeight: '700' },
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
    gap: 12,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  resultReviewIndex: { width: 28, color: colors.accentDark, fontSize: 16, fontWeight: '800' },
  resultReviewCopy: { flex: 1, minWidth: 0, gap: 2 },
  resultReviewTitle: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  resultReviewScore: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  resultPage: { padding: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xxl, gap: 12, alignSelf: 'center', width: '100%', maxWidth: 980 },
  scoreBlock: { borderTopWidth: 3, borderColor: colors.accent, backgroundColor: colors.surface, padding: spacing.sm },
  score: { color: colors.ink, fontSize: 56, lineHeight: 60, fontWeight: '800', letterSpacing: -2 },
  scoreMeta: { color: colors.muted, fontSize: 15, fontWeight: '700' },
  resultBody: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  guestNote: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.md, gap: spacing.xs },
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
}));


export default withAppTheme<{ shared?: SharedRunSurface; screenshotFeedback?: boolean }>(DraftRunScreen);
