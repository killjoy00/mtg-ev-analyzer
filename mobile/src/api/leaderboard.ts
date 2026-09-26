import { requestJson } from '@/src/api/client';
import type { DailyEnvironment } from '@/src/api/draftRun';

export type LeaderboardPeriod = 'daily' | 'week' | 'season' | 'all';

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
  season?: {
    id: string;
    name: string;
    set_id: string;
    start_date: string;
    end_date?: string | null;
  } | null;
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
