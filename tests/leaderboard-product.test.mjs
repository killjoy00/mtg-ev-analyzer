import test from 'node:test';
import assert from 'node:assert/strict';
import { leaderboardPresentation } from '../leaderboard-product.mjs';

test('default leaderboard means featured challenges, not all standard sets', () => {
  const view = leaderboardPresentation('all');
  assert.equal(view.environmentLabel, 'Environment');
  assert.equal(view.allLabel, 'Featured challenges');
  assert.equal(view.modeLabel, 'Full Pack');
  assert.equal(view.cube, false);
});

test('Powered Cube leaderboard has one Cube Pack Run mode', () => {
  const view = leaderboardPresentation('powered-cube');
  assert.equal(view.allLabel, 'Featured challenges');
  assert.equal(view.modeLabel, 'Cube Pack Run');
  assert.equal(view.cube, true);
});
