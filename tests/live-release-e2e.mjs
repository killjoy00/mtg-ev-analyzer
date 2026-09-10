import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.PACK1_LIVE_URL || 'https://magic.planitnow.us';
const stamp = Date.now();
const mixedWindows = [[1,1],[2,2],[3,3],[3,5],[4,6],[5,7],[5,8],[6,9],[7,10],[8,11]];
const cubeWindows = [[2,2],[3,3],[4,4],[4,6],[5,7],[6,8],[6,9],[7,10],[8,11],[9,12]];
const pageErrors = [];
const consoleErrors = [];
const failedCriticalRequests = [];
const backendStarts = new Map();
const backendTimings = [];
const interactionTimings = [];

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch(process.env.CI ? { headless:true, channel:'chrome' } : { headless:true });
const context = await browser.newContext({
  viewport:{ width:390, height:844 },
  extraHTTPHeaders:{ 'cache-control':'no-cache', pragma:'no-cache' },
});
const page = await context.newPage();
page.setDefaultTimeout(45000);
page.on('pageerror', error => pageErrors.push(error.message));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('request', request => {
  if (request.url().includes('compute.c-5.us-east-2.aws.neon.tech')) backendStarts.set(request, Date.now());
});
page.on('requestfinished', request => {
  if (!backendStarts.has(request)) return;
  backendTimings.push({ method:request.method(), url:new URL(request.url()).pathname, ms:Date.now()-backendStarts.get(request) });
  backendStarts.delete(request);
});
page.on('requestfailed', request => {
  const url = request.url();
  if (url.startsWith(base) || url.includes('compute.c-5.us-east-2.aws.neon.tech')) failedCriticalRequests.push(`${request.method()} ${url} :: ${request.failure()?.errorText || 'failed'}`);
});
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'share', { configurable:true, value:async value => { window.__qaShare = value; } });
  Object.defineProperty(navigator, 'canShare', { configurable:true, value:() => false });
});

async function noOverflow(label) {
  const dims = await page.evaluate(() => ({ client:document.documentElement.clientWidth, scroll:document.documentElement.scrollWidth }));
  assert.ok(dims.scroll <= dims.client + 1, `${label} horizontal overflow: ${dims.scroll} > ${dims.client}`);
}

async function waitForCards() {
  await page.locator('.run-cards').waitFor();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.run-cards img')];
    return images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0);
  }, null, { timeout:45000 });
}

async function setLabel() {
  return page.locator('.run-heading h1').evaluate(node => String(node.childNodes[0]?.textContent || '').trim());
}

async function pickNumber() {
  const text = await page.locator('.run-heading h1').innerText();
  const match = text.match(/Pick\s+(\d+)/i);
  assert.ok(match, `missing pick number in heading: ${text}`);
  return Number(match[1]);
}

async function timed(name, action, waitFor) {
  const started = Date.now();
  await action();
  await waitFor();
  const ms = Date.now() - started;
  interactionTimings.push({ name, ms });
  return ms;
}

async function finishRun({ cube=false }) {
  const environment = cube ? 'powered-cube' : 'mixed';
  const url = `${base}/?game=draft-run${cube?'&set=powered-cube':''}&qa=${stamp}-${environment}`;
  const started = Date.now();
  await page.goto(url, { waitUntil:'domcontentloaded' });
  await waitForCards();
  interactionTimings.push({ name:`${environment}-practice-load`, ms:Date.now()-started });
  assert.match(await page.locator('.run-heading .eyebrow').innerText(), /Practice/);
  assert.doesNotMatch(await page.locator('.run-heading .eyebrow').innerText(), /Daily/);
  await noOverflow(`${environment} initial`);

  if (cube) {
    assert.equal(await setLabel(), 'Powered Cube');
    assert.equal(await pickNumber(), 2);
    assert.equal(await page.locator('[data-reroll="set"]').count(), 0, 'Cube must not expose a set reroll');
    assert.match(await page.locator('[data-reroll="pack"]').innerText(), /New pack\s*·\s*2/);
    await timed('cube-pack-reroll-1', () => page.locator('[data-reroll="pack"]').click(), () => page.getByRole('button',{name:'New pack · 1', exact:true}).waitFor());
    assert.equal(await setLabel(), 'Powered Cube');
    await timed('cube-pack-reroll-2', () => page.locator('[data-reroll="pack"]').click(), () => page.getByRole('button',{name:'New pack · 0', exact:true}).waitFor());
    assert.equal(await setLabel(), 'Powered Cube');
  } else {
    assert.equal(await pickNumber(), 1);
    const before = await setLabel();
    await timed('mixed-set-reroll', () => page.locator('[data-reroll="set"]').click(), () => page.getByRole('button',{name:'New set · 0', exact:true}).waitFor());
    const after = await setLabel();
    assert.notEqual(after, before, 'mixed set reroll must change expansion');
    await timed('mixed-pack-reroll', () => page.locator('[data-reroll="pack"]').click(), () => page.getByRole('button',{name:'New pack · 0', exact:true}).waitFor());
    assert.equal(await setLabel(), after, 'same-set pack reroll must preserve expansion');
  }

  const windows = cube ? cubeWindows : mixedWindows;
  const seenPicks = [];
  for (let round=0; round<10; round++) {
    await waitForCards();
    const pick = await pickNumber();
    seenPicks.push(pick);
    const [min,max] = windows[round];
    assert.ok(pick >= min && pick <= max, `${environment} round ${round+1} pick ${pick} outside ${min}-${max}`);
    assert.equal(await page.locator('.run-pool-cards>button').count(), pick-1, `${environment} prior-card context mismatch at round ${round+1}`);
    if (cube) assert.equal(await setLabel(), 'Powered Cube', `Cube leaked to another environment at round ${round+1}`);
    await noOverflow(`${environment} round ${round+1}`);

    await page.locator('.run-card-select').first().click();
    await timed(`${environment}-pick-${round+1}`, () => page.locator('#run-lock').click(), () => page.locator('.run-feedback').waitFor());
    const feedback = await page.locator('.run-feedback').innerText();
    assert.match(feedback, /\/100/);
    assert.match(feedback, /trophy drafter/i);
    await page.locator('#run-next').click();
    if (round < 9) await page.locator('.run-cards').waitFor();
    else await page.locator('.run-result-page').waitFor();
  }

  if (!cube) {
    assert.equal(seenPicks[0], 1);
    assert.equal(seenPicks[1], 2);
  } else {
    assert.equal(seenPicks[0], 2);
    assert.equal(seenPicks[1], 3);
  }
  assert.equal(await page.locator('.run-review-list li').count(), 10, `${environment} result must review all ten decisions`);
  const scoreText = await page.locator('.run-final-score strong').innerText();
  const score = Number(scoreText);
  assert.ok(Number.isFinite(score) && score >= 0 && score <= 100, `invalid ${environment} final score ${scoreText}`);
  await noOverflow(`${environment} result`);
  await page.screenshot({ path:`artifacts/live-${cube?'cube':'mixed'}-result-mobile.png`, fullPage:true });

  await page.locator('#run-challenge').click();
  await page.waitForFunction(() => Boolean(window.__qaShare?.url));
  const shareUrl = await page.evaluate(() => window.__qaShare.url);
  assert.match(shareUrl, /challenge=/);
  assert.doesNotMatch(shareUrl, /token|profile=/i);
  await page.goto(shareUrl, { waitUntil:'domcontentloaded' });
  await page.locator('#accept-run-challenge').waitFor();
  assert.match(await page.locator('.run-invite').innerText(), /Can you beat/i);
  await noOverflow(`${environment} friend landing`);
  await page.screenshot({ path:`artifacts/live-${cube?'cube':'mixed'}-invite-mobile.png`, fullPage:true });

  await page.goto(`${base}/?game=draft-run&board=daily${cube?'&set=powered-cube':''}&qa=${stamp}-board-${environment}`, { waitUntil:'domcontentloaded' });
  await page.locator('.run-board').waitFor();
  await noOverflow(`${environment} leaderboard`);
  return { score, seenPicks };
}

try {
  const homeStarted = Date.now();
  await page.goto(`${base}/?qa=${stamp}`, { waitUntil:'domcontentloaded' });
  await page.locator('.draft-run-feature').waitFor();
  interactionTimings.push({ name:'homepage-load', ms:Date.now()-homeStarted });
  assert.ok(await page.getByRole('link',{name:'Play today’s Draft Run', exact:true}).isVisible(), 'new Draft Run homepage entry missing');
  assert.ok(await page.getByRole('button',{name:'Today’s Cube', exact:true}).isVisible(), 'ten-decision Cube homepage entry missing');
  assert.equal(await page.locator('.cube-mode-section #set-select').count(), 0, 'Cube homepage must not expose an expansion selector');
  assert.doesNotMatch(await page.locator('body').innerText(), /14[- ]decision|14 decisions/i, 'stale Cube copy is still live');
  await noOverflow('homepage');
  await page.screenshot({ path:'artifacts/live-home-mobile.png', fullPage:true });

  const mixed = await finishRun({ cube:false });
  const cube = await finishRun({ cube:true });

  await page.goto(`${base}/?qa=${stamp}-profile`, { waitUntil:'domcontentloaded' });
  await page.locator('#profile-nav').waitFor();
  await page.locator('#profile-nav').click();
  await page.locator('.player-profile-page').waitFor();
  const games = Number((await page.locator('.profile-scoreboard > div').first().locator('strong').innerText()).trim());
  assert.ok(games >= 2, `career did not retain both live practice results; games=${games}`);
  assert.match(await page.locator('.profile-mode-grid').innerText(), /Draft Run/i);
  assert.ok(await page.locator('#profile-claim-account').isVisible(), 'guest profile should offer account save without publishing profile');
  await noOverflow('profile');
  await page.screenshot({ path:'artifacts/live-profile-mobile.png', fullPage:true });

  await page.locator('#profile-claim-account').click();
  await page.locator('#account-signin').waitFor();
  assert.ok(await page.locator('#account-signin').isVisible(), 'account sign-in UI did not open from profile');
  await noOverflow('account');
  await page.screenshot({ path:'artifacts/live-account-mobile.png', fullPage:true });

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
  assert.deepEqual(failedCriticalRequests, [], `critical request failures: ${failedCriticalRequests.join(' | ')}`);
  if (consoleErrors.length) console.log('Non-fatal console errors observed:', consoleErrors);
  console.log('LIVE_RELEASE_RESULT', JSON.stringify({ mixed, cube, interactionTimings, backendTimings, consoleErrors }, null, 2));
  console.log('Live release verification passed: homepage, mixed practice, Cube practice, both reroll models, 20 real picks, ten-row results, sharing/friend landing, leaderboards, career persistence, account UI, images and mobile overflow.');
} finally {
  await context.close();
  await browser.close();
}
