export const DRAFT_RUN_DIFFICULTY_VERSION = 'support-ratio-v1';
export const LEGACY_DIFFICULTY_VERSION = 'legacy';
export const MAX_REROLL_RATING_DELTA = 10;

export function difficultyBand(rating) {
  if (!Number.isInteger(rating) || rating < 0 || rating > 100) throw Error('Invalid difficulty rating.');
  return rating < 50 ? 'easy' : rating < 80 ? 'medium' : 'hard';
}

// This measures ambiguity between leading choices, not a calibrated human
// success probability. Model/target disagreement is separate evidence.
export function rateDraftRunPuzzle(puzzle) {
  const cards = puzzle?.candidates || puzzle?.pack;
  let ratio, targetRatio;
  if (cards) {
    const values = cards.map(c => Number(c.model_probability)).sort((a,b) => b-a);
    if (values.length < 2 || values.some(v => !Number.isFinite(v) || v < 0) || !(values[0] > 0)) throw Error('Invalid difficulty evidence.');
    ratio = values[1] / values[0];
    const target = cards.find(c => c.id === (puzzle.historical_pick_id || puzzle.historicalPickId));
    targetRatio = target ? Number(target.model_probability) / values[0] : null;
  } else {
    if (puzzle?.difficulty_version !== DRAFT_RUN_DIFFICULTY_VERSION || puzzle.top_two_ratio == null) throw Error('Missing versioned difficulty evidence.');
    ratio = Number(puzzle.top_two_ratio);
    targetRatio = puzzle.target_support_ratio == null ? null : Number(puzzle.target_support_ratio);
  }
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw Error('Invalid difficulty evidence.');
  const rating = Math.round(100 * ratio);
  return { version:DRAFT_RUN_DIFFICULTY_VERSION, rating, band:difficultyBand(rating), topTwoRatio:ratio,
    targetSupportRatio:targetRatio, modelTargetDisagreement:targetRatio != null && targetRatio < 0.2 };
}

export function publicDifficulty(puzzle) {
  const {version,rating,band} = rateDraftRunPuzzle(puzzle);
  return {version,rating,band};
}
