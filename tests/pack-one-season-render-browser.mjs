// Synthetic-only real Chromium acceptance. No live artwork or player data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {captureSeasonEditorial,seasonEditorialHtml} from '../scripts/pack-one-season-render.mjs';
import {loadWeeklyBrand,jpegDimensions} from '../scripts/pack-one-weekly-render.mjs';
import {seasonArticle,guideArticle} from './fixtures/pack-one-season-articles.mjs';
const art='<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350"><rect width="250" height="350" fill="#dce6ed"/><rect x="10" y="60" width="230" height="160" fill="#94b5ce"/></svg>';
const synthetic={async launch(opts){const b=await chromium.launch(opts);return {close:()=>b.close(),async newPage(opts){const p=await b.newPage(opts);const route=p.route.bind(p);p.route=(pattern,handler)=>route(pattern,r=>r.request().url().startsWith('https://cards.scryfall.io/')?r.fulfill({contentType:'image/svg+xml',body:art}):handler(r));return p;}};}};
test('both actual mobile composites include the complete branded content and fit the private transport',async()=>{
 for(const a of [seasonArticle,guideArticle]){
  const image=await captureSeasonEditorial(a,{chromiumImpl:synthetic,jpeg:true});
  assert.deepEqual(jpegDimensions(image.jpeg),{width:image.width,height:image.height});
  assert.equal(image.width,960);assert.ok(image.height>960&&image.height<30000&&image.jpeg.length<12000000);
  assert.ok(image.panels['weekly-footer']);
 }
 const brand=await loadWeeklyBrand(),b=await synthetic.launch({headless:true});
 try{
  const p=await b.newPage({viewport:{width:480,height:1000}});
  await p.route('**/*',r=>r.abort());await p.setContent(seasonEditorialHtml(seasonArticle,brand));
  assert.equal(await p.locator('.weekly-winner').count(),6);
  assert.match(await p.locator('main').innerText(),/Most Dailies Completed/);
  assert.match(await p.locator('main').innerText(),/every-Daily club/);
  assert.doesNotMatch(await p.locator('main').innerText(),/Full participation is recognition|not a ranking or a requirement to win/i);
  assert.equal(await p.locator('.weekly-badges img').count(),2);
  assert.equal(await p.locator('.weekly-footer .weekly-web').innerText(),'Play Pack One · packone.pro');
  assert.equal(await p.locator('a[href="https://apps.apple.com/app/id6814318676"]').count(),1);
  assert.equal(await p.locator('a[href="https://play.google.com/store/apps/details?id=pro.packone.app"]').count(),1);
  await p.setContent(seasonEditorialHtml(guideArticle,brand));
  assert.equal(await p.locator('.weekly-pack').count(),2);
  assert.match(await p.locator('main').innerText(),/Observed Draft Results/);
 }finally{await b.close();}
});
