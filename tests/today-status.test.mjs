import test from 'node:test';
import assert from 'node:assert/strict';

import { gameDateKey, todayStatus } from '../today-status.mjs';

test('Today uses the same Pacific calendar boundary as ranked Dailies', () => {
  assert.equal(gameDateKey(new Date('2026-09-14T06:59:59Z')), '2026-09-13');
  assert.equal(gameDateKey(new Date('2026-09-14T07:00:00Z')), '2026-09-14');
});

test('Today summarizes Draft Run and Cube independently without starting a run', () => {
  const profile = {
    summary: { current_streak: 4 },
    daily_history: [
      { date:'2026-09-13', mode:'draft_run', set_id:'mixed', score:84, rank:3, total:18, percentile:17 },
      { date:'2026-09-12', mode:'draft_run', set_id:'powered-cube', score:76, rank:4, total:12, percentile:34 },
    ],
  };
  const status = todayStatus(profile, '2026-09-13');
  assert.equal(status.completed, 1);
  assert.equal(status.streak, 4);
  assert.deepEqual(status.draftRun, { complete:true, score:84, rank:3, total:18, percentile:17 });
  assert.deepEqual(status.cube, { complete:false, score:null, rank:null, total:null, percentile:null });
});
