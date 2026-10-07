import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const kind=String(process.env.CI_PUBLICATION_KIND||'');
const slug=String(process.env.CI_PUBLICATION_SLUG||'');
const action=String(process.env.CI_PUBLICATION_ACTION||'');
assert.ok(['creator','campaign'].includes(kind),'publication kind is required');
assert.match(slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/,'canonical publication slug is required');
assert.ok(['publish','retire'].includes(action),'publication action is required');

const origin=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const route=kind==='creator'?`/creator/${slug}/`:`/go/${slug}/`;
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
try {
  const context=await browser.newContext({javaScriptEnabled:false});
  const page=await context.newPage();
  const response=await page.goto(origin+route,{waitUntil:'domcontentloaded'});
  if(kind==='campaign'&&action==='retire') {
    assert.equal(response?.status(),404,'retired ordinary campaign route must be absent');
    console.log(`Campaign retirement smoke passed for ${route}`);
  } else {
    assert.ok(response?.ok(),`publication route failed to load: ${response?.status()}`);
    const robots=await page.locator('meta[name="robots"]').getAttribute('content');
    assert.match(String(robots),/noindex/i,'generated publication route remains non-indexed');
    const canonical=await page.locator('link[rel="canonical"]').getAttribute('href');
    assert.ok(canonical?.startsWith('https://packone.pro/'),'canonical stays on Pack One');
    if(kind==='campaign') {
      assert.equal(action,'publish');
      const href=await page.locator('body a').first().getAttribute('href');
      assert.ok(href?.startsWith('https://packone.pro/'),'campaign fallback target stays first-party');
      assert.match(href,/utm_source=/);assert.match(href,/utm_campaign=/);
    } else if(action==='publish') {
      assert.equal(await page.locator('body').getAttribute('data-creator-challenge-status'),'published');
      assert.match(String(await page.locator('meta[property="og:image"]').getAttribute('content')),new RegExp(`/creator/${slug}/creator-card\\.png$`));
      const card=await context.request.get(origin+route+'creator-card.png');
      assert.ok(card.ok(),'published creator Open Graph card must be served');
      assert.match(String(card.headers()['content-type']||''),/^image\//);
      const cardBytes=Buffer.from(await card.body());
      assert.equal(cardBytes.readUInt32BE(16),1200);assert.equal(cardBytes.readUInt32BE(20),630);
      const square=await context.request.get(origin+route+'creator-card-square.png');
      assert.ok(square.ok(),'published creator square card must be served');
      assert.match(String(square.headers()['content-type']||''),/^image\//);
      const squareBytes=Buffer.from(await square.body());
      assert.equal(squareBytes.readUInt32BE(16),1080);assert.equal(squareBytes.readUInt32BE(20),1080);
    } else {
      assert.equal(await page.locator('body').getAttribute('data-creator-challenge-status'),'retired');
      assert.match(await page.locator('body').innerText(),/no longer available/i);
      assert.equal(await page.locator('meta[property="og:image"]').count(),0,'retired creator metadata must not retain a social image');
      const card=await context.request.get(origin+route+'creator-card.png');
      assert.equal(card.status(),404,'retired creator Open Graph card must be removed');
      const square=await context.request.get(origin+route+'creator-card-square.png');
      assert.equal(square.status(),404,'retired creator square card must be removed');
    }
    console.log(`${kind} ${action} browser smoke passed for ${route}`);
  }
  await context.close();
} finally {
  await browser.close();
}
