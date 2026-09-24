import { requestJson } from '@/src/api/client';
import type { MobileSession } from '@/src/storage/session';

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

export function startDailyDraftRun(session: MobileSession, environment = 'mixed') {
  return requestJson<DraftRunState>('/draft/v1/runs', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: { daily: true, environment },
    timeoutMs: 30_000,
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
