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
    description: 'Eight decisions drawn across Pack One’s current draft environments.',
    resultTitle: 'Your Draft Run.',
  },
  'powered-cube': {
    title: 'Powered Cube',
    eyebrow: 'POWERED CUBE DAILY',
    description: 'Eight decisions from the live Powered Cube environment.',
    resultTitle: 'Your Powered Cube.',
  },
  latest: {
    title: 'Latest Set',
    eyebrow: 'LATEST SET DAILY',
    description: 'Eight decisions from Pack One’s newest live regular set.',
    resultTitle: 'Your Latest Set run.',
  },
};

export function isDailyEnvironment(value: unknown): value is DailyEnvironment {
  return typeof value === 'string' && DAILY_ENVIRONMENTS.includes(value as DailyEnvironment);
}

export type DraftRunCard = {
  id: string;
  name: string;
  image_url?: string;
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
  consensusId?: string;
  consensusName?: string;
  consensusSupport?: number;
  consensusRank?: number;
  consensusCap?: number;
  supportRatio?: number;
  pickNumber?: number;
  modelTargetDisagreement?: boolean;
  ranking?: DraftRunRanking[];
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
    name: string;
    score: number;
    exact: boolean;
  } | null;
};

export type SharedDraftRunInfo = {
  id: string;
  name: string;
  score: number;
  scores: { name: string; score: number }[];
  environment: string;
  run_length: number;
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
  return requestJson<SharedDraftRunInfo>(`/draft/v1/shared-runs/${encodeURIComponent(id)}`, {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 15_000,
  });
}

export function startSharedDraftRun(session: MobileSession, id: string) {
  if (!session.accountToken) throw new Error('Sign in to play a shared Pack One run.');
  return requestJson<DraftRunState>('/draft/v1/runs', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: { challenge: id },
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

export function createDraftRunShare(id: string, session: MobileSession) {
  return requestJson<{ id: string }>(`/draft/v1/runs/${encodeURIComponent(id)}/share`, {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: {},
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

export function submitDraftRunPick(
  run: DraftRunState,
  cardId: string,
  session: MobileSession,
) {
  if (!run.current) throw new Error('This run is already complete.');
  return requestJson<DraftRunState>(`/draft/v1/runs/${encodeURIComponent(run.id)}/pick`, {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: {
      cardId,
      revision: run.revision,
      round: run.answers.length,
      puzzleId: run.current.puzzle_id,
    },
    timeoutMs: 30_000,
  });
}
