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

test('guest Daily results offer score validation instead of a career action', async () => {
  const source = await readFile('draft-run-product.mjs', 'utf8');
  const result = source.slice(source.indexOf('function renderResult()'), source.indexOf('async function shareResult'));
  assert.match(result, /Sign in to add score/);
  assert.match(result, /validateDailyRunId:run\.id/);
  assert.match(source, /sign in after the run to add this score to the leaderboard/);
});

test('desktop reveal keeps Next pick in the top action row', async () => {
  const css = await readFile('draft-run.css', 'utf8');
  assert.match(css, /@media\(min-width:601px\)[\s\S]*\.run-feedback>\.run-next-dock\{grid-column:3;grid-row:1/);
});


test('mobile reveal keeps Next pick in a bottom safe-area dock', async () => {
  const css = await readFile('draft-run.css', 'utf8');
  assert.match(css, /\.draft-run-page:has\(\.run-next-dock\)\{padding-bottom:calc\(72px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.run-next-dock\{position:fixed;z-index:40;left:0;right:0;bottom:0/);
  assert.match(css, /\.run-next-dock #run-next\{width:100%\}/);
});


test('Draft Run repeats preserve the practice context', async () => {
  const source = await readFile('draft-run-product.mjs', 'utf8');
  assert.match(source, /run\.custom_set_ids\?\.length[\s\S]*\?game=draft-run&custom=1[\s\S]*Choose Sets for Another Run/);
  assert.match(source, /label:\`Start Another \$\{title\(\)\}\`/);
});

test('secondary gameplay controls keep mobile-sized targets', async () => {
  const css = await readFile('draft-run.css', 'utf8');
  assert.match(css, /body \.run-zoom\{[^}]*min-height:44px/);
  assert.match(css, /\.run-lock \.run-tools \.button\{min-height:44px/);
});
