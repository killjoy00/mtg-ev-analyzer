import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeIndex, featuredSetId, gradeFullPack, gradeTopThree, periodStart } from '../worker/core.mjs';

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
  assert.notEqual(a, challengeIndex('2026-09-07', 'msh', 'top3', 300));
});

test('worker top-three grading matches app weights', () => {
  const perfect = gradeTopThree(cards, ['a', 'b', 'c'], 'a');
  assert.equal(perfect.score, 100);
  assert.equal(perfect.grade, 'A+');
  const scrambled = gradeTopThree(cards, ['c', 'b', 'a'], 'a');
  assert.equal(scrambled.score, 83);
});

test('full pack score averages pick support ratios', () => {
  const replay = { picks: [
    { pack_number: 0, pick_number: 0, historical_pick_id: 'a', candidates: cards },
    { pack_number: 0, pick_number: 1, historical_pick_id: 'a', candidates: cards },
    { pack_number: 1, pick_number: 0, historical_pick_id: 'a', candidates: cards },
  ] };
  const result = gradeFullPack(replay, ['a', 'b']);
  assert.equal(result.results.length, 2);
  assert.equal(result.score, 88);
});

test('newest catalog set is the featured global challenge', () => {
  assert.equal(featuredSetId({ sets: [
    { id: 'old', data_date: '2026-01-01' },
    { id: 'new', data_date: '2026-08-01' },
  ] }), 'new');
});

test('period starts use UTC monday and month boundaries', () => {
  const date = new Date('2026-09-06T23:00:00Z');
  assert.equal(periodStart('daily', date), '2026-09-06');
  assert.equal(periodStart('weekly', date), '2026-08-31');
  assert.equal(periodStart('monthly', date), '2026-09-01');
  assert.equal(periodStart('all', date), '1970-01-01');
});
