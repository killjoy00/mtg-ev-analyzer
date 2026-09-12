import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAFT_RUN_LENGTH,
  DRAFT_RUN_PICK_WINDOWS,
  draftRunConsensusCap,
  draftRunDifficulty,
  draftRunRerollDistance,
  eligiblePickForRound,
  gradeDraftRunPick,
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

test('Draft Run is ten questions with progressively wider first-pack windows', () => {
  assert.equal(DRAFT_RUN_LENGTH, 10);
  assert.deepEqual(DRAFT_RUN_PICK_WINDOWS[0], [1, 1]);
  assert.deepEqual(DRAFT_RUN_PICK_WINDOWS[1], [2, 2]);
  assert.deepEqual(DRAFT_RUN_PICK_WINDOWS[2], [3, 3]);
  assert.deepEqual(DRAFT_RUN_PICK_WINDOWS[9], [8, 10]);
  assert.equal(eligiblePickForRound(3, 3), false);
  assert.equal(eligiblePickForRound(3, 4), true);
  assert.equal(eligiblePickForRound(3, 5), true);
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
