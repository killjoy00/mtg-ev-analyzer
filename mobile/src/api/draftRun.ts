import { requestJson } from '@/src/api/client';
import type { MobileSession } from '@/src/storage/session';

export type DailyEnvironment = 'mixed' | 'powered-cube' | 'latest';

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

export type DraftRunAnswer = {
  score: number;
  selectedId: string;
  selectedName: string;
  historicalId: string | null;
  historicalName: string | null;
  historicalMatch: boolean;
  consensusName?: string;
  puzzle: DraftRunPuzzle;
};

export type DraftRunState = {
  id: string;
  environment: string;
  run_length: number;
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

export function startDailyDraftRun(
  mobileSessionToken: string,
  environment: DailyEnvironment = 'mixed',
) {
  return requestJson<DraftRunState>('/draft/v1/runs', {
    method: 'POST',
    mobileSessionToken,
    body: { daily: true, environment },
    timeoutMs: 30_000,
  });
}

export function startRegularPracticeDraftRun(
  session: MobileSession,
  idempotencyKey: string,
) {
  if (!session.accountToken) throw new Error('Sign in to start regular practice.');
  return requestJson<DraftRunState>('/draft/v1/runs', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    idempotencyKey,
    body: { daily: false, environment: 'mixed' },
    timeoutMs: 30_000,
  });
}

export function loadDraftRun(id: string, mobileSessionToken: string) {
  return requestJson<DraftRunState>(`/draft/v1/runs/${encodeURIComponent(id)}`, {
    mobileSessionToken,
    timeoutMs: 30_000,
  });
}

export function submitDraftRunPick(
  run: DraftRunState,
  cardId: string,
  mobileSessionToken: string,
) {
  if (!run.current) throw new Error('This run is already complete.');
  return requestJson<DraftRunState>(`/draft/v1/runs/${encodeURIComponent(run.id)}/pick`, {
    method: 'POST',
    mobileSessionToken,
    body: {
      cardId,
      revision: run.revision,
      round: run.answers.length,
      puzzleId: run.current.puzzle_id,
    },
    timeoutMs: 30_000,
  });
}

export type DraftRunClaim = {
  claimToken: string;
  expiresAt: string;
};

export function issueDraftRunClaim(runId: string, mobileSessionToken: string) {
  return requestJson<DraftRunClaim>(`/draft/v1/runs/${encodeURIComponent(runId)}/claim`, {
    method: 'POST',
    mobileSessionToken,
    body: {},
    timeoutMs: 15_000,
  });
}
