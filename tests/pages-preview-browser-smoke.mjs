// Browser smoke for the allowlisted Pages preview, not the repository root.
// Runs only in the e2e job after Playwright/Chromium is installed. External
// requests are aborted: no live API, auth, ads or quota traffic is generated.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const origin='http://127.0.0.1:4174';
const publicPaths=[
  '/', '/practice/', '/admin/', '/learn/', '/sets/fra/guide/',
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
    if(route.request().url.startsWith(origin+'/'))return route.continue();
    return route.abort();
  });
  for(const path of [
    '/', '/practice/', '/admin/', '/learn/', '/sets/fra/guide/',
    '/creator/lordsoflimited/', '/privacy/', '/terms/'
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
