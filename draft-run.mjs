import { rankCandidates } from './scoring.mjs';
import { seededRandom } from './gameplay.mjs';
import {rateDraftRunPuzzle,publicDifficulty,DRAFT_RUN_DIFFICULTY_VERSION,LEGACY_DIFFICULTY_VERSION,MAX_REROLL_RATING_DELTA} from './draft-run-difficulty.mjs';

const SUPPORT_EXPONENT = 1;
const EPSILON = 1e-9;
export const DRAFT_RUN_SCORING_VERSION = 'trophy-consensus-v2';
export const DRAFT_RUN_CORPUS_VERSION = 'elite-trophy-verified-v6';
export const POWERED_CUBE_ENVIRONMENT = 'powered-cube';

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
// Cube's archive omits complete P1P1 packs. Keep true pick positions and show
// the actual inherited first pick instead of inventing an opening pack.
export const CUBE_PICK_WINDOWS = Object.freeze([
  [2,2], [3,3], [4,4], [4,6], [5,7], [6,8], [6,9], [7,10], [8,11], [9,12],
]);

export function draftRunEnvironment(value = 'mixed') {
  if (!['mixed', POWERED_CUBE_ENVIRONMENT].includes(value)) throw new Error('Invalid Draft Run environment.');
  return value;
}

export function poolForEnvironment(pool, environment = 'mixed') {
  draftRunEnvironment(environment);
  return pool.filter(p => environment === POWERED_CUBE_ENVIRONMENT ? p.set_id === environment : p.set_id !== POWERED_CUBE_ENVIRONMENT);
}

export function draftRunConsensusCap() {
  // Pick depth is already an input to the contextual model. Penalizing an
  // equally supported alternative again just because it is late is arbitrary.
  return 95;
}

export function gradeDraftRunPick(puzzle, selectedId) {
  const candidates = puzzle?.candidates || puzzle?.pack || [];
  const ranked = rankCandidates(candidates);
  if (!ranked.length) throw new Error('Draft Run puzzle has no candidates.');
  const selected = ranked.find((card) => card.id === selectedId);
  if (!selected) throw new Error(`Selected card ${selectedId} is not in this Draft Run puzzle.`);

  const historicalId = puzzle.historical_pick_id || puzzle.historicalPickId;
  const historical = ranked.find((card) => card.id === historicalId) || null;
  if (!historical || new Set(ranked.map(c => c.id)).size !== ranked.length ||
      ranked.some(c => !Number.isFinite(Number(c.model_probability)) || Number(c.model_probability) < 0) ||
      !ranked.some(c => Number(c.model_probability) > EPSILON)) {
    throw new Error('Draft Run puzzle has invalid scoring evidence.');
  }
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
  if (!Array.isArray(puzzles) || puzzles.length !== DRAFT_RUN_LENGTH) throw new Error('Draft Run requires ten puzzles.');
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
  const rated = rateDraftRunPuzzle(puzzle);
  if (!puzzle?.candidates && !puzzle?.pack && puzzle?.candidate_count) return {
    ...rated,
    pickNumber: Number(puzzle.pick_number), candidateCount: Number(puzzle.candidate_count),
    topGap: Number(puzzle.consensus_top_gap), entropy: Number(puzzle.support_entropy),
    priorPoolSize: Number(puzzle.pick_number) - 1,
  };
  const candidates = rankCandidates(puzzle?.candidates || puzzle?.pack || []);
  const first = Math.max(0, Number(candidates[0]?.model_probability || 0));
  const second = Math.max(0, Number(candidates[1]?.model_probability || 0));
  const topGap = Math.max(0, first - second);
  const priorPoolSize = Array.isArray(puzzle?.prior_picks)
    ? puzzle.prior_picks.length
    : Math.max(0, Number(puzzle?.prior_pool_size || 0));
  return {
    ...rated,
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

export function eligiblePickForRound(roundIndex, pickNumber, environment = 'mixed') {
  const window = (environment === POWERED_CUBE_ENVIRONMENT ? CUBE_PICK_WINDOWS : DRAFT_RUN_PICK_WINDOWS)[Number(roundIndex)];
  if (!window) return false;
  const pick = Number(pickNumber);
  return Number.isInteger(pick) && pick >= window[0] && pick <= window[1];
}

export function validateDraftRunPuzzle(puzzle) {
  const cards = puzzle?.candidates || [];
  const prior = puzzle?.prior_picks || [];
  const pick = Number(puzzle?.pick_number);
  const legacySkill = ['stx','mid','vow'].includes(puzzle?.set_id) &&
    puzzle?.skill_evidence === 'earliest_game_arena_rank' &&
    ['diamond','mythic'].includes(puzzle?.player_rank_tier) && puzzle?.player_win_rate_bucket == null;
  const rateSkill = puzzle?.skill_evidence === 'win_rate_bucket' &&
    Number(puzzle?.player_win_rate_bucket) >= 0.6 && Number(puzzle?.player_win_rate_bucket) <= 1;
  return puzzle?.corpus_version === DRAFT_RUN_CORPUS_VERSION &&
    Number(puzzle.event_match_wins) === 7 && Number(puzzle.player_games_lower_bound) >= 100 &&
    (legacySkill || rateSkill) && puzzle.source_evidence === 'official_archive_trajectory' &&
    Number.isInteger(pick) && pick >= (puzzle.set_id === POWERED_CUBE_ENVIRONMENT ? 2 : 1) &&
    pick <= (puzzle.set_id === POWERED_CUBE_ENVIRONMENT ? 12 : 11) && prior.length === pick - 1 &&
    prior.every(c => c.id && c.name && c.order_known !== false) && cards.length >= 4 &&
    new Set(cards.map(c => c.id)).size === cards.length &&
    cards.every(c => c.id && c.name && Number.isFinite(Number(c.model_probability)) && Number(c.model_probability) >= 0) &&
    cards.some(c => c.id === puzzle.historical_pick_id) && cards.some(c => Number(c.model_probability) > 0);
}

export function interestingDraftRunPuzzle(puzzle) {
  const ranked = rankCandidates(puzzle.candidates || []);
  const a = Number(ranked[0]?.model_probability || 0);
  const b = Number(ranked[1]?.model_probability || 0);
  // Keep real decisions, including near ties, while excluding forced picks and
  // overwhelming bombs. This filter does not favor agreement with the target.
  return ranked.length >= 4 && a > 0 && a <= 0.75 && b / a >= 0.2;
}

export function selectDraftRun(pool, seed, environment = 'mixed') {
  const random = seededRandom(seed);
  const sorted = poolForEnvironment(pool, environment).sort((a,b) => a.puzzle_id.localeCompare(b.puzzle_id));
  const bandsByPuzzle = new Map(sorted.map(p=>[p.puzzle_id,rateDraftRunPuzzle(p).band]));
  // Shuffle the composition, so difficulty does not disclose the round's role.
  // An unavailable easy slot can become medium; never exceed one easy choice.
  const bands = ['easy',...Array(6).fill('medium'),...Array(3).fill('hard')];
  for(let i=bands.length-1;i>0;i--) {const j=Math.floor(random()*(i+1));[bands[i],bands[j]]=[bands[j],bands[i]];}
  const selected = [], sources = new Set(), sets = new Set();
  for (let round = 0; round < DRAFT_RUN_LENGTH; round++) {
    let available = sorted.filter(p => eligiblePickForRound(round,p.pick_number,environment) && !sources.has(p.source_draft_hash));
    const band = bands[round];
    let matching = available.filter(p => bandsByPuzzle.get(p.puzzle_id) === band);
    if (!matching.length && band === 'easy') matching = available.filter(p => bandsByPuzzle.get(p.puzzle_id) === 'medium');
    available = matching;
    const fresh = available.filter(p => !sets.has(p.set_id));
    if (fresh.length) available = fresh;
    else {
      const different = available.filter(p => p.set_id !== selected.at(-1)?.set_id);
      if (different.length) available = different;
    }
    // Equal chance per environment: large sets must not crowd out small sets.
    const setIds = [...new Set(available.map(p => p.set_id))].sort();
    const setId = setIds[Math.floor(random() * setIds.length)];
    available = available.filter(p => p.set_id === setId);
    if (!available.length) throw new Error('Not enough verified puzzles for a balanced run.');
    const chosen = available[Math.floor(random() * available.length)];
    selected.push(chosen); sources.add(chosen.source_draft_hash); sets.add(chosen.set_id);
  }
  return selected;
}

export function selectDraftRunReroll(pool, source, { type, round, seed, excludedSources = [], environment = 'mixed', difficultyVersion = DRAFT_RUN_DIFFICULTY_VERSION, anchor = null }) {
  if (!['set','pack'].includes(type)) throw new Error('Invalid reroll.');
  if (environment === POWERED_CUBE_ENVIRONMENT && type === 'set') throw new Error('Cube rerolls stay within Powered Cube.');
  const excluded = new Set([...excludedSources,source.source_draft_hash]);
  const sourceRating = rateDraftRunPuzzle(source);
  const origin = anchor || sourceRating;
  if (![LEGACY_DIFFICULTY_VERSION,DRAFT_RUN_DIFFICULTY_VERSION].includes(difficultyVersion)) throw Error('Unsupported difficulty version.');
  const eligible = poolForEnvironment(pool, environment).filter(p => !excluded.has(p.source_draft_hash) &&
    (type === 'set' ? p.set_id !== source.set_id : p.set_id === source.set_id) &&
    eligiblePickForRound(round,p.pick_number,environment) && Math.abs(p.pick_number-source.pick_number) <= 1)
    .filter(p => {
      if(difficultyVersion===LEGACY_DIFFICULTY_VERSION)return true;
      const rating=rateDraftRunPuzzle(p);
      return rating.band===sourceRating.band && rating.band===origin.band &&
        Math.abs(rating.rating-sourceRating.rating)<=MAX_REROLL_RATING_DELTA &&
        Math.abs(rating.rating-origin.rating)<=MAX_REROLL_RATING_DELTA;
    })
    .map(p => ({ puzzle:p, distance:draftRunRerollDistance(source,p) }))
    .filter(p => Number.isFinite(p.distance) && p.distance <= 0.16)
    .sort((a,b) => a.distance-b.distance || a.puzzle.puzzle_id.localeCompare(b.puzzle.puzzle_id));
  if (!eligible.length) return null; // Never spend a token on a failed reroll.
  const best = eligible.slice(0,20);
  return best[Math.floor(seededRandom(`${seed}:${round}:${type}:${source.puzzle_id}`)() * best.length)].puzzle;
}

export function publicDraftRunPuzzle(puzzle) {
  const card = c => Object.fromEntries(['id','name','image_url','mana_cost','rarity','type_line'].filter(k => c[k]).map(k => [k,c[k]]));
  return {
    puzzle_id:puzzle.puzzle_id, set_id:puzzle.set_id, pick_number:Number(puzzle.pick_number),
    prior_picks:puzzle.prior_picks.map(card), candidates:puzzle.candidates.map(card),
    difficulty:publicDifficulty(puzzle),
  };
}
