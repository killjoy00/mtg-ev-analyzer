import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.PACK1_E2E_URL || 'http://127.0.0.1:4173';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch(process.env.CI ? { headless: true, channel: 'chrome' } : { headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const capturedEvents = [];

// Exercise the client contract without polluting production analytics/results.
await page.route('https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech/**', async (route) => {
  const url = new URL(route.request().url());
  const path = url.pathname;
  let status = 200;
  let body = { ok: true };
  if (path === '/v1/session') body = { token: 'p1_00000000-0000-4000-8000-000000000000.e2e', playerId: '00000000-0000-4000-8000-000000000000', displayName: 'Pack Player' };
  else if (path === '/v1/stats') body = { summary: { games: 0, average_score: 0, best_score: 0, challenge_wins: 0, challenge_losses: 0, challenge_ties: 0 }, daily: { daily_plays: 0, daily_days: 0, daily_best: 0 }, bySet: [], byMode: [], recent: [] };
  else if (path === '/v1/account/daily-dates') body = { dates: [] };
  else if (path === '/v1/account/session') { status = 401; body = { error: 'Account session required.' }; }
  else if (path === '/v1/events') { const payload = route.request().postDataJSON?.() || {}; capturedEvents.push(...(payload.events || []).map((item) => item.name)); body = { ok: true, accepted: 1 }; }
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
});

async function assertNoHorizontalOverflow() {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `horizontal overflow: ${metrics.scrollWidth}px > ${metrics.clientWidth}px`);
}

async function assertMoreModesFocused() {
  const cards = page.locator('.mode-grid[aria-label="Opening pack practice"] .mode-card');
  assert.equal(await cards.count(), 1, 'More Modes should contain one opening-pack game');
  assert.match((await cards.first().innerText()) || '', /Opening pack[\s\S]*Top 3/i);
  assert.equal(await page.locator('[data-mode="full"]').count(), 0, 'Full Pack must not be offered on More Modes');
  assert.equal(await page.locator('#daily-challenge,[data-daily-mode]').count(), 0, 'Daily opening-pack play must not be offered on More Modes');
}

async function assertPackAligned() {
  const boxes = await page.locator('.opening-pack .card-choice').evaluateAll((nodes) => nodes.slice(0, 7).map((node) => {
    const r = node.getBoundingClientRect();
    return { y: r.y, width: r.width };
  }));
  assert.ok(boxes.length >= 4);
  const width = boxes[0].width;
  const y = boxes[0].y;
  for (const box of boxes) {
    assert.ok(Math.abs(box.width - width) <= 1, 'pack cards must have equal width');
    assert.ok(Math.abs(box.y - y) <= 1, 'first pack row must share a top edge');
  }
}

async function assertPrimaryResultActions(root = '.result-page') {
  const buttons = page.locator(`${root} .result-actions > .button`);
  assert.ok(await buttons.count() >= 2, 'result must offer at least two obvious next actions');
  assert.match((await buttons.nth(0).textContent()) || '', /New pack/i);
  assert.match((await buttons.nth(1).textContent()) || '', /Challenge a friend/i);
  assert.match((await buttons.nth(0).getAttribute('class')) || '', /primary/);
  assert.match((await buttons.nth(1).getAttribute('class')) || '', /primary/);
}

async function home() {
  await page.goto(`${base}/?modes=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('#set-select').waitFor({ timeout: 10000 });
  await page.getByRole('heading', { name: 'Pack One', exact: true }).waitFor({ timeout: 5000 });
  assert.match(await page.locator('[data-home-tab="more"]').getAttribute('class') || '', /active/);

  const catalog = await page.evaluate(async () => {
    const response = await fetch('/data/catalog.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`catalog request failed: ${response.status}`);
    return response.json();
  });
  const cubeEntry = (catalog.sets || []).find((set) => set.id === 'powered-cube');
  if (cubeEntry) {
    await page.waitForFunction(() => ![...document.querySelectorAll('#set-select option')].some((option) => option.value === 'powered-cube'));
    await page.locator('[data-powered-cube-section="1"]').waitFor({ state: 'attached', timeout: 5000 });
    assert.equal(await page.locator('[data-powered-cube-section="1"]').isVisible(), false, 'Powered Cube belongs on the primary home tab');
  }
  assert.equal(await page.locator('[data-draft-run-home="1"]').isVisible(), false, 'Draft Run belongs on the primary home tab');
  const expectedSetIds = (catalog.sets || [])
    .filter((set) => !set.hide_from_set_picker && set.category !== 'special_mode')
    .map((set) => set.id)
    .sort();
  const setIds = (await page.locator('#set-select option').evaluateAll((nodes) => nodes.map((node) => node.value))).sort();
  assert.deepEqual(setIds, expectedSetIds, 'Set picker must contain every standard production set and exclude special modes');
  assert.equal(setIds.includes('powered-cube'), false, 'Powered Cube must never appear as a normal expansion set');
  assert.equal(await page.locator('[data-powered-cube-section="1"]').count(), cubeEntry ? 1 : 0, 'Powered Cube section must remain registered but hidden on More modes');

  const consensusCopy = (await page.locator('.data-note').textContent()) || '';
  assert.match(consensusCopy, /high-win-rate 17Lands drafters/i);
  assert.doesNotMatch(consensusCopy, /not win rates|not win probability|card grades|objective truth/i);
  assert.doesNotMatch((await page.locator('.home-intro').textContent()) || '', /defend it/i);
  assert.equal(await page.getByRole('heading', { name: 'Top 3', exact: true }).count(), 1);
  await assertMoreModesFocused();
  assert.equal(await page.locator('#home-editorial').isVisible(), true, 'editorial shell should be visible on More modes');
  await assertNoHorizontalOverflow();
}

async function revealTop3() {
  const cards = page.locator('.opening-pack .card-choice');
  await cards.first().waitFor({ timeout: 10000 });
  await cards.nth(0).click();
  await cards.nth(1).click();
  await cards.nth(2).click();
  await page.locator('#reveal-top3').click();
  const score = page.locator('.result-page .score-orb strong');
  await score.waitFor({ state: 'visible', timeout: 5000 });
  assert.match((await score.textContent()) || '', /^\d+$/);
  assert.equal(await page.locator('.opening-pack').isVisible(), false);
  assert.match((await page.locator('.score-context').textContent()) || '', /Consensus alignment score/i);
  assert.equal(await page.locator('.top3-result-page .result-picks').isVisible(), false, 'Top 3 result must not list the same user picks twice');
  assert.equal(await page.getByRole('heading', { name: 'Your ranking' }).count(), 1);
  const revealedFooters = await page.locator('.opening-pack .card-footer span').allTextContents();
  assert.ok(revealedFooters.some((text) => /consensus support/i.test(text)), 'reveal should label modeled support directly');
  assert.ok(revealedFooters.every((text) => !/consensus #\d+/i.test(text)), 'reveal must not turn low support into a misleading ordinal rank');
  if (await page.locator('.new-best').count()) {
    const duplicateBest = page.locator('.score-copy > p').filter({ hasText: /^Personal best:/ });
    if (await duplicateBest.count()) assert.equal(await duplicateBest.isVisible(), false, 'new-best result must not repeat the personal best value');
  }
  await assertNoHorizontalOverflow();
  return Number(await score.textContent());
}

async function assertMobileTapScrollStable() {
  await home();
  await page.locator('#set-select').selectOption('msh');
  await page.locator('[data-mode="top3"]').click();
  const card = page.locator('.opening-pack .card-choice').nth(8);
  await card.waitFor({ timeout: 10000 });
  await card.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  const before = await page.evaluate(() => window.scrollY);
  assert.ok(before > 300, `mobile regression needs a deep pack scroll, got ${before}`);
  await card.click();
  await page.waitForTimeout(50);
  const after = await page.evaluate(() => window.scrollY);
  assert.ok(Math.abs(after - before) <= 24, `card tap moved page ${Math.round(after - before)}px (${before} → ${after})`);
}
try {
  // Rendered design checks at desktop and mobile sizes.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/methodology/`, { waitUntil: 'domcontentloaded' });
  await page.locator('.method-directory').waitFor();
  assert.equal(await page.locator('.method-directory a').count(), 3);
  assert.equal(await page.locator('.site-nav-menu').count(), 0);
  assert.equal(await page.locator('.site-brand .brand-mark').count(), 1);

  await page.goto(`${base}/sets/`, { waitUntil: 'domcontentloaded' });
  await page.locator('.set-catalog-card').first().waitFor();
  const standardSets = await page.evaluate(async () => {
    const catalog = await fetch('/data/catalog.json', { cache: 'no-store' }).then((response) => response.json());
    return (catalog.sets || []).filter((entry) => !entry.is_fixture && entry.category !== 'special_mode' && !entry.hide_from_set_picker);
  });
  assert.equal(await page.locator('#set-archive-grid .set-catalog-card').count(), standardSets.length);
  const newest = [...standardSets].sort((a,b) => Date.parse(b.data_date) - Date.parse(a.data_date))[0];
  assert.equal(await page.locator('#set-archive-grid .set-catalog-card').first().getAttribute('data-set-id'), newest.id);
  await page.locator('#set-archive-grid .set-catalog-card').first().getByRole('link', { name:'Practice this set' }).click();
  await page.locator('#set-select').waitFor();
  assert.equal(await page.locator('#set-select').inputValue(), newest.id, 'set archive launches the selected practice environment');

  await home();
  await assertMoreModesFocused();
  await page.screenshot({ path: 'artifacts/ui-home-desktop.png', fullPage: true });
  await page.goto(`${base}/?modes=1&adpreview=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('#set-select').waitFor({ timeout: 10000 });
  await page.locator('.ad-preview-creative').waitFor({ timeout: 5000 });
  await page.screenshot({ path: 'artifacts/ui-monetization-preview-desktop.png', fullPage: true });
  await home();

  await page.locator('#set-select').selectOption('msh');
  await page.locator('[data-mode="top3"]').click();
  await page.locator('.opening-pack .card-choice').first().waitFor({ timeout: 10000 });
  assert.equal(await page.locator('#home-editorial').isVisible(), false, 'editorial/ad inventory must disappear during active play');
  assert.equal(await page.locator('.challenge-callout').count(), 0, 'ordinary game must not look like a friend challenge');
  await assertPackAligned();
  await page.screenshot({ path: 'artifacts/ui-top3-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await home();
  await page.screenshot({ path: 'artifacts/ui-home-mobile.png', fullPage: true });
  await assertMobileTapScrollStable();

  // Representative production sets can start and reveal a Top 3 game.
  for (const setId of ['ecl', 'tmt', 'sos', 'msh']) {
    await home();
    await page.locator('#set-select').selectOption(setId);
    await page.locator('[data-mode="top3"]').click();
    const gameUrl = new URL(page.url());
    assert.equal(gameUrl.searchParams.get('set'), setId);
    assert.ok(gameUrl.searchParams.get('seed'));
    assert.equal(await page.locator('.challenge-callout').count(), 0);
    await revealTop3();
    assert.equal(await page.locator('.friend-comparison').count(), 0, 'ordinary result must not contain friend comparison');
    await assertPrimaryResultActions('.top3-result-page');
    if (setId === 'ecl') await page.screenshot({ path: 'artifacts/ui-result-mobile.png', fullPage: true });
  }

  // Seeded practice remains in practice mode after a game, and New Pack preserves the chosen set.
  await home();
  await page.locator('#set-select').selectOption('sos');
  await page.locator('[data-mode="top3"]').click();
  const practiceUrl = new URL(page.url());
  assert.equal(practiceUrl.searchParams.get('set'), 'sos');
  assert.ok(practiceUrl.searchParams.get('seed'));
  await page.locator('.opening-pack .card-choice').first().waitFor({ timeout: 10000 });
  await revealTop3();
  await page.getByRole('button', { name: /New pack/i }).first().click();
  const nextPracticeUrl = new URL(page.url());
  assert.equal(nextPracticeUrl.searchParams.get('set'), 'sos');
  assert.ok(nextPracticeUrl.searchParams.get('seed'));

  // Leaving seeded practice restores the clean primary home rather than sticking to the seeded URL.
  await page.locator('#brand-home').click();
  await page.locator('[data-draft-run-home="1"]').waitFor({ timeout: 10000 });
  const cleanHomeUrl = new URL(page.url());
  assert.equal(cleanHomeUrl.searchParams.get('seed'), null);
  assert.equal(cleanHomeUrl.searchParams.get('set'), null);
  assert.equal(cleanHomeUrl.searchParams.get('daily'), null);
  assert.equal(cleanHomeUrl.searchParams.get('modes'), null);

  // More Modes stays focused on Top 3; Cube launch URLs remain valid but are surfaced on primary home.
  await home();
  await assertMoreModesFocused();
  if (await page.locator('[data-powered-cube-section="1"]').count()) {
    assert.equal(await page.locator('[data-powered-cube-section="1"]').isVisible(), false);
    const cubeLaunchers = page.locator('[data-powered-cube-section="1"] [data-cube-href]');
    assert.equal(await cubeLaunchers.count(), 2);
    const cubeHrefs = await cubeLaunchers.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-cube-href')));
    assert.ok(cubeHrefs.every((href) => href && new URL(href).searchParams.get('game') === 'draft-run'));
    assert.ok(cubeHrefs.every((href) => href && new URL(href).searchParams.get('set') === 'powered-cube'));
  }

  assert.ok(capturedEvents.length > 0, 'expected at least one analytics event');
  await browser.close();
} catch (error) {
  await browser.close();
  throw error;
}
