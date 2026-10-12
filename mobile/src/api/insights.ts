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
export type DnaTrait = { status: 'qualified'; id: string; title: string; summary: string;
  evidence_family: string; supporting_decisions: number; evidence: {label:string;value:string|number}[] }
  | {status:'emerging';label:string;picks_needed?:number|null;reason?:string};
export type DraftingDNA = {
  schema_version:string;status:'ready'|'emerging';scope:string;eligible_decisions:number;
  primary:DnaTrait|null;primary_emerging?:DnaTrait;secondary:DnaTrait[];note:string;picks_needed?:number|null;reason?:string;
};
export type JourneyWindow = {id:string;from:string;to:string;from_at?:string;to_at?:string;count:number;
  average_score:number|null;complete:boolean;cohort:string};
export type CardChoiceExample = { session_id:string;round:number;puzzle_id:string;set_id:string;pick_number:number;date:string;selected_name:string };
export type CardChoiceBreakdown = {id:string;title:string;status:'ready'|'developing';opportunities:number;
  selected:Record<string,number>;availability:Record<string,number>;cohort:string;
  examples?:CardChoiceExample[];summary?:string;other_version_opportunities?:number};
export type CardChoices = {schema_version:string;scope:string;minimum_opportunities:number;
  choices:CardChoiceBreakdown[];note:string};
export type DraftingJourney = {version:string;eligible_decisions:number;window_size:number;
  windows:JourneyWindow[];total_windows:number;versions_comparable:boolean;
  milestones:{id:string;date:string;from_at?:string;to_at?:string;text:string;count:number;average_score?:number;hard_decisions?:number}[];
  limited:boolean;note:string;progress_compatible?:boolean};
export type InsightCard = {id:string;name:string;image_url:string|null;mana_cost?:string|null;rarity?:string|null;type_line?:string|null};
export type InsightHighlight = {session_id:string;round:number;puzzle_id:string;set_id:string;
  environment:InsightsEnvironment;pick_number:number;date:string;score:number;
  trophy_match:boolean;selection_kind:string;reason_version?:string;reason_code?:string;reason_text?:string;
   reason_evidence?:Record<string,string|number>;selected_name?:string;historical_name?:string;
   preview?:{selected:InsightCard;trophy:InsightCard}};
export type InsightHighlights = {schema_version:string;best:InsightHighlight[];misses:InsightHighlight[];note:string;
  page?:number;has_more?:{best:boolean;misses:boolean}};
export type InsightDecision = {set_id:string;pick_number:number;score:number;trophy_match:boolean;
  selected:InsightCard;trophy:InsightCard;candidates:InsightCard[];prior_picks:InsightCard[];
  ranking?:{id:string;name:string;score:number|null;support:number|null}[];
  trophy_drafter?:{record:string|null;win_rate:number|null}|null;
  scoring_version:string;corpus_version:string;answered_at:string};

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
  drafting_dna?: DraftingDNA;
  card_choices?: CardChoices;
  leading_finding?: {id:string;text:string}|null;
  default_environment?: InsightsEnvironment;
  journey?: DraftingJourney;
  highlights?: InsightHighlights;
};

export async function loadMobileInsights(session: MobileSession, environment: InsightsEnvironment, period: InsightsPeriod, page=1): Promise<DraftInsights> {
  if (!session.accountToken) throw Error('Sign in to view your private drafting Insights.');
  const params = new URLSearchParams({ environment, period });
  if(page!==1)params.set('page',String(page));
  return requestJson<DraftInsights>('/growth/v1/mobile/profile/insights?' + params.toString(), {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 20_000,
  });
}

export async function loadMobileInsightDecision(session: MobileSession, item: InsightHighlight): Promise<InsightDecision> {
  if (!session.accountToken) throw Error('Sign in to view your saved picks.');
  const params=new URLSearchParams({
    session_id:item.session_id,round:String(item.round),puzzle_id:item.puzzle_id,
  });
  return requestJson<InsightDecision>('/growth/v1/mobile/profile/insights/decision?' + params.toString(),{
    mobileSessionToken:session.playerToken,mobileAccountToken:session.accountToken,timeoutMs:20_000,
  });
}
