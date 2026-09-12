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
  await page.goto(`${base}/?modes=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('#set-select').waitFor({ timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#set-select')?.closest('.mode-section'));
  assert.match(await page.locator('[data-home-tab="more"]').getAttribute('class') || '', /active/);
}

try {
  await openHome();

  // More Modes keeps both opening-pack practice modes and no Daily pack.
  assert.equal(
    await page.locator('.mode-section #set-select').count(),
    1,
    'Practice set selector must live inside the practice section',
  );
  assert.equal(await page.locator('.mode-card').count(), 2);
  const modeCopy = await page.locator('.mode-card').allTextContents();
  assert.ok(modeCopy.some((text) => /Opening pack[\s\S]*Top 3/i.test(text)));
  assert.ok(modeCopy.some((text) => /Full first pack[\s\S]*Full Pack/i.test(text)));
  assert.equal(await page.locator('[data-mode="full"]').count(), 1);
  assert.equal(await page.locator('#daily-challenge,[data-daily-mode]').count(), 0);

  const catalog = await page.evaluate(async () => {
    const response = await fetch('/data/catalog.json', { cache: 'no-store' });
    return response.json();
  });
  const standards = (catalog.sets || [])
    .filter((set) => set?.id && !set.hide_from_set_picker && set.category !== 'special_mode')
    .sort((a, b) => String(b.data_date || '').localeCompare(String(a.data_date || '')) || String(a.id).localeCompare(String(b.id)));
  assert.ok(standards.length >= 2, 'Practice isolation regression requires at least two standard environments');
  const practice = standards[1].id;

  // Top 3 practice deliberately stays on the chosen set.
  await page.locator('#set-select').selectOption(practice);
  await page.locator('[data-mode="top3"]').click();
  await page.locator('.opening-pack .card-choice').first().waitFor({ timeout: 10000 });
  const practiceUrl = new URL(page.url());
  assert.equal(practiceUrl.searchParams.get('set'), practice);
  assert.equal(practiceUrl.searchParams.get('mode'), 'top3');
  assert.ok(practiceUrl.searchParams.get('seed'));
  assert.equal(practiceUrl.searchParams.has('daily'), false);

  // Full Pack practice uses the same set picker and must remain available.
  await openHome();
  await page.locator('#set-select').selectOption(practice);
  await page.locator('[data-mode="full"]').click();
  await page.locator('.full-pack-layout .card-choice').first().waitFor({ timeout: 10000 });
  const fullUrl = new URL(page.url());
  assert.equal(fullUrl.searchParams.get('set'), practice);
  assert.equal(fullUrl.searchParams.get('mode'), 'full');
  assert.ok(fullUrl.searchParams.get('seed'));
  assert.equal(fullUrl.searchParams.has('daily'), false);

  console.log(`Opening-pack practice passed: set=${practice}, modes=top3/full`);
} finally {
  await browser.close();
}