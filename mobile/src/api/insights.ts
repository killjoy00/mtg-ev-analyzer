import { requestJson } from '@/src/api/client';
import type { MobileSession } from '@/src/storage/session';

export type InsightsEnvironment = 'mixed' | 'latest' | 'powered-cube';
export type InsightsPeriod = 'all' | '90d' | '365d';
export type InsightGroup = {
  count: number;
  average_score: number | null;
  trophy_match_pct: number | null;
};
export type InsightPick = InsightGroup & { pick_number: number; label: string };
export type InsightDifficulty = InsightGroup & { band: string };
export type InsightMonth = InsightGroup & { month: string };
export type InsightFormat = InsightGroup & { environment: InsightsEnvironment; label: string };
export type InsightWindow = InsightGroup & { from: string; to: string };
export type InsightProgress = { recent: InsightWindow; previous: InsightWindow; delta: number };
export type DraftInsights = {
  environment: InsightsEnvironment;
  period: InsightsPeriod;
  environment_label: string;
  eligible_decisions: number;
  total_eligible_decisions: number;
  unlocked: boolean;
  unlock_at: number;
  unknown_difficulty: number;
  pick_depth: InsightPick[];
  difficulty: InsightDifficulty[];
  months: InsightMonth[];
  formats: InsightFormat[];
  progress: InsightProgress | null;
  observations: { id: string; text: string }[];
  versions: { scoring: string[]; selection: string[]; corpus: string[] };
  range: { from: string; to: string } | null;
  session_limit: number;
  methodology: string;
};

export async function loadMobileInsights(session: MobileSession, environment: InsightsEnvironment, period: InsightsPeriod): Promise<DraftInsights> {
  if (!session.accountToken) throw Error('Sign in to view your private drafting Insights.');
  const params = new URLSearchParams({ environment, period });
  return requestJson<DraftInsights>('/growth/v1/mobile/profile/insights?' + params.toString(), {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 20_000,
  });
}
