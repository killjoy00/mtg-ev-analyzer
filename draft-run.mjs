import {effectiveCardMetadata} from './card-metadata.mjs';
import {meetsServingQuality} from './serving-quality.mjs';
import {DAILY_SELECTION_VERSION,dailySetPlan,liveRegularSets} from './daily-selection.mjs';
import { rankCandidates } from './scoring.mjs';
import { seededRandom } from './gameplay.mjs';
import { sortPackByRarity } from './replay-data.mjs';
import {rateDraftRunPuzzle,DRAFT_RUN_DIFFICULTY_VERSION,LEGACY_DIFFICULTY_VERSION,MAX_REROLL_RATING_DELTA} from './draft-run-difficulty.mjs';
import {DRAFT_RUN_SELECTION_VERSION,PREVIOUS_SELECTION_VERSION,DRAFT_RUN_LENGTH,isEightPickVersion,earlyRoundsForSelection,eligibleRunPuzzle,regularRunSet,chooseRunSet,runDifficultyBands,dailyRequiredSets,releasedRunSets,requiredSetRounds} from './draft-run-policy.mjs';
import {gameDateKey} from './game-date.mjs';
import {approvedTraditionalSource,modelVersionForComponent,supportedComponent} from './corpus-components.mjs';

const EPSILON = 1e-9;
export const DRAFT_RUN_SCORING_VERSION = 'trophy-consensus-v3';
// Hashed into every puzzle id, so a bump publishes a parallel corpus rather
// than editing the old one: existing rows stay resolvable, in-flight sessions
// and old challenges keep working, and recorded scores are untouched.
// scripts/set_policy.py reads this value rather than copying it, and a test
// refuses any stale literal elsewhere - a half-landed bump is what lets the
// importer reuse old payloads under a new label and ship two models as one.
export const DRAFT_RUN_CORPUS_VERSION = 'elite-trophy-colour-stage-v8';
// Pooled validation fitted 2.0 for the old pair model and 1.75 for the
// colour-stage model. Display calibration follows the puzzle's pinned model.
export function supportSharpening(corpusVersion=DRAFT_RUN_CORPUS_VERSION) {
  return supportedComponent(corpusVersion)||String(corpusVersion).includes('-colour-stage-') ? 1.75 : 2;
}
export const SUPPORT_SHARPENING = supportSharpening();
// Retained for callers expressing the equivalent inverse-display formula.
// Awards themselves use the raw ratio to avoid floating-point round trips.
export const SCORE_EXPONENT = 1 / SUPPORT_SHARPENING;
export const POWERED_CUBE_ENVIRONMENT = 'powered-cube';

export {DRAFT_RUN_LENGTH};
const PREVIOUS_PICK_WINDOWS = Object.freeze([
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
const PREVIOUS_CUBE_WINDOWS = Object.freeze([
  [2,2], [3,3], [4,4], [4,6], [5,7], [6,8], [6,9], [7,10], [8,11], [9,12],
]);
const TEN_PICK_WINDOWS = Object.freeze([[1,1],[2,2],[3,3],[4,5],[5,6],[6,7],[7,8],[8,9],[8,10],[8,10]]);
const HISTORICAL_EIGHT_WINDOWS = Object.freeze([[1,1],[2,2],[3,3],[4,5],[5,6],[6,8],[7,9],[8,10]]);
export const DRAFT_RUN_PICK_WINDOWS = Object.freeze(Array.from({length:8},(_,i)=>[i+1,i+1]));
export const CUBE_PICK_WINDOWS = Object.freeze(DRAFT_RUN_PICK_WINDOWS.map(([a,b])=>[a+1,b+1]));
export function runPickWindows(environment='mixed',version=DRAFT_RUN_SELECTION_VERSION) {
  if(version===PREVIOUS_SELECTION_VERSION)return environment===POWERED_CUBE_ENVIRONMENT?PREVIOUS_CUBE_WINDOWS:PREVIOUS_PICK_WINDOWS;
  const windows=version===DAILY_SELECTION_VERSION?DRAFT_RUN_PICK_WINDOWS:version==='eight-pick-v3'?HISTORICAL_EIGHT_WINDOWS:TEN_PICK_WINDOWS;
  return environment===POWERED_CUBE_ENVIRONMENT?windows.map(([a,b])=>[a+1,b+1]):windows;
}

export function draftRunEnvironment(value = 'mixed') {
  if (!['mixed', 'latest', POWERED_CUBE_ENVIRONMENT].includes(value)) throw new Error('Invalid Draft Run environment.');
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

// Stored supports, raised to SUPPORT_SHARPENING and renormalised. This is what a
// player should be shown: normalising the raw values understates the consensus.
// Difficulty ratings deliberately stay on the raw stored values, because they
// are persisted per puzzle and a presentation change must not silently re-band
// the corpus.
export function calibratedSupports(candidates, exponent=SUPPORT_SHARPENING) {
  if(!Number.isFinite(exponent)||exponent<=0)throw Error('Invalid support calibration.');
  const raw = (candidates || []).map(c => Math.max(0, Number(c.model_probability || 0)));
  const sharpened = raw.map(value => value ** exponent);
  const total = sharpened.reduce((sum, value) => sum + value, 0);
  const share = total > EPSILON ? sharpened.map(v => v / total)
    : raw.map(() => 1 / Math.max(1, raw.length));
  return new Map((candidates || []).map((c, index) => [c.id, share[index]]));
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
  const calibrated = calibratedSupports(ranked,supportSharpening(puzzle.corpus_version));
  const selectedSupport = calibrated.get(selected.id) || 0;
  const leaderSupport = calibrated.get(leader.id) || 0;
  const supportRatio = Math.max(0, Math.min(1, selectedSupport / leaderSupport));
  const rawRatio = Math.max(0,Math.min(1,Number(selected.model_probability)/Number(leader.model_probability)));
  const consensusCap = draftRunConsensusCap(puzzle.pick_number || puzzle.pickNumber);
  const historicalMatch = Boolean(historicalId && selected.id === historicalId);
  const score = historicalMatch
    ? 100
    : Math.round(consensusCap * rawRatio);

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
  if (!Array.isArray(puzzles) || ![8,10].includes(puzzles.length)) throw new Error('Draft Run requires eight puzzles, or ten for a historical run.');
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

export function eligiblePickForRound(roundIndex, pickNumber, environment = 'mixed', selectionVersion=DRAFT_RUN_SELECTION_VERSION) {
  const window = runPickWindows(environment,selectionVersion)[Number(roundIndex)];
  if (!window) return false;
  const pick = Number(pickNumber);
  return Number.isInteger(pick) && pick >= window[0] && pick <= window[1];
}

// Imports use the current version by default. Existing sessions explicitly
// supply the version pinned when they were created; a release does not rewrite
// their immutable evidence or make their still-present puzzles unreadable.
export function validateDraftRunPuzzle(puzzle, expectedVersion = DRAFT_RUN_CORPUS_VERSION) {
  const cards = puzzle?.candidates || [];
  const prior = puzzle?.prior_picks || [];
  const pick = Number(puzzle?.pick_number);
  const legacySkill = ['stx','mid','vow'].includes(puzzle?.set_id) &&
    puzzle?.skill_evidence === 'earliest_game_arena_rank' &&
    ['diamond','mythic'].includes(puzzle?.player_rank_tier) && puzzle?.player_win_rate_bucket == null;
  const rateSkill = puzzle?.skill_evidence === 'win_rate_bucket' &&
    Number(puzzle?.player_win_rate_bucket) >= 0.6 && Number(puzzle?.player_win_rate_bucket) <= 1;
  return typeof expectedVersion === 'string' && expectedVersion.length > 0 &&
    puzzle?.corpus_version === expectedVersion &&
    Number(puzzle.pack_number??1)===1 &&
    ((puzzle.source_event_type??'PremierDraft')==='PremierDraft'
      ? Number(puzzle.event_match_wins)===7 && (puzzle.event_match_losses==null||[0,1,2].includes(Number(puzzle.event_match_losses)))
      : puzzle.source_event_type==='TradDraft' && approvedTraditionalSource(puzzle) &&
        puzzle.model_version===modelVersionForComponent(puzzle.corpus_version) && puzzle.model_source_event==='PremierDraft' &&
        Number(puzzle.event_match_wins)===3 && puzzle.event_match_losses===0 && pick<=8 && rateSkill) &&
    Number(puzzle.player_games_lower_bound) >= 100 &&
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

export function selectDraftRun(pool, seed, environment = 'mixed', {daily=false,day=gameDateKey(),selectionVersion=DRAFT_RUN_SELECTION_VERSION,metadata=null}={}) {
  const random = seededRandom(seed);
  const released=new Set(releasedRunSets(day));
  const live=metadata?new Set(metadata.filter(s=>s.status==='Live').map(s=>s.set_id)):null;
  const sorted = poolForEnvironment(pool, environment).filter(p=>meetsServingQuality(p)&&(!live||live.has(p.set_id))&&eligibleRunPuzzle(p)&&(environment==='powered-cube'||regularRunSet(p.set_id))&&(!daily||selectionVersion===DAILY_SELECTION_VERSION||!isEightPickVersion(selectionVersion)||environment==='powered-cube'||released.has(p.set_id))).sort((a,b) => a.puzzle_id.localeCompare(b.puzzle_id));
  const bandsByPuzzle = new Map(sorted.map(p=>[p.puzzle_id,rateDraftRunPuzzle(p).band]));
  // Shuffle the composition, so difficulty does not disclose the round's role.
  // An unavailable easy slot can become medium; never exceed one easy choice.
  const bands = runDifficultyBands(random,selectionVersion),windows=runPickWindows(environment,selectionVersion);
  const required=daily&&environment==='mixed'&&selectionVersion===DAILY_SELECTION_VERSION?dailySetPlan(metadata||[],day,random):daily&&environment==='mixed'&&isEightPickVersion(selectionVersion)?dailyRequiredSets(day):[];
  const forced=requiredSetRounds(sorted.map(p=>({set_id:p.set_id,pick_number:p.pick_number,band:bandsByPuzzle.get(p.puzzle_id),n:1})),bands,windows,random,required);
  const selected = [], sources = new Set(), sets = new Set();
  for (let round = 0; round < windows.length; round++) {
    let available = sorted.filter(p => eligiblePickForRound(round,p.pick_number,environment,selectionVersion) && !sources.has(p.source_draft_hash) && (forced.has(round)?p.set_id===forced.get(round):!required.includes(p.set_id)));
    const band = bands[round];
    let matching = available.filter(p => bandsByPuzzle.get(p.puzzle_id) === band);
    if (!matching.length && band === 'easy') matching = available.filter(p => bandsByPuzzle.get(p.puzzle_id) === 'medium');
    available = matching;
    const fresh = available.filter(p => !sets.has(p.set_id));
    if (fresh.length && !forced.has(round)) available = fresh;
    else {
      const different = available.filter(p => p.set_id !== selected.at(-1)?.set_id);
      if (different.length) available = different;
    }
    // Equal chance per environment: large sets must not crowd out small sets.
    const setIds = [...new Set(available.map(p => p.set_id))].sort();
    const setId = chooseRunSet(setIds,random,daily,selectionVersion,day);
    available = available.filter(p => p.set_id === setId);
    if (!available.length) throw new Error('Not enough verified puzzles for a balanced run.');
    const chosen = available[Math.floor(random() * available.length)];
    selected.push(chosen); sources.add(chosen.source_draft_hash); sets.add(chosen.set_id);
  }
  return selected;
}

export function selectDraftRunReroll(pool, source, { type, round, seed, excludedSources = [], environment = 'mixed', difficultyVersion = DRAFT_RUN_DIFFICULTY_VERSION, selectionVersion=DRAFT_RUN_SELECTION_VERSION,daily=false,day=gameDateKey(), anchor = null }) {
  if (!['set','pack'].includes(type)) throw new Error('Invalid reroll.');
  if (environment === POWERED_CUBE_ENVIRONMENT && type === 'set') throw new Error('Cube rerolls stay within Powered Cube.');
  const excluded = new Set([...excludedSources,source.source_draft_hash]);
  const sourceRating = rateDraftRunPuzzle(source);
  const origin = anchor || sourceRating;
  if (![LEGACY_DIFFICULTY_VERSION,DRAFT_RUN_DIFFICULTY_VERSION].includes(difficultyVersion)) throw Error('Unsupported difficulty version.');
  const previous=selectionVersion===PREVIOUS_SELECTION_VERSION;
  const released=new Set(releasedRunSets(day));
  const eligible = poolForEnvironment(pool, environment).filter(meetsServingQuality).filter(p=>previous||(eligibleRunPuzzle(p)&&(environment==='powered-cube'||regularRunSet(p.set_id))&&(round<earlyRoundsForSelection(selectionVersion)||rateDraftRunPuzzle(p).band!=='easy'))).filter(p=>(!daily||selectionVersion===DAILY_SELECTION_VERSION||!isEightPickVersion(selectionVersion)||environment==='powered-cube'||released.has(p.set_id)) && !excluded.has(p.source_draft_hash) &&
    (type === 'set' ? p.set_id !== source.set_id : p.set_id === source.set_id) &&
    eligiblePickForRound(round,p.pick_number,environment,selectionVersion) && Math.abs(p.pick_number-source.pick_number) <= 1)
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
  const random=seededRandom(`${seed}:${round}:${type}:${source.puzzle_id}`);
  if(previous||!daily||type==='pack')return best[Math.floor(random()*best.length)].puzzle;
  const setId=chooseRunSet([...new Set(best.map(p=>p.puzzle.set_id))].sort(),random,true,selectionVersion,day);
  const sameSet=best.filter(p=>p.puzzle.set_id===setId);
  return sameSet[Math.floor(random()*sameSet.length)].puzzle;
}

export function publicDraftRunPuzzle(puzzle) {
  const card = original => {const c=effectiveCardMetadata(original);return Object.fromEntries(['id','name','image_url','mana_cost','rarity','type_line'].filter(k => c[k]).map(k => [k,c[k]]));};
  return {
    puzzle_id:puzzle.puzzle_id, set_id:puzzle.set_id, pack_number:1, pick_number:Number(puzzle.pick_number),
    prior_picks:puzzle.prior_picks.map(card), candidates:sortPackByRarity(puzzle.candidates.map(card)),
  };
}
