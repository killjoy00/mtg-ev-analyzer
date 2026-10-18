import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
await mkdir('artifacts',{recursive:true});
const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const regular=[
  {
    set_id:'newest-set',set_name:'Newest Set',release_date:'2026-08-14',regular_run:true,
    data_date:'2026-09-03',training_drafts:2341,win_rate_cutoff:.62,
    qualified_trophy_drafts:617,verified_decisions:6787,
  },
  ...Array.from({length:27},(_,i)=>({
    set_id:i===0?'ecl':`set-${String(i+1).padStart(2,'0')}`,
    set_name:`Archive Set ${String(i+1).padStart(2,'0')}`,
    release_date:`2025-${String(12-(i%12)).padStart(2,'0')}-01`,
    regular_run:true,data_date:'2026-08-01',training_drafts:2000+i,
    win_rate_cutoff:.6,qualified_trophy_drafts:500+i,verified_decisions:6000+i,
  })),
];
const cube={
  set_id:'powered-cube',set_name:'Powered Cube',release_date:null,regular_run:false,
  data_date:'2025-12-01',training_drafts:5000,win_rate_cutoff:.6,
  qualified_trophy_drafts:1243,verified_decisions:14993,
};

try {
  const errors=[];
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*.neon.tech/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/v1/set-catalog') {
      await route.fulfill({contentType:'application/json',body:JSON.stringify({corpus_version:'test-corpus',sets:[...regular,cube]})});
      return;
    }
    await route.fulfill({status:404,contentType:'application/json',body:'{"error":"not mocked"}'});
  });
  await page.goto(base+'/sets/',{waitUntil:'domcontentloaded'});
  await page.locator('#set-archive-grid .set-catalog-card').first().waitFor();

  assert.equal(await page.locator('#set-archive-grid .set-catalog-card').count(),28,'renders all 28 Live regular sets');
  assert.equal(await page.locator('#special-format-grid .set-catalog-card').count(),1,'renders Powered Cube separately');
  assert.equal((await page.locator('#set-archive-summary strong').first().textContent())?.trim(),'28');
  assert.equal((await page.locator('#set-archive-summary strong').nth(1).textContent())?.trim(),'Newest Set');

  const regularCta=page.locator('#set-archive-grid .set-catalog-card').first().getByRole('link',{name:'Play Draft Run'});
  assert.equal(await regularCta.getAttribute('href'),'/?game=draft-run');
  assert.equal(await page.locator('a[href*="custom=1"]').count(),0,'public set archive must not route free users into custom-corpus practice');

  const cubeCta=page.locator('#special-format-grid').getByRole('link',{name:'Elite Cube Practice'});
  assert.equal(await cubeCta.getAttribute('href'),'/?game=draft-run&set=powered-cube');
  assert.ok(await page.locator('#special-formats').isVisible());
  assert.equal(await page.getByRole('link',{name:'Set guide',exact:true}).count(),2,'only reviewed sets and Cube receive guide links');
  assert.equal(await page.locator('a[href="/sets/ecl/guide/"]').count(),1);

  await page.screenshot({path:'artifacts/sets-archive-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);

  await page.goto(base+'/sets/ecl/');
  await page.getByRole('link',{name:/Open set guide/}).click();
  await page.getByRole('tab',{name:'Refresher',exact:true}).waitFor();
  assert.equal(await page.locator('.guide-archetype').count(),5);
  await page.locator('.guide-archetype summary').first().click();
  assert.ok(await page.locator('.guide-archetype[open] p').isVisible());
  await page.getByRole('tab',{name:'Refresher',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab',{name:'Results',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('.guide-results-table tbody tr').count(),10);
  assert.match(await page.locator('.guide-results-lead').innerText(),/Black–Green/);
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`guide fits ${width}px`);
  }
  await page.getByRole('tab',{name:'Refresher',exact:true}).click();
  await page.screenshot({path:'artifacts/set-guide-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'artifacts/set-guide-mobile.png',fullPage:true});
  await page.goto(base+'/sets/powered-cube/guide/#results');
  await page.getByRole('tab',{name:'Results',exact:true}).waitFor();
  assert.equal(await page.getByRole('tab',{name:'Results',exact:true}).getAttribute('aria-selected'),'true');
  assert.match(await page.locator('[role="tabpanel"]:visible').innerText(),/cube lists change/);
  const noScript=await browser.newPage({javaScriptEnabled:false});
  await noScript.goto(base+'/sets/neo/guide/');
  assert.equal(await noScript.locator('.guide-archetype').count(),10,'standalone guides remain readable without JavaScript');
  assert.ok(await noScript.locator('.guide-results-table').isVisible());
  await noScript.close();
  assert.deepEqual(errors,[]);

  const failurePage=await browser.newPage({viewport:{width:390,height:844}});
  await failurePage.route('**/*.neon.tech/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'}));
  await failurePage.goto(base+'/sets/',{waitUntil:'domcontentloaded'});
  const fallback=failurePage.getByRole('link',{name:'Draft Run'});
  await fallback.waitFor();
  assert.equal(await fallback.getAttribute('href'),'/?game=draft-run');
  assert.equal(await failurePage.locator('a[href*="custom=1"]').count(),0);
  await failurePage.close();

  console.log('Set archive passed: 28 regular sets + Cube render, free-practice CTA, Cube CTA and failure fallback.');
} finally {
  await browser.close();
}
