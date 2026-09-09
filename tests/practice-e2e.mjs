import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.PACK1_E2E_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch(process.env.CI ? { headless: true, channel: 'chrome' } : { headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.route('https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech/**', async (route) => {
  const url = new URL(route.request().url());
  let status = 200;
  let body = { ok: true };
  if (url.pathname === '/v1/session') {
    body = {
      token: 'p1_00000000-0000-4000-8000-000000000000.practice-e2e',
      playerId: '00000000-0000-4000-8000-000000000000',
      displayName: 'Pack Player',
    };
  } else if (url.pathname === '/v1/stats') {
    body = { summary: {}, daily: {}, bySet: [], byMode: [], recent: [] };
  } else if (url.pathname === '/v1/account/session') {
    status = 401;
    body = { error: 'Account session required.' };
  }
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
});

async function openHome() {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#set-select').waitFor({ timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#set-select')?.closest('.mode-section'));
}

try {
  await openHome();

  // Set selection belongs to practice, not the ranked Daily card.
  assert.equal(
    await page.locator('.mode-section #set-select').count(),
    1,
    'Practice set selector must live inside the practice section',
  );
  assert.equal(
    await page.locator('#daily-challenge #set-select').count(),
    0,
    'Daily Challenge must not contain a set selector',
  );

  // The Daily card must actually stack on a phone, not merely avoid horizontal overflow.
  const widths = await page.locator('#daily-challenge').evaluate((card) => {
    const cardBox = card.getBoundingClientRect();
    const copyBox = card.querySelector('.daily-copy')?.getBoundingClientRect();
    const actionsBox = card.querySelector('.daily-actions')?.getBoundingClientRect();
    return { card: cardBox.width, copy: copyBox?.width || 0, actions: actionsBox?.width || 0 };
  });
  assert.ok(widths.copy >= widths.card * 0.75, `Daily copy is still squeezed on mobile: ${JSON.stringify(widths)}`);
  assert.ok(widths.actions >= widths.card * 0.75, `Daily actions are still squeezed on mobile: ${JSON.stringify(widths)}`);

  const catalog = await page.evaluate(async () => {
    const response = await fetch('/data/catalog.json', { cache: 'no-store' });
    return response.json();
  });
  const standards = (catalog.sets || [])
    .filter((set) => set?.id && !set.hide_from_set_picker && set.category !== 'special_mode')
    .sort((a, b) => String(b.data_date || '').localeCompare(String(a.data_date || '')) || String(a.id).localeCompare(String(b.id)));
  assert.ok(standards.length >= 2, 'Practice isolation regression requires at least two standard environments');
  const featured = standards[0].id;
  const practice = standards.find((set) => set.id !== featured).id;

  // Pick a different practice environment, then prove Daily ignores it.
  await page.locator('#set-select').selectOption(practice);
  assert.equal(await page.locator('#set-select').inputValue(), practice);
  await page.locator('[data-daily-mode="top3"]').click();
  await page.locator('.opening-pack .card-choice').first().waitFor({ timeout: 10000 });
  const dailyUrl = new URL(page.url());
  assert.equal(dailyUrl.searchParams.get('set'), featured, 'Daily must always launch the featured environment');
  assert.ok(dailyUrl.searchParams.get('daily'));

  // Set Practice, by contrast, deliberately stays on the chosen set.
  await openHome();
  await page.locator('#set-select').selectOption(practice);
  await page.locator('[data-mode="top3"]').click();
  await page.locator('.opening-pack .card-choice').first().waitFor({ timeout: 10000 });
  const practiceUrl = new URL(page.url());
  assert.equal(practiceUrl.searchParams.get('set'), practice);
  assert.ok(practiceUrl.searchParams.get('seed'));
  assert.equal(practiceUrl.searchParams.has('daily'), false);

  console.log(`Practice isolation passed: featured=${featured}, practice=${practice}`);
} finally {
  await browser.close();
}
