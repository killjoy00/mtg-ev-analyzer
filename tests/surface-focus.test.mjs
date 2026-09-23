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
  assert.match(result, /Choose username to add score/);
  assert.match(result, /validateDailyRunId:run\.id/);
  assert.match(result, /source:'daily_result'/);
  assert.match(source, /sign in after the run to add this score to the leaderboard/);
  assert.match(source, /This Daily isn’t ranked yet/);
  assert.match(source, /username_taken/);
});

test('Draft Run reveal puts continuation before disclosures and restores result focus', async () => {
  const source = await readFile('draft-run-product.mjs', 'utf8');
  const render = source.slice(source.indexOf('function render()'), source.indexOf('function zoom(card)'));
  const next=render.indexOf('id="run-next"');
  const analysis=render.indexOf('revealAnalysis(p,answer)');
  const pack=render.indexOf('class="run-pack-review"');
  assert.ok(next>=0&&analysis>next&&pack>analysis,'Next pick precedes both reveal disclosures in DOM order');
  assert.match(render,/id="run-feedback-result" tabindex="-1"/);
  assert.match(render,/focus\(\{preventScroll:true\}\)/);
  assert.doesNotMatch(render,/aria-live=/);
  assert.match(source,/function compactRevealCards/);
  assert.match(source,/Trophy and Your Pick/);
  assert.doesNotMatch(source,/compactTrophyThumbnail|run-trophy-thumb/);
  const css = await readFile('draft-run.css', 'utf8');
  assert.match(css, /\.run-reveal-pick\{flex:0 0 108px;width:108px/);
  assert.match(css, /@media\(max-width:600px\)[\s\S]*\.run-reveal-pick\{flex-basis:92px;width:92px\}/);
  assert.match(css, /@media\(min-width:601px\)[\s\S]*\.run-feedback\{flex-wrap:nowrap\}/);
  assert.match(css, /\.run-next-dock #run-next\{white-space:nowrap\}/);
});


test('Draft Run previous-card context stays visible and visually distinct', async () => {
  const source = await readFile('draft-run-product.mjs', 'utf8');
  assert.match(source, /No Previous Cards Selected/);
  assert.match(source, /Already selected by this drafter\./);
  const css = await readFile('draft-run.css', 'utf8');
  assert.match(css, /\.run-pool-empty\{[^}]*background:var\(--surface-soft\)/);
  assert.match(css, /\.run-pool-cards button\{[^}]*background:var\(--surface-soft\)/);
});

test('Draft Run result footnote keeps its muted spacing', async () => {
  const css = await readFile('draft-run.css', 'utf8');
  assert.match(css, /\.run-result-page \.run-note\{color:var\(--muted\);line-height:1\.6;margin:24px 0\}/);
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


test('profile CSS keeps one base rule for previously layered selectors', async () => {
  const css = await readFile('profile.css', 'utf8');
  const base = css.slice(0, css.indexOf('@media'));
  for (const selector of [
    '.profile-hero',
    '.profile-hero-actions',
    '.profile-claim',
    '.profile-section',
    '.profile-scoreboard > div',
    '.environment-progress-card',
    '.achievement-card',
    '.profile-mode-grid',
    '.profile-sparkline',
  ]) {
    assert.equal(base.split(selector + ' {').length - 1, 1, selector + ' should have one base rule');
  }
  assert.doesNotMatch(base, /linear-gradient/);
  assert.match(css, /\.my-membership-card\s*\{[^}]*linear-gradient/,'My Pack One may use the approved membership-card gradient without reintroducing gradients to legacy profile surfaces');
});
