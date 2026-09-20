import { requestJson } from '@/src/api/client';
import type { MobileSession } from '@/src/storage/session';

export type CareerSummary = {
  games: number;
  average_score: number;
  best_score: number;
  challenge_wins: number;
  challenge_losses: number;
  challenge_ties: number;
  daily_games: number;
  environments_played: number;
  current_streak: number;
  best_streak: number;
};

export type CareerProfile = {
  player: {
    display_name: string;
    profile_key?: string | null;
    profile_public: boolean;
    favorite_set_id?: string | null;
    showcase_achievement?: string | null;
    claimed?: boolean;
  };
  summary: CareerSummary;
  best_final_percentile?: number | null;
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
  next_cursor?: string | null;
};

export function loadCareerProfile(session: MobileSession) {
  return requestJson<CareerProfile>('/growth/v1/profile/me', {
    mobileSessionToken: session.playerToken,
  });
}

export function loadCareerHistory(session: MobileSession, cursor?: string | null) {
  const query = new URLSearchParams({ limit: '25' });
  if (cursor) query.set('cursor', cursor);
  return requestJson<CareerHistoryPage>(`/growth/v1/profile/history?${query.toString()}`, {
    mobileSessionToken: session.playerToken,
  });
}
