// Browser smoke for the allowlisted Pages preview, not the repository root.
// Runs only in the e2e job after Playwright/Chromium is installed. External
// requests are aborted: no live API, auth, ads or quota traffic is generated.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const origin='http://127.0.0.1:4174';
const publicPaths=[
  '/', '/about/', '/how-it-works/', '/practice/', '/admin/', '/learn/', '/sets/fra/guide/',
  '/creator/lordsoflimited/', '/go/reddit/', '/share/daily/latest/',
  '/d/', '/open/profile/', '/reset-password/', '/privacy/', '/terms/',
  '/.well-known/apple-app-site-association','/.well-known/assetlinks.json',
  '/ads.txt','/robots.txt','/sitemap.xml','/data/catalog.json',
  '/corpus/draft-run/catalog.json'
];
const deniedPaths=[
  '/package.json','/worker/growth-function.js','/scripts/build-pages-preview.mjs',
  '/tests/pages-preview-allowlist.test.mjs','/migrations/0016_retire_third_source.sql',
  '/research/CONTEXTUAL-VALUE-V1-RUN.html','/data/import-queue.json',
  '/edge/gateway.mjs','/mobile/app.json'
];
for(const path of publicPaths){
  const response=await fetch(origin+path,{signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,200,'Expected published path: '+path);
}
for(const path of deniedPaths){
  const response=await fetch(origin+path,{signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,404,'Unexpected source file published: '+path);
}

const browser=await chromium.launch({headless:true});
let pageCount=0,checkedResources=0;
try{
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>{
    // Disallow any traffic to real APIs, ad partners or identity providers.
    if(route.request().url().startsWith(origin+'/'))return route.continue();
    return route.abort();
  });
  for(const path of [
    '/', '/about/', '/how-it-works/', '/practice/', '/admin/', '/learn/', '/sets/fra/guide/',
    '/reset-password/', '/privacy/', '/terms/'
  ]){
    const page=await context.newPage(),missing=[];
    page.on('response',response=>{
      const url=response.url(),kind=response.request().resourceType();
      if(url.startsWith(origin+'/')&&response.status()>=400 &&
        ['script','stylesheet','image','font'].includes(kind)){
        missing.push(kind+' '+response.status()+' '+url);
      }
    });
    const response=await page.goto(origin+path,{waitUntil:'domcontentloaded',timeout:20000});
    assert.equal(response?.status(),200,'Browser route failed: '+path);
    await page.waitForTimeout(600);
    assert.equal(missing.length,0,'Missing same-origin browser assets on '+path+': '+missing.join(', '));
    assert.ok((await page.title()).trim().length>0,'Missing page title: '+path);
    // Verify real badge geometry: a single even row without another rule or label.
    if(path==='/'||path==='/about/'||path==='/how-it-works/'){
      await page.locator('[data-store-links]').waitFor({state:'attached',timeout:7000});
      const strip=page.locator('[data-store-links]');
      assert.equal(await strip.count(),1,path+' has exactly one store strip');
      const links=strip.locator('[data-store-badge]');
      assert.equal(await links.count(),2,'desktop keeps both native stores');
      const bounds=await Promise.all([0,1].map(i=>links.nth(i).boundingBox()));
      assert.ok(bounds.every(Boolean),'both store links are rendered');
      assert.ok(Math.abs(bounds[0].y-bounds[1].y)<2,'badges stay on one horizontal row');
      const layout=await strip.evaluate(el=>{
        const style=getComputedStyle(el);
        const badges=getComputedStyle(el.querySelector('.editorial-store-badges, .daily-home-store-badges'));
        return {border:style.borderTopWidth,text:el.textContent.trim(),
          alignment:badges.justifyContent,wrap:badges.flexWrap};
      });
      assert.equal(layout.border,'0px','no additional store divider');
      assert.doesNotMatch(layout.text,/Also on/,'no redundant promotional copy');
      assert.equal(layout.alignment,'space-evenly','badges are evenly spaced');
      assert.equal(layout.wrap,'nowrap','badges must stay on one row');
      const images=strip.locator('img');
      const heights=await Promise.all([0,1].map(i=>images.nth(i).evaluate(img=>img.getBoundingClientRect().height)));
      assert.deepEqual(heights,[52,72],'Apple is 52px; official Google artwork stays at 72px including its padding');
      await page.setViewportSize({width:375,height:800});
      const narrow=await Promise.all([0,1].map(i=>links.nth(i).boundingBox()));
      assert.ok(narrow.every(Boolean),'both links remain rendered at 375px');
      assert.ok(narrow[0].x+narrow[0].width+10<=narrow[1].x,
        'unrecognized narrow screens keep enough space between both badges');
      assert.ok(narrow[1].x+narrow[1].width<=375,
        'store badges never extend past the right edge of a small screen');
    }

    pageCount++;
    checkedResources+=missing.length;
    await page.close();
  }
  await context.close();
}finally{
  await browser.close();
}
console.log('Allowlisted Pages browser preview: '+publicPaths.length+' public and '+
  deniedPaths.length+' denied HTTP paths, '+pageCount+' Chromium routes; '+
  checkedResources+' missing browser assets; all external requests blocked.');
