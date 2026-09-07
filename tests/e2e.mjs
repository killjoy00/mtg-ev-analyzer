import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.PACK1_E2E_URL || 'http://127.0.0.1:4173';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch(process.env.CI ? { headless: true, channel: 'chrome' } : { headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

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
  else if (path === '/v1/events') body = { ok: true, accepted: 1 };
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
});

async function assertNoHorizontalOverflow() {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `horizontal overflow: ${metrics.scrollWidth}px > ${metrics.clientWidth}px`);
}

async function assertModeCardsAligned() {
  const boxes = await page.locator('.mode-card').evaluateAll((nodes) => nodes.slice(0, 2).map((node) => {
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  assert.equal(boxes.length, 2);
  assert.ok(Math.abs(boxes[0].y - boxes[1].y) <= 1, 'mode cards must share a top edge');
  assert.ok(Math.abs(boxes[0].height - boxes[1].height) <= 1, 'mode cards must have equal height');
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

async function home() {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#set-select').waitFor({ timeout: 10000 });
  await page.getByRole('heading', { name: 'Pack One', exact: true }).waitFor({ timeout: 5000 });
  const setOrder = await page.locator('#set-select option').evaluateAll((nodes) => nodes.map((node) => node.value));
  assert.deepEqual(setOrder.slice(0, 4), ['msh', 'sos', 'tmt', 'ecl']);
  const consensusCopy = (await page.locator('.data-note').textContent()) || '';
  assert.match(consensusCopy, /high-win-rate 17Lands drafters/i);
  assert.match(consensusCopy, /not win rates/i);
  assert.doesNotMatch((await page.locator('.home-intro').textContent()) || '', /defend it/i);
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
  await home();
  await assertModeCardsAligned();
  await page.screenshot({ path: 'artifacts/ui-home-desktop.png', fullPage: true });

  await page.locator('#set-select').selectOption('msh');
  await page.locator('[data-mode="top3"]').click();
  await page.locator('.opening-pack .card-choice').first().waitFor({ timeout: 10000 });
  assert.equal(await page.locator('.challenge-callout').count(), 0, 'ordinary game must not look like a friend challenge');
  await assertPackAligned();
  await page.screenshot({ path: 'artifacts/ui-top3-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await home();
  await page.screenshot({ path: 'artifacts/ui-home-mobile.png', fullPage: true });
  await assertMobileTapScrollStable();

  // Every production set can start and reveal a Top 3 game.
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
    if (setId === 'ecl') await page.screenshot({ path: 'artifacts/ui-result-mobile.png', fullPage: true });
  }

  // Seeded friend challenges carry the exact pack and compare only after reveal.
  await home();
  await page.locator('#set-select').selectOption('msh');
  await page.locator('[data-mode="top3"]').click();
  const seeded = new URL(page.url());
  await revealTop3();
  seeded.searchParams.set('vs', '80');
  seeded.searchParams.set('by', 'Browser Test');
  await page.goto(seeded.toString(), { waitUntil: 'domcontentloaded' });
  await page.locator('.challenge-callout').waitFor({ timeout: 10000 });
  assert.match((await page.locator('.challenge-callout').textContent()) || '', /Browser Test scored 80/);
  assert.equal(await page.locator('.friend-comparison').count(), 0);
  await assertNoHorizontalOverflow();
  await page.screenshot({ path: 'artifacts/ui-challenge-mobile.png', fullPage: true });
  await revealTop3();
  await page.locator('.friend-comparison').waitFor({ timeout: 5000 });
  await page.locator('.challenge-return').waitFor({ timeout: 5000 });
  await assertNoHorizontalOverflow();

  // Daily remains a dated ranked path and Reveal reaches its result page.
  await home();
  await page.locator('[data-daily-mode="top3"]').click();
  await page.locator('.opening-pack .card-choice').first().waitFor();
  const dailyUrl = new URL(page.url());
  assert.ok(dailyUrl.searchParams.get('daily'));
  assert.equal(dailyUrl.searchParams.get('mode'), 'top3');
  await revealTop3();

  // Full Pack can complete all first-pack decisions and reach its summary.
  await home();
  await page.locator('#set-select').selectOption('msh');
  await page.locator('[data-mode="full"]').click();
  for (let pick = 0; pick < 20; pick += 1) {
    if (await page.locator('.scorecard').count()) break;
    await page.locator('.card-choice').first().waitFor({ timeout: 10000 });
    await page.locator('.card-choice').first().click();
    await page.locator('#submit-pick').click();
    await page.locator('#next-pick').waitFor({ timeout: 5000 });
    await page.locator('#next-pick').click();
  }
  await page.locator('.scorecard.result-page').waitFor({ timeout: 10000 });
  assert.match((await page.locator('.scorecard .score-orb strong').textContent()) || '', /^\d+$/);
  await assertNoHorizontalOverflow();

  // Stats and Account are styled and reachable without an account.
  await home();
  await page.locator('#stats-nav').click();
  await page.locator('.stats-page').waitFor();
  assert.match((await page.locator('.stats-page h1').textContent()) || '', /Pack One record/);
  await assertNoHorizontalOverflow();
  await page.screenshot({ path: 'artifacts/ui-stats-mobile.png', fullPage: true });
  await page.locator('#account-nav').click();
  await page.locator('.account-page').waitFor();
  assert.ok((await page.locator('#account-signup').count()) + (await page.locator('#account-signout').count()) >= 1);
  await assertNoHorizontalOverflow();
  await page.screenshot({ path: 'artifacts/ui-account-mobile.png', fullPage: true });

  console.log('Pack One product and layout matrix passed.');
} finally {
  await browser.close();
}
