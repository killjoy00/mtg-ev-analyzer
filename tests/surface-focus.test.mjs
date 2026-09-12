import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('More Modes only offers opening-pack Top 3 practice', async () => {
  const source = await readFile('app.js', 'utf8');
  const home = source.slice(source.indexOf('function renderHome()'), source.indexOf('async function startMode'));
  assert.match(home, /Opening pack/);
  assert.match(home, /Top 3/);
  assert.doesNotMatch(home, /daily-challenge|data-daily-mode|data-mode="full"|Full Pack/);
});

test('the visible leaderboard offers only Draft Run and Cube boards', async () => {
  const source = await readFile('draft-run-product.mjs', 'utf8');
  const board = source.slice(source.indexOf('async function showBoard'), source.indexOf('async function launch'));
  assert.match(board, /Leaderboard game/);
  assert.match(board, />Draft Run</);
  assert.match(board, />Cube</);
  assert.doesNotMatch(board, /legacy-board|Full Pack/);
});
