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

// Trophy model support is intentionally not displayed.
export function modelSupportLabel(support: number | null | undefined, leader: number | null | undefined, isTrophy = false) {
  if (isTrophy) return '-';
  return support != null && Number.isFinite(Number(support)) && Number(leader) > 0
    ? `${Math.round(100 * Number(support) / Number(leader))}%`
    : 'Unavailable';
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

export const SCORING_COPY = 'Matching the trophy pick earns 100 points. Other picks earn up to 95, based on the model.';
export const MODEL_NOTE = 'Support compares each card with the model’s top choice. It isn’t a win rate.';
