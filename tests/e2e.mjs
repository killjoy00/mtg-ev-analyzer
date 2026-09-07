import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.PACK1_E2E_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
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

async function home() {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#set-select').waitFor({ timeout: 10000 });
}
async function revealTop3() {
  const cards = page.locator('.opening-pack .card-choice');
  await cards.first().waitFor({ timeout: 10000 });
  await cards.nth(0).click();
  await cards.nth(1).click();
  await cards.nth(2).click();
  await page.locator('#reveal-top3').click();
  const score = page.locator('.result-page .score-orb strong');
  await score.waitFor({ state:'visible', timeout:5000 });
  assert.match((await score.textContent()) || '', /^\d+$/);
  assert.equal(await page.locator('.opening-pack').isVisible(), false);
  return Number(await score.textContent());
}

try {
  for (const setId of ['ecl','tmt','sos','msh']) {
    await home();
    await page.locator('#set-select').selectOption(setId);
    await page.locator('[data-mode="top3"]').click();
    const gameUrl = new URL(page.url());
    assert.equal(gameUrl.searchParams.get('set'), setId);
    assert.ok(gameUrl.searchParams.get('seed'));
    await revealTop3();
  }

  await home();
  await page.locator('#set-select').selectOption('msh');
  await page.locator('[data-mode="top3"]').click();
  const seeded = new URL(page.url());
  await revealTop3();
  seeded.searchParams.set('vs','80');
  seeded.searchParams.set('by','Browser Test');
  await page.goto(seeded.toString(), { waitUntil:'domcontentloaded' });
  await page.locator('.challenge-callout').waitFor({ timeout:10000 });
  assert.match((await page.locator('.challenge-callout').textContent()) || '', /Browser Test scored 80/);
  assert.equal(await page.locator('.friend-comparison').count(), 0);
  await revealTop3();
  await page.locator('.friend-comparison').waitFor({ timeout:5000 });
  await page.locator('.challenge-return').waitFor({ timeout:5000 });

  await home();
  await page.locator('[data-daily-mode="top3"]').click();
  await page.locator('.opening-pack .card-choice').first().waitFor();
  const dailyUrl = new URL(page.url());
  assert.ok(dailyUrl.searchParams.get('daily'));
  assert.equal(dailyUrl.searchParams.get('mode'), 'top3');
  await revealTop3();

  await home();
  await page.locator('#set-select').selectOption('msh');
  await page.locator('[data-mode="full"]').click();
  for (let pick=0; pick<20; pick += 1) {
    if (await page.locator('.scorecard').count()) break;
    await page.locator('.card-choice').first().waitFor({ timeout:10000 });
    await page.locator('.card-choice').first().click();
    await page.locator('#submit-pick').click();
    await page.locator('#next-pick').waitFor({ timeout:5000 });
    await page.locator('#next-pick').click();
  }
  await page.locator('.scorecard.result-page').waitFor({ timeout:10000 });
  assert.match((await page.locator('.scorecard .score-orb strong').textContent()) || '', /^\d+$/);

  await home();
  await page.locator('#stats-nav').click();
  await page.locator('.stats-page').waitFor();
  assert.match((await page.locator('.stats-page h1').textContent()) || '', /Pack 1 record/);
  await page.locator('#account-nav').click();
  await page.locator('.account-page').waitFor();
  assert.ok((await page.locator('#account-signup').count()) + (await page.locator('#account-signout').count()) >= 1);

  console.log('Pack 1 product matrix passed.');
} finally {
  await browser.close();
}
