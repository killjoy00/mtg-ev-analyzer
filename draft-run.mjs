import { rankCandidates } from './scoring.mjs';

const SUPPORT_EXPONENT = 0.75;
const EPSILON = 1e-9;

export const DRAFT_RUN_LENGTH = 10;
export const DRAFT_RUN_PICK_WINDOWS = Object.freeze([
  [1, 1],
  [2, 2],
  [3, 3],
  [3, 5],
  [4, 6],
  [5, 7],
  [5, 8],
  [6, 9],
  [7, 10],
  [8, 11],
]);

export function draftRunConsensusCap(pickNumber) {
  const pick = Math.max(1, Number(pickNumber) || 1);
  return Math.max(88, 97 - pick);
}

export function gradeDraftRunPick(puzzle, selectedId) {
  const candidates = puzzle?.candidates || puzzle?.pack || [];
  const ranked = rankCandidates(candidates);
  if (!ranked.length) throw new Error('Draft Run puzzle has no candidates.');
  const selected = ranked.find((card) => card.id === selectedId);
  if (!selected) throw new Error(`Selected card ${selectedId} is not in this Draft Run puzzle.`);

  const historicalId = puzzle.historical_pick_id || puzzle.historicalPickId;
  const historical = ranked.find((card) => card.id === historicalId) || null;
  const leader = ranked[0];
  const rank = ranked.findIndex((card) => card.id === selected.id) + 1;
  const selectedSupport = Math.max(0, Number(selected.model_probability || 0));
  const leaderSupport = Math.max(0, Number(leader.model_probability || 0));
  const supportRatio = leaderSupport <= EPSILON ? 1 : Math.max(0, Math.min(1, selectedSupport / leaderSupport));
  const consensusCap = draftRunConsensusCap(puzzle.pick_number || puzzle.pickNumber);
  const historicalMatch = Boolean(historicalId && selected.id === historicalId);
  const score = historicalMatch
    ? 100
    : Math.max(0, Math.min(99, Math.round(consensusCap * (supportRatio ** SUPPORT_EXPONENT))));

  return {
    score,
    selectedId: selected.id,
    selectedName: selected.name,
    selectedSupport,
    historicalId: historical?.id || historicalId || null,
    historicalName: historical?.name || puzzle.historical_pick_name || null,
    historicalMatch,
    consensusId: leader.id,
    consensusName: leader.name,
    consensusSupport: leaderSupport,
    consensusRank: rank,
    consensusCap,
    supportRatio,
    pickNumber: Number(puzzle.pick_number || puzzle.pickNumber || 1),
  };
}

export function summarizeDraftRun(puzzles, selectedIds) {
  if (!Array.isArray(puzzles) || !puzzles.length) throw new Error('Draft Run requires at least one puzzle.');
  if (!Array.isArray(selectedIds) || selectedIds.length !== puzzles.length) {
    throw new Error(`Draft Run requires ${puzzles.length} selections.`);
  }
  const results = puzzles.map((puzzle, index) => gradeDraftRunPick(puzzle, selectedIds[index]));
  const score = Math.round(results.reduce((sum, result) => sum + result.score, 0) / results.length);
  const historicalMatches = results.filter((result) => result.historicalMatch).length;
  const consensusLeaders = results.filter((result) => result.consensusRank === 1).length;
  return { score, historicalMatches, consensusLeaders, results };
}

export function normalizedSupportEntropy(candidates) {
  const values = (candidates || [])
    .map((card) => Math.max(0, Number(card.model_probability || 0)))
    .filter((value) => Number.isFinite(value));
  if (values.length <= 1) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= EPSILON) return 1;
  const entropy = values.reduce((sum, value) => {
    if (value <= EPSILON) return sum;
    const p = value / total;
    return sum - p * Math.log(p);
  }, 0);
  return Math.max(0, Math.min(1, entropy / Math.log(values.length)));
}

export function draftRunDifficulty(puzzle) {
  const candidates = rankCandidates(puzzle?.candidates || puzzle?.pack || []);
  const first = Math.max(0, Number(candidates[0]?.model_probability || 0));
  const second = Math.max(0, Number(candidates[1]?.model_probability || 0));
  const topGap = Math.max(0, first - second);
  const priorPoolSize = Array.isArray(puzzle?.prior_picks)
    ? puzzle.prior_picks.length
    : Math.max(0, Number(puzzle?.prior_pool_size || 0));
  return {
    pickNumber: Number(puzzle?.pick_number || puzzle?.pickNumber || 1),
    candidateCount: candidates.length,
    topGap,
    entropy: normalizedSupportEntropy(candidates),
    priorPoolSize,
  };
}

export function draftRunRerollDistance(source, candidate) {
  const a = draftRunDifficulty(source);
  const b = draftRunDifficulty(candidate);
  const pickDistance = Math.abs(a.pickNumber - b.pickNumber) / 3;
  const countDistance = Math.abs(a.candidateCount - b.candidateCount) / Math.max(1, a.candidateCount, b.candidateCount);
  const gapDistance = Math.abs(a.topGap - b.topGap);
  const entropyDistance = Math.abs(a.entropy - b.entropy);
  const poolDistance = Math.abs(a.priorPoolSize - b.priorPoolSize) / Math.max(1, a.priorPoolSize, b.priorPoolSize);
  return (pickDistance * 0.35) + (countDistance * 0.15) + (gapDistance * 0.25) + (entropyDistance * 0.15) + (poolDistance * 0.10);
}

export function eligiblePickForRound(roundIndex, pickNumber) {
  const window = DRAFT_RUN_PICK_WINDOWS[Number(roundIndex)];
  if (!window) return false;
  const pick = Number(pickNumber);
  return Number.isFinite(pick) && pick >= window[0] && pick <= window[1];
}
