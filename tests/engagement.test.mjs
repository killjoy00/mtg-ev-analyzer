import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeIndex, computeStreak, gameDateKey, previousGameDateKey, unlockedMilestones } from '../engagement.mjs';

test('challengeIndex is stable and bounded', () => {
  const a = challengeIndex('2026-09-06', 'msh', 'top3', 300);
  const b = challengeIndex('2026-09-06', 'msh', 'top3', 300);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 300);
  assert.notEqual(a, challengeIndex('2026-09-06', 'msh', 'full', 300));
});

test('Daily selector never repeats the previous day when multiple replays exist', () => {
  let previous = challengeIndex('2026-09-01', 'msh', 'top3', 2);
  for (let day = 2; day <= 9; day += 1) {
    const key = `2026-09-0${day}`;
    const current = challengeIndex(key, 'msh', 'top3', 2);
    assert.notEqual(current, previous, `${key} repeated the prior replay`);
    previous = current;
  }
});

test('Daily game day resets at midnight Eastern instead of UTC', () => {
  assert.equal(gameDateKey(new Date('2026-09-07T00:30:00Z')), '2026-09-06');
  assert.equal(gameDateKey(new Date('2026-09-07T04:30:00Z')), '2026-09-07');
  assert.equal(previousGameDateKey('2026-03-01'), '2026-02-28');
});

test('computeStreak counts today and consecutive prior days', () => {
  assert.equal(computeStreak(['2026-09-04', '2026-09-05', '2026-09-06'], '2026-09-06'), 3);
  assert.equal(computeStreak(['2026-09-03', '2026-09-05'], '2026-09-06'), 1);
  assert.equal(computeStreak(['2026-09-04', '2026-09-05'], '2026-09-06'), 2);
});

test('milestones reward streaks, volume, perfects, and double headers', () => {
  const completedRuns = [
    { date: '2026-09-05', mode: 'top3' },
    { date: '2026-09-06', mode: 'top3' },
    { date: '2026-09-06', mode: 'full' },
    ...Array.from({ length: 7 }, (_, index) => ({ date: `2026-08-${20 + index}`, mode: 'top3' })),
  ];
  const ids = unlockedMilestones({ completedRuns, streak: 7, bestScore: 100 }).map((item) => item.id);
  assert.ok(ids.includes('first'));
  assert.ok(ids.includes('perfect'));
  assert.ok(ids.includes('streak7'));
  assert.ok(ids.includes('ten'));
  assert.ok(ids.includes('double'));
});
