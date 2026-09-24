import { requestJson } from '@/src/api/client';
import type { DailyEnvironment } from '@/src/api/draftRun';

export type LeaderboardPeriod = 'daily' | 'week' | 'month' | 'all';

export type LeaderboardRow = {
  rank: number;
  score: number;
  days: number;
  display_name: string;
  profile_key?: string | null;
};

export type DraftRunLeaderboard = {
  period: LeaderboardPeriod;
  environment: DailyEnvironment;
  start: string;
  today: string;
  rows: LeaderboardRow[];
};

export function loadDraftRunLeaderboard(
  period: LeaderboardPeriod,
  environment: DailyEnvironment,
) {
  const query = new URLSearchParams({ period, environment });
  return requestJson<DraftRunLeaderboard>(`/draft/v1/leaderboard?${query.toString()}`, {
    timeoutMs: 15_000,
  });
}
