import type { DraftRunAnswer } from '@/src/api/draftRun';

// Mirrors draft-run-reveal.mjs and the reveal sentences in
// draft-run-feedback.mjs so web and native explain a locked pick the same way.
// tests/reveal-parity.test.mjs compares these against the web modules.

export type RevealChoice = { id: string; label: string };

// Keep the player's card visible even when it falls outside the model's top
// three. A model leader already used by either role is never repeated.
export function revealCardChoices(answer: Pick<DraftRunAnswer, 'historicalId' | 'selectedId' | 'ranking'>): RevealChoice[] {
  const trophy = answer.historicalId;
  const mine = answer.selectedId;
  const choices: RevealChoice[] = [];
  if (trophy) choices.push({ id: trophy, label: mine === trophy ? 'Your pick · Trophy pick' : 'Trophy pick' });
  if (mine && mine !== trophy) choices.push({ id: mine, label: 'Your pick' });
  const used = new Set(choices.map((choice) => choice.id));
  const ranking = [...(answer.ranking ?? [])]
    .filter((card) => card.id && card.support != null && Number.isFinite(Number(card.support)))
    .sort((a, b) => Number(b.support) - Number(a.support));
  for (const card of ranking) {
    if (choices.length === 3) break;
    if (used.has(card.id)) continue;
    choices.push({
      id: card.id,
      label: mine === trophy ? (choices.length === 1 ? 'Next highest' : 'Third highest') : 'Next best',
    });
    used.add(card.id);
  }
  return choices;
}

export function modelSupportLabel(support: number | null | undefined, leader: number | null | undefined) {
  if (support == null || !Number.isFinite(Number(support)) || Number(support) < 0 || !Number.isFinite(Number(leader)) || Number(leader) <= 0) return 'Unavailable';
  const pct = 100 * Number(support) / Number(leader);
  return pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`;
}

// Mirrors the saved-score ranking in draft-run-reveal.mjs.
export function scoreRankLabel(answer: Pick<DraftRunAnswer, 'ranking' | 'selectedId' | 'score' | 'puzzle'>) {
  const rows = answer.ranking;
  if (!Array.isArray(rows) || !rows.length || rows.some(row => row.score == null || !Number.isFinite(Number(row.score)))) return '';
  if (new Set(rows.map(row => row.id)).size !== rows.length) return '';
  const candidates = answer.puzzle?.candidates;
  if (Array.isArray(candidates) && (candidates.length !== rows.length || candidates.some(card => !rows.some(row => row.id === card.id)))) return '';
  const selected = rows.find(row => row.id === answer.selectedId);
  if (!selected || (answer.score != null && Number(answer.score) !== Number(selected.score))) return '';
  const score = Number(selected.score);
  const rank = 1 + rows.filter(row => Number(row.score) > score).length;
  const tied = rows.filter(row => Number(row.score) === score).length > 1;
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[rank % 10] || 'th');
  return `Your pick ${tied ? 'tied for' : 'ranked'} ${rank}${suffix} out of ${rows.length} ${rows.length === 1 ? 'card' : 'cards'}.`;
}

export function trophyRevealSentence(answer: Pick<DraftRunAnswer, 'historicalMatch' | 'historicalName'>) {
  if (answer.historicalMatch) return 'You matched the trophy pick.';
  return `The trophy drafter took ${answer.historicalName || 'another card'}.`;
}

export function compactRevealFeedback(answer: Pick<DraftRunAnswer, 'historicalMatch' | 'selectedName'>) {
  if (answer.historicalMatch) return '';
  return answer.selectedName ? `You picked ${answer.selectedName}.` : '';
}

// Points stay the saved, version-pinned game scores. A card missing from the
// ranking falls back to the answer's own saved values, never a regrade.
export function revealChoiceScore(answer: Pick<DraftRunAnswer, 'ranking' | 'historicalId' | 'selectedId' | 'score'>, cardId: string) {
  const ranked = answer.ranking?.find((item) => item.id === cardId);
  if (ranked?.score != null) return Number(ranked.score);
  if (cardId === answer.historicalId) return 100;
  if (cardId === answer.selectedId) return answer.score;
  return null;
}

// Trophy pick first, then model support, as in the web "Compare all" table.
export function compareAllRanking(answer: Pick<DraftRunAnswer, 'ranking' | 'historicalId'>) {
  return [...(answer.ranking ?? [])].sort(
    (a, b) => Number(b.id === answer.historicalId) - Number(a.id === answer.historicalId)
      || Number(b.support) - Number(a.support),
  );
}

export const SCORING_COPY = 'Match the trophy drafter for 100 points. Other picks earn up to 95 points, depending on how likely drafters are to take that card.';
export const MODEL_NOTE = 'These numbers show how strongly the model favors each card in this pack. They aren’t win rates.';
