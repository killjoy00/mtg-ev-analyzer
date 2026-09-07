import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.PACK1_E2E_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('[data-mode="top3"]').click();
  await page.locator('.opening-pack .card-choice').first().waitFor();

  const firstThree = page.locator('.opening-pack .card-choice');
  await firstThree.nth(0).click();
  await firstThree.nth(1).click();
  await firstThree.nth(2).click();

  const reveal = page.locator('#reveal-top3');
  await assert.doesNotReject(() => reveal.click());
  await page.locator('.result-page .score-orb strong').waitFor({ state: 'visible', timeout: 5000 });
  assert.match(await page.locator('.result-page .score-orb strong').textContent(), /^\d+$/);
  assert.equal(await page.locator('.opening-pack').isVisible(), false);

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('[data-daily-mode="top3"]').click();
  await page.locator('.opening-pack .card-choice').first().waitFor();
  const dailyUrl = new URL(page.url());
  assert.ok(dailyUrl.searchParams.get('daily'));
  assert.equal(dailyUrl.searchParams.get('mode'), 'top3');

  console.log('Pack 1 E2E reveal flow passed.');
} finally {
  await browser.close();
}
