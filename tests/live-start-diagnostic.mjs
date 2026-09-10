import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.PACK1_LIVE_URL || 'https://magic.planitnow.us';
await mkdir('artifacts', { recursive:true });
const browser = await chromium.launch(process.env.CI ? { headless:true, channel:'chrome' } : { headless:true });
const context = await browser.newContext({ viewport:{width:390,height:844}, extraHTTPHeaders:{'cache-control':'no-cache',pragma:'no-cache'} });
const page = await context.newPage();
page.setDefaultTimeout(60000);
const events=[];
const started=new Map();
page.on('request', request => {
  if (request.url().includes('compute.c-5.us-east-2.aws.neon.tech')) {
    started.set(request, Date.now());
    events.push({kind:'request',method:request.method(),url:request.url()});
  }
});
page.on('response', async response => {
  const request=response.request();
  if (!request.url().includes('compute.c-5.us-east-2.aws.neon.tech')) return;
  const event={kind:'response',method:request.method(),url:request.url(),status:response.status(),ms:started.has(request)?Date.now()-started.get(request):null};
  if (response.status() >= 400) {
    try { event.body=(await response.text()).slice(0,1000); } catch {}
  }
  events.push(event);
});
page.on('requestfailed', request => {
  if(request.url().includes('compute.c-5.us-east-2.aws.neon.tech')) events.push({kind:'failed',method:request.method(),url:request.url(),error:request.failure()?.errorText});
});
page.on('console', msg => { if(msg.type()==='error') events.push({kind:'console-error',text:msg.text()}); });
page.on('pageerror', error => events.push({kind:'page-error',text:error.message}));
try {
  await page.goto(`${base}/?qa=start-diag-${Date.now()}`, {waitUntil:'domcontentloaded'});
  await page.locator('.draft-run-feature').waitFor();
  const config=await page.evaluate(()=>window.PACK1_API);
  console.log('LIVE_CONFIG', JSON.stringify(config));
  const health=await page.evaluate(async cfg => {
    async function probe(url) {
      const t=performance.now();
      try { const r=await fetch(url+'/health',{cache:'no-store'}); return {status:r.status,ms:Math.round(performance.now()-t),text:(await r.text()).slice(0,500)}; }
      catch(e) { return {status:0,ms:Math.round(performance.now()-t),error:String(e)}; }
    }
    return {growth:await probe(cfg.growthUrl),draft:await probe(cfg.draftRunUrl)};
  }, config);
  console.log('LIVE_HEALTH', JSON.stringify(health));
  await page.goto(`${base}/?game=draft-run&qa=start-diag-${Date.now()}`, {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => {
    if(document.querySelector('.run-cards')) return true;
    const h=document.querySelector('.message-card h1');
    return h && !/Finding ten good decisions/i.test(h.textContent||'');
  }, null, {timeout:60000}).catch(()=>{});
  const state=await page.evaluate(()=>({
    href:location.href,
    body:document.body.innerText.slice(0,5000),
    hasCards:Boolean(document.querySelector('.run-cards')),
    hasMessage:Boolean(document.querySelector('.message-card')),
    packToken:Boolean(localStorage.getItem('pack1-api-session-v1')),
  }));
  console.log('LIVE_START_STATE', JSON.stringify(state));
  console.log('LIVE_NETWORK', JSON.stringify(events,null,2));
  await page.screenshot({path:'artifacts/live-start-diagnostic.png',fullPage:true});
  assert.ok(state.hasCards, `Live practice did not reach cards. Page text: ${state.body}`);
  console.log('Live start diagnostic passed.');
} finally {
  await context.close();
  await browser.close();
}
