import type { DisplayFace } from '../../../card-faces.mjs';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { requestJson } from '@/src/api/client';
import type { MobileSession } from '@/src/storage/session';

export type DailyEnvironment = 'mixed' | 'powered-cube' | 'latest';
export type PracticeEnvironment = 'mixed' | 'powered-cube';

export const DAILY_ENVIRONMENTS: readonly DailyEnvironment[] = ['mixed', 'powered-cube', 'latest'];

export const DAILY_ENVIRONMENT_META: Record<DailyEnvironment, {
  title: string;
  eyebrow: string;
  description: string;
  resultTitle: string;
}> = {
  mixed: {
    title: 'Draft Run',
    eyebrow: 'DAILY DRAFT RUN',
    description: 'Eight picks from real trophy drafts.',
    resultTitle: 'How you did',
  },
  'powered-cube': {
    title: 'Powered Cube',
    eyebrow: 'POWERED CUBE DAILY',
    description: 'Eight picks from Powered Cube trophy drafts.',
    resultTitle: 'How you did',
  },
  latest: {
    title: 'Latest Set',
    eyebrow: 'LATEST SET DAILY',
    description: 'Eight picks from trophy drafts in the latest set.',
    resultTitle: 'How you did',
  },
};

export function isDailyEnvironment(value: unknown): value is DailyEnvironment {
  return typeof value === 'string' && DAILY_ENVIRONMENTS.includes(value as DailyEnvironment);
}

export type DraftRunCard = {
  id: string;
  name: string;
  image_url?: string;
  display_faces?: DisplayFace[];
  mana_cost?: string;
  rarity?: string;
  type_line?: string;
};

export type DraftRunPuzzle = {
  puzzle_id: string;
  set_id: string;
  pack_number: number;
  pick_number: number;
  prior_picks: DraftRunCard[];
  candidates: DraftRunCard[];
};

export type DraftRunRanking = {
  id: string;
  name: string;
  support: number;
  score: number;
};

export type DraftRunAnswer = {
  score: number;
  selectedId: string;
  selectedName: string;
  selectedSupport?: number;
  historicalId: string | null;
  historicalName: string | null;
  historicalMatch: boolean;
  /** Display string saved on older answers; the server now sends trophyDrafter instead. */
  trophyRecord?: string | null;
  trophyDrafter?: { record?: string | null; winRate?: number | null; rank?: string | null } | null;
  creatorId?: string;
  creatorName?: string;
  creatorMatch?: boolean;
  consensusId?: string;
  consensusName?: string;
  consensusSupport?: number;
  consensusRank?: number;
  consensusCap?: number;
  supportRatio?: number;
  pickNumber?: number;
  modelTargetDisagreement?: boolean;
  ranking?: DraftRunRanking[];
  /** True only when the server can return this revealed pick's trophy decklist. */
  deckAvailable?: boolean;
  puzzle: DraftRunPuzzle;
};

export type DraftRunState = {
  id: string;
  environment: string;
  run_length: number;
  set_reroll_allowed: boolean;
  custom_set_ids?: string[];
  rerolls: {
    set: number;
    pack: number;
  };
  day: string | null;
  revision: number;
  round: number;
  complete: boolean;
  score: number | null;
  leaderboard_eligible: boolean;
  ranked_name?: string | null;
  answers: DraftRunAnswer[];
  current: DraftRunPuzzle | null;
  standing?: {
    rank: number;
    total: number;
    percentile?: number | null;
    final?: boolean;
  } | null;
  comparison?: {
    kind?: 'friend' | 'creator';
    id?: string;
    slug?: string;
    public_url?: string;
    name: string;
    handle?: string | null;
    headline?: string;
    score: number;
    exact: boolean;
    source_type?: 'practice' | 'daily';
    source_day?: string | null;
    creator_matches?: number | null;
    trophy_matches?: number | null;
    outcome?: 'win' | 'loss' | 'tie' | null;
    creator_post_run_note?: string;
    self?: boolean;
  } | null;
  creator_challenge_id?: string | null;
  creator_source_owner?: { challenge_id: string; source_type: 'practice' | 'daily'; source_day?: string | null } | null;
};

export type DecisionReportReason =
  | 'draft_context'
  | 'card_or_image'
  | 'score_recommendation'
  | 'uninteresting'
  | 'broken'
  | 'other';

export type SharedDraftRunInfo = {
  id: string;
  name: string;
  score: number;
  scores: { name: string; score: number }[];
  environment: string;
  run_length: number;
};

export type CreatorChallengeInfo = {
  id: string;
  slug: string;
  creator_name: string;
  creator_handle?: string | null;
  headline: string;
  score: number;
  environment: string;
  source_type: 'practice' | 'daily';
  source_day?: string | null;
  run_length: number;
  public_url: string;
  tracked_url: string;
};

export type PracticeSet = {
  set_id: string;
  set_name: string;
  release_date?: string | null;
  regular_run?: boolean;
};

export type DailyStatus = {
  day: string;
  capabilities: string[];
  player: { claimed: boolean };
  membership?: { connected?: boolean; capabilities?: string[] } | null;
  ranking_identity?: { eligible: boolean; reason?: string | null } | null;
  daily_streak: number;
  daily_history: ({
    date: string;
    set_id: string;
    mode: string;
    score: number;
    rank?: number | null;
    total?: number | null;
    percentile?: number | null;
    final?: boolean;
    run_id?: string;
  })[];
};

export type DraftRunHealth = {
  ok: boolean;
  service?: string;
  release?: string;
  run_length?: number;
  scoring_version?: string;
  corpus_version?: string;
};

export function loadDraftRunHealth() {
  return requestJson<DraftRunHealth>('/draft/health?quick=1', { timeoutMs: 10_000 });
}

export function loadDailyStatus(session: MobileSession) {
  return requestJson<DailyStatus>('/draft/v1/daily-status', {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 15_000,
  });
}

export function startDailyDraftRun(
  session: MobileSession,
  environment: DailyEnvironment = 'mixed',
) {
  return requestJson<DraftRunState>('/draft/v1/runs', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: { daily: true, environment },
    timeoutMs: 30_000,
  });
}

export function loadPracticeCapabilities(session: MobileSession) {
  if (!session.accountToken) throw new Error('Sign in to load practice access.');
  return requestJson<{ capabilities: string[] }>('/draft/v1/capabilities', {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 15_000,
  });
}

export function loadSetCatalog(session: MobileSession) {
  return requestJson<{ sets: PracticeSet[] }>('/draft/v1/set-catalog', {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 20_000,
  });
}

export function loadPracticeSets(session: MobileSession) {
  if (!session.accountToken) throw new Error('Sign in to load custom practice sets.');
  return requestJson<{ sets: PracticeSet[] }>('/draft/v1/practice-sets', {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 30_000,
  });
}

export function loadSharedDraftRunInfo(id: string, session: MobileSession) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw new Error('Invalid shared Draft Run.');
  return requestJson<SharedDraftRunInfo>(`/draft/v1/shared-runs/${encodeURIComponent(id)}`, {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 15_000,
  });
}

export function startSharedDraftRun(session: MobileSession, id: string) {
  if (!session.accountToken) throw new Error('Sign in to play a shared Pack One run.');
  if (!/^[a-f0-9]{24}$/.test(id)) throw new Error('Invalid shared Draft Run.');
  return requestJson<DraftRunState>('/draft/v1/runs', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: { challenge: id },
    timeoutMs: 30_000,
  });
}

export function loadCreatorChallengeInfo(id: string, session: MobileSession) {
  if (!/^(?:[a-f0-9-]{36}|[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)$/.test(id)) {
    throw new Error('Invalid creator challenge.');
  }
  return requestJson<CreatorChallengeInfo>(`/draft/v1/creator-challenges/${encodeURIComponent(id)}`, {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 15_000,
  });
}

export function startCreatorChallenge(session: MobileSession, id: string) {
  if (!/^(?:[a-f0-9-]{36}|[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)$/.test(id)) throw new Error('Invalid creator challenge.');
  return requestJson<DraftRunState>('/draft/v1/runs', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: { creatorChallenge: id },
    timeoutMs: 30_000,
  });
}

export function startPracticeDraftRun(
  session: MobileSession,
  {
    environment = 'mixed',
    setIds = [],
    idempotencyKey,
  }: {
    environment?: PracticeEnvironment;
    setIds?: string[];
    idempotencyKey: string;
  },
) {
  if (!session.accountToken) throw new Error('Sign in to start practice.');
  return requestJson<DraftRunState>('/draft/v1/runs', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    idempotencyKey,
    body: {
      daily: false,
      environment,
      ...(setIds.length ? { setIds } : {}),
    },
    timeoutMs: 30_000,
  });
}

export function rerollDraftRun(
  run: DraftRunState,
  type: 'set' | 'pack',
  session: MobileSession,
) {
  if (!run.current) throw new Error('This run is already complete.');
  return requestJson<DraftRunState>(`/draft/v1/runs/${encodeURIComponent(run.id)}/reroll`, {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: {
      type,
      revision: run.revision,
      round: run.answers.length,
      puzzleId: run.current.puzzle_id,
    },
    timeoutMs: 30_000,
  });
}

export async function submitDraftRunDecisionReport(
  run: DraftRunState,
  round: number,
  reason: DecisionReportReason,
  comment: string,
  session: MobileSession,
) {
  const answer = run.answers[round];
  if (!answer) throw new Error('Choose a revealed decision to report.');
  return requestJson<{ ok: true; id: string }>(`/draft/v1/runs/${encodeURIComponent(run.id)}/report`, {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: {
      round,
      puzzleId: answer.puzzle.puzzle_id,
      reason,
      comment: comment.trim() || null,
      client: {
        platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'unknown',
        version: Application.nativeApplicationVersion ?? null,
        build: Application.nativeBuildVersion ?? null,
      },
    },
    timeoutMs: 15_000,
  });
}

export function createDraftRunShare(id: string, session: MobileSession) {
  return requestJson<{ id: string; creator?: boolean; slug?: string; url?: string }>(`/draft/v1/runs/${encodeURIComponent(id)}/share`, {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: {},
    timeoutMs: 15_000,
  });
}

export type DailyPeerStats = {
  available: boolean;
  players?: number;
  matching_pick_pct?: number;
  trophy_pick_pct?: number;
  /** Share of today's locked picks per card id, sent only with an available summary. */
  card_pick_pct?: Record<string, number>;
};

export function loadDailyPeerStats(id: string, round: number, session: MobileSession) {
  return requestJson<DailyPeerStats>(`/draft/v1/runs/${encodeURIComponent(id)}/stats?round=${round}`, {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 15_000,
  });
}

export type TrophyDeckCard = {
  id: string;
  name: string;
  count: number;
  mana_cost?: string;
  mana_value?: number;
  type_line?: string;
  image_url?: string;
  display_faces?: DisplayFace[];
};

export type TrophyDeck = {
  deck: TrophyDeckCard[];
  sideboard: TrophyDeckCard[];
  size: number;
  event_type: string;
  colors?: string;
  splash_colors?: string;
  last_game_time?: string;
  source: { name: string; url: string; license: string; note: string; draft_url?: string };
};

// Same owner-bound, reveal-gated read the web decklist dialog makes. The
// server refuses unrevealed rounds, so this is only called after a pick locks.
export function loadTrophyDeck(id: string, round: number, session: MobileSession) {
  return requestJson<TrophyDeck>(`/draft/v1/runs/${encodeURIComponent(id)}/deck?round=${round}`, {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 15_000,
  });
}

export function loadDraftRun(id: string, session: MobileSession) {
  return requestJson<DraftRunState>(`/draft/v1/runs/${encodeURIComponent(id)}`, {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 30_000,
  });
}

// Native observations are best-effort telemetry, never a gameplay prerequisite.
function newDraftRunViewId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = bytes.map(value => value.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

// Keep the same observation identity on a resumed view of the same pick.
// The server updates last_seen_at and only trusts timing when the ID agrees.
const decisionViewIds = new Map<string, string>();
function decisionViewId(run: DraftRunState): string | null {
  if (!run.current) return null;
  const key = `${run.id}:${run.revision}:${run.current.puzzle_id}`;
  let viewId = decisionViewIds.get(key);
  if (!viewId) {
    viewId = newDraftRunViewId();
    decisionViewIds.set(key, viewId);
    if (decisionViewIds.size > 64) {
      const oldest = decisionViewIds.keys().next().value;
      if (oldest) decisionViewIds.delete(oldest);
    }
  }
  return viewId;
}

export function recordDraftRunView(run: DraftRunState, session: MobileSession) {
  const viewId = decisionViewId(run);
  if (!viewId || !run.current) return Promise.resolve({ ok: false });
  return requestJson<{ ok: boolean }>(`/draft/v1/runs/${encodeURIComponent(run.id)}/view`, {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: { revision: run.revision, puzzleId: run.current.puzzle_id, viewId },
    timeoutMs: 15_000,
  });
}

export function submitDraftRunPick(
  run: DraftRunState,
  cardId: string,
  session: MobileSession,
  activeMs: number | null = null,
) {
  if (!run.current) throw new Error('This run is already complete.');
  const validTiming = Number.isInteger(activeMs) && activeMs !== null && activeMs >= 0 && activeMs <= 1_800_000;
  return requestJson<DraftRunState>(`/draft/v1/runs/${encodeURIComponent(run.id)}/pick`, {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: {
      cardId,
      revision: run.revision,
      round: run.answers.length,
      puzzleId: run.current.puzzle_id,
      ...(validTiming ? { viewId: decisionViewId(run), activeMs } : {}),
    },
    timeoutMs: 30_000,
  });
}
