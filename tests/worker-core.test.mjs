import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeIndex, featuredSetId, gameDateKey, periodStart } from '../worker/core.mjs';

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

test('worker Daily game day resets at midnight Pacific', () => {
  assert.equal(gameDateKey(new Date('2026-09-07T00:30:00Z')), '2026-09-06');
  assert.equal(gameDateKey(new Date('2026-09-07T07:30:00Z')), '2026-09-07');
});

test('newest catalog set is the featured global challenge', () => {
  assert.equal(featuredSetId({ sets: [
    { id: 'old', data_date: '2026-01-01' },
    { id: 'new', data_date: '2026-08-01' },
  ] }), 'new');
});

test('period starts follow Pacific game-day monday and month boundaries', () => {
  const beforePacificMidnight = new Date('2026-09-07T00:30:00Z');
  assert.equal(periodStart('daily', beforePacificMidnight), '2026-09-06');
  assert.equal(periodStart('weekly', beforePacificMidnight), '2026-08-31');
  assert.equal(periodStart('monthly', beforePacificMidnight), '2026-09-01');
  assert.equal(periodStart('all', beforePacificMidnight), '1970-01-01');
});
