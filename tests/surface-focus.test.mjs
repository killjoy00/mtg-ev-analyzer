import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('More Modes offers Top 3 and Full Pack practice without Daily', async () => {
  const source = await readFile('app.js', 'utf8');
  const home = source.slice(source.indexOf('function renderHome()'), source.indexOf('async function startMode'));
  assert.match(home, /Opening pack/);
  assert.match(home, /Top 3/);
  assert.match(home, /data-mode="full"/);
  assert.match(home, /Full Pack/);
  assert.doesNotMatch(home, /daily-challenge|data-daily-mode/);
});

test('the visible leaderboard offers only Draft Run and Cube boards', async () => {
  const source = await readFile('draft-run-product.mjs', 'utf8');
  const board = source.slice(source.indexOf('async function showBoard'), source.indexOf('async function launch'));
  assert.match(board, /Leaderboard game/);
  assert.match(board, />Draft Run</);
  assert.match(board, />Cube</);
  assert.doesNotMatch(board, /legacy-board|Full Pack/);
});