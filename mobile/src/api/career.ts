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

export type ProfileEnvironment = {
  set_id: string;
  games: number;
  average_score: number;
  best_score: number;
  daily_games?: number;
  last_played_at?: string | null;
};

export type ProfileAchievement = {
  id: string;
  label: string;
  description?: string;
  unlocked: boolean;
  current?: number;
  target?: number;
  progress_text?: string;
  earned_at?: string | null;
};

export type DailyHistoryRow = {
  date: string;
  set_id: string;
  mode: string;
  score: number;
  grade?: string | null;
  rank: number;
  total: number;
  percentile?: number | null;
  final?: boolean;
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

export type CareerProfile = {
  player: {
    display_name: string;
    profile_key?: string | null;
    profile_public?: boolean;
    favorite_set_id?: string | null;
    showcase_achievement?: string | null;
    claimed?: boolean;
    username_owned?: boolean;
  };
  summary: CareerSummary;
  environment_total: number;
  by_set: ProfileEnvironment[];
  by_mode: ({ mode: string; games: number; average_score: number; best_score: number })[];
  best_environments: ProfileEnvironment[];
  cube?: ProfileEnvironment | null;
  best_final_percentile?: number | null;
  current_season?: {
    id: string;
    set_id: string;
    name: string;
    start_date?: string | null;
    end_date?: string | null;
    standings: ({
      environment: string;
      rank: number;
      average: number;
      days: number;
    })[];
  } | null;
  daily_history: DailyHistoryRow[];
  recent: CareerHistoryRow[];
  trend: ({ played_at: string; score: number; set_id: string; mode: string })[];
  achievements: ProfileAchievement[];
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

export function loadMobilePublicProfile(profileKey: string, session: MobileSession) {
  return requestJson<CareerProfile>(
    `/growth/v1/mobile/profile/${encodeURIComponent(profileKey)}`,
    {
      mobileSessionToken: session.playerToken,
      mobileAccountToken: session.accountToken,
      timeoutMs: 20_000,
    },
  );
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
