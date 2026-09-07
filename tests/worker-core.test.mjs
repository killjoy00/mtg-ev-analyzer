import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeIndex, featuredSetId, fullPackDecisionWeight, gameDateKey, gradeFullPack, gradeTopThree, periodStart } from '../worker/core.mjs';

const cards = [
  { id: 'a', name: 'A', model_probability: 0.4 },
  { id: 'b', name: 'B', model_probability: 0.3 },
  { id: 'c', name: 'C', model_probability: 0.2 },
  { id: 'd', name: 'D', model_probability: 0.1 },
];

test('daily challenge selector is deterministic and bounded', () => {
  const a = challengeIndex('2026-09-06', 'msh', 'top3', 300);
  const b = challengeIndex('2026-09-06', 'msh', 'top3', 300);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 300);
});

test('worker Daily selector never repeats the prior replay', () => {
  let previous = challengeIndex('2026-09-01', 'msh', 'top3', 2);
  for (let day = 2; day <= 9; day += 1) {
    const current = challengeIndex(`2026-09-0${day}`, 'msh', 'top3', 2);
    assert.notEqual(current, previous);
    previous = current;
  }
});

test('worker Daily game day resets at midnight Eastern', () => {
  assert.equal(gameDateKey(new Date('2026-09-07T00:30:00Z')), '2026-09-06');
  assert.equal(gameDateKey(new Date('2026-09-07T04:30:00Z')), '2026-09-07');
});

test('worker top-three grading matches app set-first scoring', () => {
  const perfect = gradeTopThree(cards, ['a', 'b', 'c'], 'a');
  assert.equal(perfect.score, 100);
  assert.equal(perfect.grade, 'A+');
  const scrambled = gradeTopThree(cards, ['c', 'b', 'a'], 'a');
  assert.equal(scrambled.setSupport, 100);
  assert.equal(scrambled.score, 94);
});

test('full pack score weights meaningful decisions and ignores forced picks', () => {
  const replay = { picks: [
    { pack_number: 0, pick_number: 0, historical_pick_id: 'a', candidates: cards },
    { pack_number: 0, pick_number: 1, historical_pick_id: 'a', candidates: cards },
    { pack_number: 0, pick_number: 2, historical_pick_id: 'z', candidates: [{ id: 'z', name: 'Z', model_probability: 1 }] },
    { pack_number: 1, pick_number: 0, historical_pick_id: 'a', candidates: cards },
  ] };
  const result = gradeFullPack(replay, ['a', 'b', 'z']);
  assert.equal(result.results.length, 3);
  assert.equal(result.results[2].decisionWeight, 0);
  assert.equal(result.score, 91);
  assert.equal(fullPackDecisionWeight(1), 0);
});

test('newest catalog set is the featured global challenge', () => {
  assert.equal(featuredSetId({ sets: [
    { id: 'old', data_date: '2026-01-01' },
    { id: 'new', data_date: '2026-08-01' },
  ] }), 'new');
});

test('period starts follow Eastern game-day monday and month boundaries', () => {
  const beforeEasternMidnight = new Date('2026-09-07T00:30:00Z');
  assert.equal(periodStart('daily', beforeEasternMidnight), '2026-09-06');
  assert.equal(periodStart('weekly', beforeEasternMidnight), '2026-08-31');
  assert.equal(periodStart('monthly', beforeEasternMidnight), '2026-09-01');
  assert.equal(periodStart('all', beforeEasternMidnight), '1970-01-01');
});
