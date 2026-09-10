import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = 'https://magic.planitnow.us';
const stamp = Date.now();
const errors = [];
const badResponses = [];
await mkdir('artifacts', { recursive:true });
const browser = await chromium.launch({ headless:true, channel:'chrome' });
const context = await browser.newContext({ viewport:{width:390,height:844} });
const page = await context.newPage();
page.setDefaultTimeout(45000);

await page.route(`${base}/**`, async route => {
  const headers = { ...route.request().headers(), 'cache-control':'no-cache', pragma:'no-cache' };
  await route.continue({ headers });
});
page.on('pageerror', e => errors.push(e.message));
page.on('response', r => {
  if (r.status() >= 400) badResponses.push({ status:r.status(), url:r.url() });
});

async function cardsReady() {
  await page.locator('.run-cards').waitFor();
  await page.waitForFunction(() => {
    const imgs=[...document.querySelectorAll('.run-cards img')];
    return imgs.length>0 && imgs.every(i=>i.complete && i.naturalWidth>0);
  });
}

try {
  await page.goto(`${base}/?postdeploy=${stamp}`, {waitUntil:'domcontentloaded'});
  await page.locator('.draft-run-feature').waitFor();
  assert.ok(await page.getByRole('link',{name:'Play today’s Draft Run',exact:true}).isVisible());
  assert.ok(await page.getByRole('button',{name:'Today’s Cube',exact:true}).isVisible());

  await page.goto(`${base}/?game=draft-run&postdeploy=${stamp}-mixed`, {waitUntil:'domcontentloaded'});
  await cardsReady();
  assert.match(await page.locator('.run-heading h1').innerText(), /Pick 1/i);
  assert.equal(await page.locator('.run-pool').count(), 0);
  await page.locator('.run-card-select').first().click();
  await page.locator('#run-lock').click();
  await page.locator('.run-feedback').waitFor();
  await page.locator('#run-next').click();
  await cardsReady();
  assert.match(await page.locator('.run-heading h1').innerText(), /Pick 2/i);
  assert.equal((await page.locator('.run-pool small').innerText()).trim(), '1 card · in pick order');
  await page.screenshot({path:'artifacts/postdeploy-mixed-p1p2.png',fullPage:true});

  await page.goto(`${base}/?game=draft-run&set=powered-cube&postdeploy=${stamp}-cube`, {waitUntil:'domcontentloaded'});
  await cardsReady();
  assert.match(await page.locator('.run-heading h1').innerText(), /Powered Cube[\s\S]*Pick 2/i);
  assert.equal((await page.locator('.run-pool small').innerText()).trim(), '1 card · in pick order');
  assert.equal(await page.locator('[data-reroll="set"]').count(), 0);
  assert.match(await page.locator('[data-reroll="pack"]').innerText(), /New pack\s*·\s*2/);
  await page.screenshot({path:'artifacts/postdeploy-cube-p1p2.png',fullPage:true});

  const applicationFailures = badResponses.filter(x => !x.url.endsWith('/favicon.ico'));
  assert.deepEqual(errors, []);
  assert.deepEqual(applicationFailures, [], `HTTP failures: ${JSON.stringify(applicationFailures)}`);
  console.log('POSTDEPLOY_LIVE_OK', JSON.stringify({ badResponses }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
