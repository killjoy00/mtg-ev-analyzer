import { requestJson } from '@/src/api/client';
import type { MobileSession } from '@/src/storage/session';

export type CareerSummary = {
  games: number;
  average_score: number;
  best_score: number;
  daily_games: number;
  environments_played: number;
  current_streak: number;
  best_streak: number;
};

export type CareerEnvironment = {
  set_id: string;
  games: number;
  average_score: number;
  best_score: number;
};

export type CareerProfile = {
  player: {
    display_name: string;
    profile_key?: string | null;
    claimed?: boolean;
  };
  summary: CareerSummary;
  best_environments: CareerEnvironment[];
};

export type CareerHistoryRow = {
  cursor: string;
  played_at: string;
  set_id: string;
  mode: string;
  score: number;
  grade?: string | null;
  is_daily: boolean;
  outcome?: string | null;
};

export type CareerHistoryPage = {
  rows: CareerHistoryRow[];
  next_cursor: string | null;
};

function accountOptions(session: MobileSession) {
  if (!session.accountToken) throw new Error('Sign in to view your Pack One career.');
  return {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 20_000,
  };
}

export function loadMobileCareer(session: MobileSession) {
  return requestJson<CareerProfile>('/growth/v1/mobile/profile/me', accountOptions(session));
}

export function loadMobileCareerHistory(
  session: MobileSession,
  cursor?: string | null,
  limit = 25,
) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  return requestJson<CareerHistoryPage>(
    `/growth/v1/mobile/profile/history?${query.toString()}`,
    accountOptions(session),
  );
}
