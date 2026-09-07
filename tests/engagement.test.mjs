import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeIndex, computeStreak, previousUtcDateKey, unlockedMilestones, utcDateKey } from '../engagement.mjs';

test('challengeIndex is stable and bounded', () => {
  const a = challengeIndex('2026-09-06', 'msh', 'top3', 300);
  const b = challengeIndex('2026-09-06', 'msh', 'top3', 300);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 300);
  assert.notEqual(a, challengeIndex('2026-09-06', 'msh', 'full', 300));
});

test('UTC date helpers step back cleanly', () => {
  assert.equal(utcDateKey(new Date('2026-09-06T23:00:00Z')), '2026-09-06');
  assert.equal(previousUtcDateKey('2026-03-01'), '2026-02-28');
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
