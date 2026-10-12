import type { DraftRunAnswer } from '@/src/api/draftRun';

// Mirrors trophyDrafterFacts/trophyDrafterSentences in draft-run-feedback.mjs
// so web and native show the same source-drafter background.
export type TrophyDrafterFacts = {
  record: string | null;
  winRate: number | null;
  rank: 'Mythic' | 'Diamond' | null;
};

const LEGACY_RECORD = /^went 7–([0-2])$/;
const LEGACY_WIN_RATE = /^has an? (\d{1,3})% win rate$/;
const LEGACY_RANK = /^reached (Mythic|Diamond) rank$/;

export function trophyDrafterFacts(answer: Pick<DraftRunAnswer, 'trophyDrafter' | 'trophyRecord'>): TrophyDrafterFacts | null {
  const given = answer.trophyDrafter;
  if (given && typeof given === 'object') {
    const record = /^7–[0-2]$/.test(String(given.record ?? '')) ? String(given.record) : null;
    const rate = Number(given.winRate);
    const winRate = given.winRate != null && Number.isInteger(rate) && rate >= 50 && rate <= 100 ? rate : null;
    const rank = given.rank === 'Mythic' || given.rank === 'Diamond' ? given.rank : null;
    return record || winRate != null || rank ? { record, winRate, rank } : null;
  }
  const legacy = String(answer.trophyRecord ?? '').trim();
  const record = LEGACY_RECORD.exec(legacy);
  if (record) return { record: `7–${record[1]}`, winRate: null, rank: null };
  const winRate = LEGACY_WIN_RATE.exec(legacy);
  if (winRate) {
    const rate = Number(winRate[1]);
    return rate >= 50 && rate <= 100 ? { record: null, winRate: rate, rank: null } : null;
  }
  const rank = LEGACY_RANK.exec(legacy);
  return rank ? { record: null, winRate: null, rank: rank[1] as 'Mythic' | 'Diamond' } : null;
}

// 17Lands calls the archived figure the drafter's overall win rate, so it is
// not labeled as specific to this format, draft or card.
export function trophyDrafterSentences(facts: TrophyDrafterFacts | null): string[] {
  if (!facts) return [];
  return [
    facts.record ? `This trophy draft finished ${facts.record}.` : null,
    facts.winRate != null
      ? `17Lands reports the trophy drafter’s overall game win rate as about ${facts.winRate}%. It describes the drafter, not this draft or this card.`
      : null,
    facts.rank ? `The trophy drafter reached ${facts.rank} rank.` : null,
  ].filter((line): line is string => Boolean(line));
}
