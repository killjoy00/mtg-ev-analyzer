import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.PACK1_E2E_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch(process.env.CI ? { headless: true, channel: 'chrome' } : { headless: true });
await mkdir('artifacts', { recursive: true });

async function fixture({ account = 'signed-in', membership = 'free', holdAccount = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (account !== 'guest') await context.addInitScript(() => localStorage.setItem('pack1-auth-session-v1', 'practice-hub-auth'));
  const page = await context.newPage(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = { account, membership };
  let releaseAccount = () => {};
  const accountGate = holdAccount ? new Promise(resolve => releaseAccount = resolve) : Promise.resolve();
  await page.route('**/*.neon.tech/**', async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push({ method: route.request().method(), path });
    let body = { ok: true }, status = 200;
    if (path === '/v1/account/session') {
      await accountGate;
      if (state.account === 'failure') { status = 503; body = { error: 'Account unavailable' }; }
      else if (state.account === 'expired') { status = 401; body = { error: 'Expired session' }; }
      else body = { user: { id: 'practice-user', name: 'Practice Player' } };
    } else if (path === '/v1/patreon/status') {
      if (state.membership === 'failure') { status = 503; body = { error: 'Membership unavailable' }; }
      else {
        const caps = ['custom_corpus', 'unlimited_cube_practice'];
        body = {
          configured: true, connected: state.membership === 'elite',
          capabilities: state.membership === 'elite' ? caps : [],
          account_capabilities: ['apple', 'grant'].includes(state.membership) ? caps : [],
          apple_subscription_active: state.membership === 'apple',
        };
      }
    } else if (path === '/v1/session') body = { token: 'practice-browser' };
    else if (path === '/v1/daily-status') body = { player: { claimed: false }, daily_history: [] };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { context, page, errors, requests, state, releaseAccount };
}

async function cards(page, unlocked) {
  assert.equal(await page.locator('.practice-card').count(), 3, 'all three modes remain visible');
  assert.equal(await page.locator('.practice-card:not(.is-locked)').count(), unlocked);
  assert.equal(await page.getByRole('heading', { name: 'Regular Draft Run', exact: true }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: 'Powered Cube', exact: true }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: 'Choose your sets', exact: true }).count(), 1);
}

async function responsive(page, label) {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
      actions: [...document.querySelectorAll('.practice-card-action')].map(container => {
        const box = container.getBoundingClientRect(), button = container.firstElementChild.getBoundingClientRect();
        return { width: box.width, buttonWidth: button.width, height: button.height };
      }),
    }));
    assert.ok(metrics.scroll <= metrics.client + 1, `${label} overflow at ${width}`);
    for (const action of metrics.actions) {
      assert.ok(Math.abs(action.width - action.buttonWidth) < 1, `${label} action must fill its card at ${width}`);
      assert.ok(action.height >= 48, `${label} action is too short at ${width}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `artifacts/practice-hub-${label}-mobile.png`, fullPage: true });
}

try {
  // Static HTML is useful before JavaScript or account services are ready.
  const staticContext = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await staticContext.newPage();
  await staticPage.goto(base + '/practice/');
  await cards(staticPage, 0);
  assert.equal(await staticPage.locator('.practice-card-action button:disabled').count(), 3);
  await staticContext.close();

  // Guests can discover Practice from both app and editorial navigation, but
  // locked cards lead to authentication or the Elite flow without starting a run.
  const guest = await fixture({ account: 'guest' });
  await guest.page.goto(base);
  await guest.page.locator('#account-nav[data-account-state="signed-out"]').waitFor();
  assert.deepEqual(await guest.page.locator('.top-actions .top-nav-button:visible').allTextContents(), ['Daily Run', 'Practice', 'How To Play', 'Sign in']);
  await guest.page.locator('#practice-nav').click();
  await guest.page.locator('[data-account-state="guest"][data-practice-hub]').waitFor();
  await cards(guest.page, 0);
  assert.equal(await guest.page.getByRole('link', { name: 'Sign in to practice', exact: true }).count(), 1);
  assert.equal(await guest.page.getByRole('button', { name: 'Become Elite to Play', exact: true }).count(), 2);
  assert.equal(await guest.page.locator('.practice-card-action a:not([href="/?account=1"])').count(), 0);
  assert.equal(await guest.page.locator('[data-nav="practice"]').getAttribute('aria-current'), 'page');
  assert.deepEqual(await guest.page.locator('.top-actions .top-nav-button:visible').allTextContents(), ['Daily Run', 'Practice', 'How To Play', 'Sign in']);
  await responsive(guest.page, 'guest');
  await guest.page.goto(base + '/about/');
  await guest.page.getByRole('link', { name: 'Practice', exact: true }).click();
  await guest.page.locator('[data-practice-hub][data-account-state="guest"]').waitFor();
  await guest.page.getByRole('button', { name: 'Become Elite to Play', exact: true }).first().click();
  await guest.page.getByRole('heading', { name: 'Unlock Elite practice.', exact: true }).waitFor();
  assert.equal(guest.requests.some(r => r.method === 'POST' && r.path === '/v1/runs'), false);
  assert.deepEqual(guest.errors, []);
  await guest.context.close();

  const free = await fixture();
  await free.page.goto(base + '/practice/');
  await free.page.getByRole('link', { name: 'Start Draft Run', exact: true }).waitFor();
  await cards(free.page, 1);
  assert.equal(await free.page.getByRole('link', { name: 'Start Draft Run', exact: true }).getAttribute('href'), '/?game=draft-run');
  assert.equal(await free.page.getByRole('button', { name: 'Become Elite to Play', exact: true }).count(), 2);
  await responsive(free.page, 'free');
  await free.page.getByRole('button', { name: 'Become Elite to Play', exact: true }).last().click();
  await free.page.waitForURL(base + '/patreon/');
  assert.equal(free.requests.some(r => r.method === 'POST' && r.path === '/v1/runs'), false);
  assert.deepEqual(free.errors, []);
  await free.context.close();

  for (const membership of ['elite', 'apple', 'grant']) {
    const f = await fixture({ membership });
    await f.page.goto(base + '/practice/');
    await f.page.locator('[data-practice-hub][data-elite="1"]').waitFor();
    await cards(f.page, 3);
    assert.equal(await f.page.locator('[data-practice-upgrade]').count(), 0);
    assert.equal(await f.page.getByRole('link', { name: 'Start Powered Cube', exact: true }).getAttribute('href'), '/?game=draft-run&set=powered-cube');
    assert.equal(await f.page.getByRole('link', { name: 'Choose your sets', exact: true }).getAttribute('href'), '/?game=draft-run&custom=1');
    if (membership === 'elite') await responsive(f.page, 'elite');
    if (membership === 'elite') {
      f.state.membership = 'free';
      await f.page.evaluate(() => window.dispatchEvent(new Event('packone-account-changed')));
      await f.page.getByRole('button', { name: 'Become Elite to Play', exact: true }).first().waitFor();
      await cards(f.page, 1);
      await f.page.evaluate(() => {
        localStorage.removeItem('pack1-auth-session-v1');
        window.dispatchEvent(new StorageEvent('storage', { key: 'pack1-account-signal-v1', newValue: 'signed-out-fixture' }));
      });
      await f.page.locator('[data-practice-hub][data-account-state="guest"]').waitFor();
      await cards(f.page, 0);
      assert.equal(await f.page.getByRole('link', { name: 'Sign in to practice', exact: true }).count(), 1);
      assert.equal(await f.page.getByRole('button', { name: 'Become Elite to Play', exact: true }).count(), 2);
    }
    assert.deepEqual(f.errors, []);
    await f.context.close();
  }

  // A delayed or failed account read must not hide modes or grant access.
  const delayed = await fixture({ holdAccount: true });
  await delayed.page.goto(base + '/practice/');
  await cards(delayed.page, 0);
  assert.equal(await delayed.page.locator('.practice-card-action button:disabled').count(), 3);
  delayed.releaseAccount();
  await delayed.page.getByRole('link', { name: 'Start Draft Run', exact: true }).waitFor();
  await cards(delayed.page, 1);
  await delayed.context.close();

  const expired = await fixture({ account: 'expired' });
  await expired.page.goto(base + '/practice/');
  await expired.page.locator('[data-practice-hub][data-account-state="guest"]').waitFor();
  await cards(expired.page, 0);
  assert.equal(await expired.page.getByRole('link', { name: 'Sign in to practice', exact: true }).count(), 1);
  assert.equal(await expired.page.getByRole('button', { name: 'Become Elite to Play', exact: true }).count(), 2);
  await expired.context.close();

  for (const failure of ['account', 'membership']) {
    const f = await fixture({ [failure]: 'failure' });
    await f.page.goto(base + '/practice/');
    await f.page.locator('[data-practice-error]:not([hidden])').waitFor();
    await cards(f.page, failure === 'account' ? 0 : 1);
    assert.equal(await f.page.locator('.practice-card-action button:disabled').count(), failure === 'account' ? 3 : 2);
    assert.equal(await f.page.locator('[data-practice-upgrade]').count(), 0, 'failed reads must not claim an upgrade is required');
    f.state.account = 'signed-in'; f.state.membership = 'elite';
    await f.page.getByRole('button', { name: 'Try again', exact: true }).click();
    await f.page.locator('[data-practice-hub][data-elite="1"]').waitFor();
    await cards(f.page, 3);
    assert.equal(await f.page.locator('[data-practice-error]').isHidden(), true);
    assert.deepEqual(f.errors, []);
    await f.context.close();
  }
  console.log('Practice discovery, guest/free/Elite access, loading/error recovery, and responsive actions passed.');
} finally {
  await browser.close();
}
