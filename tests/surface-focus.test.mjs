import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('retired game entrypoint cannot offer new Top 3 or Full Pack games', async () => {
  const source = await readFile('app.js', 'utf8');
  const home = source.slice(source.indexOf('function renderHome()'), source.indexOf('async function startMode'));
  assert.match(home, /location.replace/);
  assert.doesNotMatch(home, /data-mode|More modes|New Top 3|New Full Pack/);
  const reader = await readFile('historical-share.mjs', 'utf8');
  assert.match(reader, /social.mjs/);
  assert.doesNotMatch(reader, /practice-product|home-product|app.js/);
});

test('the visible leaderboard offers only Draft Run and Cube boards', async () => {
  const source = await readFile('draft-run-product.mjs', 'utf8');
  const board = source.slice(source.indexOf('async function showBoard'), source.indexOf('async function launch'));
  assert.match(board, /Leaderboard game/);
  assert.match(board, />Draft Run</);
  assert.match(board, />Cube</);
  assert.doesNotMatch(board, /legacy-board|Full Pack/);
});