import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAFT_RUN_LENGTH,
  DRAFT_RUN_PICK_WINDOWS,
  draftRunConsensusCap,
  draftRunDifficulty,
  draftRunRerollDistance,
  eligiblePickForRound,
  calibratedSupports,
  gradeDraftRunPick,
  publicDraftRunPuzzle,
  SCORE_EXPONENT,
  SUPPORT_SHARPENING,
  supportSharpening,
  summarizeDraftRun,
} from '../draft-run.mjs';

function card(id, support) {
  return { id, name: id.toUpperCase(), model_probability: support };
}

function puzzle({ pick = 1, historical = 'b', supports = [0.55, 0.30, 0.10, 0.05], set = 'abc' } = {}) {
  const ids = ['a', 'b', 'c', 'd'];
  return {
    id: `${set}-${pick}`,
    set_id: set,
    pick_number: pick,
    historical_pick_id: historical,
    prior_picks: Array.from({ length: Math.max(0, pick - 1) }, (_, i) => ({ id: `prior-${i}` })),
    candidates: ids.map((id, index) => card(id, supports[index] || 0)),
  };
}

test('Draft Run is exactly the first eight regular draft decisions', () => {
  assert.equal(DRAFT_RUN_LENGTH, 8);
  assert.deepEqual(DRAFT_RUN_PICK_WINDOWS[0], [1, 1]);
  assert.deepEqual(DRAFT_RUN_PICK_WINDOWS[1], [2, 2]);
  assert.deepEqual(DRAFT_RUN_PICK_WINDOWS[2], [3, 3]);
  assert.deepEqual(DRAFT_RUN_PICK_WINDOWS[7], [8, 8]);
  assert.equal(eligiblePickForRound(3, 3), false);
  assert.equal(eligiblePickForRound(3, 4), true);
  assert.equal(eligiblePickForRound(3, 5), false);
  assert.equal(eligiblePickForRound(3, 6), false);
});

test('matching the real trophy drafter is always full credit', () => {
  const result = gradeDraftRunPick(puzzle({ historical: 'd' }), 'd');
  assert.equal(result.score, 100);
  assert.equal(result.historicalMatch, true);
  assert.equal(result.consensusRank, 4);
});

test('consensus leader is the highest-scoring non-historical answer', () => {
  const item = puzzle({ historical: 'd' });
  const first = gradeDraftRunPick(item, 'a');
  const second = gradeDraftRunPick(item, 'b');
  const third = gradeDraftRunPick(item, 'c');
  assert.equal(first.score, draftRunConsensusCap(1));
  assert.ok(first.score < 100);
  assert.ok(first.score > second.score);
  assert.ok(second.score > third.score);
});

test('equal contextual support receives equal credit at different depths', () => {
  assert.equal(draftRunConsensusCap(1),95);
  assert.equal(draftRunConsensusCap(11),95);
  assert.equal(gradeDraftRunPick(puzzle({pick:1}),'c').score,gradeDraftRunPick(puzzle({pick:9}),'c').score);
});

test('overall Draft Run score is an equal-weight arithmetic mean', () => {
  const puzzles = Array.from({length:10},(_,i)=>puzzle({historical:i===0?'a':'d',pick:Math.max(1,i),set:'a'+i}));
  const first = gradeDraftRunPick(puzzles[0], 'a').score;
  const second = gradeDraftRunPick(puzzles[1], 'a').score;
  const run = summarizeDraftRun(puzzles, Array(10).fill('a'));
  assert.equal(run.score, Math.round((first + 9*second) / 10));
  assert.equal(run.historicalMatches, 1);
  assert.equal(run.consensusLeaders, 10);
});

test('public Draft Run packs display the rare slot before uncommons and commons', () => {
  const item = puzzle();
  item.candidates = [
    { ...card('c', .2), rarity: 'common' },
    { ...card('u', .3), rarity: 'uncommon' },
    { ...card('r', .5), rarity: 'rare' },
  ];
  assert.deepEqual(publicDraftRunPuzzle(item).candidates.map((candidate) => candidate.id), ['r', 'u', 'c']);
});

test('reroll matching favors similar depth and decision shape', () => {
  const source = puzzle({ pick: 6, supports: [0.42, 0.35, 0.14, 0.09] });
  const similar = puzzle({ pick: 7, supports: [0.44, 0.34, 0.13, 0.09] });
  const obvious = puzzle({ pick: 2, supports: [0.92, 0.04, 0.03, 0.01] });
  assert.ok(draftRunRerollDistance(source, similar) < draftRunRerollDistance(source, obvious));
  const difficulty = draftRunDifficulty(source);
  assert.equal(difficulty.pickNumber, 6);
  assert.equal(difficulty.priorPoolSize, 5);
  assert.ok(difficulty.entropy > 0 && difficulty.entropy <= 1);
});

const calibrationPuzzle = (probabilities) => ({
  pick_number: 3,
  historical_pick_id: 'c1',
  candidates: probabilities.map((p, i) => ({id: `c${i}`, name: `C${i}`, model_probability: p})),
});

test('calibrated supports are a proper distribution and keep the pack order', () => {
  const probabilities = [0.52, 0.21, 0.15, 0.07, 0.05];
  const calibrated = calibratedSupports(calibrationPuzzle(probabilities).candidates);
  const values = [...calibrated.values()];
  assert.ok(Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  // sharpening is monotone, so nothing is reordered
  for (let i = 1; i < values.length; i += 1) assert.ok(values[i] <= values[i - 1]);
  // and the leader's share rises: that is the whole point
  assert.ok(values[0] > probabilities[0] / probabilities.reduce((a, b) => a + b, 0));
});

test('calibration does not move a single score', () => {
  // The award is (p_a^T / p_b^T)^(1/T), which is p_a / p_b exactly. Honest
  // numbers on screen, and nobody's score changes.
  assert.equal(SCORE_EXPONENT, 1 / SUPPORT_SHARPENING);
  for (const probabilities of [[0.52, 0.21, 0.15, 0.07, 0.05],
                               [0.9, 0.05, 0.03, 0.02],
                               [0.3, 0.28, 0.24, 0.18],
                               [0.4, 0.4, 0.1, 0.1]]) {
    const puzzle = calibrationPuzzle(probabilities);
    const leader = Math.max(...probabilities);
    puzzle.candidates.forEach((card, index) => {
      const before = index === 1 ? 100 : Math.round(95 * (probabilities[index] / leader));
      assert.equal(gradeDraftRunPick(puzzle, card.id).score, before,
        `score moved for ${card.id} in [${probabilities}]`);
    });
  }
});

test('colour-stage display calibration preserves linear awards at rounding boundaries',()=>{
  assert.equal(supportSharpening('qa-pair-model'),2);
  assert.equal(supportSharpening('qa-colour-stage-v7'),1.75);
  for(const supports of [[1,0.5,0.3,0.1],[0.9,0.45,0.15,0.01],[0.4,0.4,0.1,0.1]]) {
    const item=puzzle({supports,historical:'d'});
    const scores=version=>item.candidates.map(c=>gradeDraftRunPick({...item,corpus_version:version},c.id).score);
    assert.deepEqual(scores('qa-colour-stage-v7'),scores('qa-pair-model'));
    assert.deepEqual(scores('qa-colour-stage-v7'),supports.map((p,i)=>i===3?100:Math.round(95*p/Math.max(...supports))));
  }
});

test('difficulty still reads the raw stored supports', () => {
  // Ratings are persisted per puzzle; a presentation change must not re-band
  // the corpus underneath them.
  const puzzle = calibrationPuzzle([0.5, 0.25, 0.15, 0.1]);
  assert.equal(draftRunDifficulty(puzzle).rating, Math.round(100 * (0.25 / 0.5)));
});

test('an empty or degenerate pack still yields a usable distribution', () => {
  const flat = calibratedSupports([{id: 'a', model_probability: 0}, {id: 'b', model_probability: 0}]);
  assert.ok(Math.abs([...flat.values()].reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.equal(calibratedSupports([]).size, 0);
});
