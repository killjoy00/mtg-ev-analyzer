// Synthetic-only browser acceptance. No credentials, database or live artwork.
// Exercise the actual packaged renderer and all its canonical brand assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {captureWeeklyRecap,weeklyHtml,loadWeeklyBrand,jpegDimensions} from '../scripts/pack-one-weekly-render.mjs';
import {FORMATS,easiestPick} from '../scripts/pack-one-weekly-data.mjs';
const cardArt='<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350"><rect width="250" height="350" fill="#dce6ed"/><rect x="10" y="12" width="230" height="38" fill="#1e4d7a"/><rect x="10" y="60" width="230" height="160" fill="#94b5ce"/><rect x="10" y="230" width="230" height="108" fill="#fafafa"/></svg>';
const cards=Array.from({length:13},(_,i)=>({id:'fixture-'+i,name:'Synthetic card '+i,image_url:'https://cards.scryfall.io/normal/front/a/b/fixture-'+i+'.jpg',rarity:i===0?'rare':'common'}));
const pick=easiestPick([{day:'2026-11-25',environment:'latest',set_id:'fixture',puzzle_id:'fixture',round:2,pick_number:2,payload:{candidates:cards,prior_picks:cards.slice(1,2),historical_pick_id:cards[0].id},votes:{'fixture-0':98,'fixture-1':2}}]);
const board=environment=>({environment,rows:Array.from({length:5},(_,i)=>({rank:i+1,name:'Fixture '+i,score:99-i,average_score:98-i,days:7}))});
const article={start:'2026-11-23',end:'2026-11-29',weekly:FORMATS.map(board),perfectDailies:[{day:'2026-11-25',environment:'mixed',name:'Fixture 0'}],hardest:{...board('mixed'),day:'2026-11-29',mean:73,rest:83},easiest:pick,seasonName:'Fixture Set',seasonBoards:FORMATS.map(board)};
const syntheticChromium={
 async launch(opts){
  const b=await chromium.launch(opts);
  return {close:()=>b.close(),async newPage(opts){
   const page=await b.newPage(opts);
   const original=page.route.bind(page);
   page.route=(pattern,handler)=>original(pattern,route=>{
    if(route.request().url().startsWith('https://cards.scryfall.io/'))return route.fulfill({contentType:'image/svg+xml',body:cardArt});
    return handler(route);
   });
   return page;
  }};
 }
};
test('real Chromium produces the complete mobile-width article and all approved panels',async()=>{
 assert.ok(pick);
 const capture=await captureWeeklyRecap(article,{chromiumImpl:syntheticChromium,jpeg:true});
 assert.deepEqual(jpegDimensions(capture.jpeg),{width:capture.width,height:capture.height});
 assert.equal(capture.width,960);
 assert.ok(capture.height>capture.width&&capture.height<30000);
 assert.ok(capture.jpeg.length>=5000&&capture.jpeg.length<12_000_000);
 assert.deepEqual(Object.keys(capture.panels),['week-mixed','week-powered-cube','week-latest','perfect-dailies','hardest-daily','easiest-pick','season-mixed','season-powered-cube','season-latest','weekly-footer']);
 for(const bytes of Object.values(capture.panels))assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
});
test('mobile markup shows actual link targets, top-five styling and no excluded blocks',async()=>{
 const brand=await loadWeeklyBrand(),browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:480,height:1000}});
  await page.route('**/*',r=>r.request().url().startsWith('https://cards.scryfall.io/')?r.fulfill({contentType:'image/svg+xml',body:cardArt}):r.abort());
  await page.setContent(weeklyHtml(article,brand),{waitUntil:'load'});
  assert.equal(await page.locator('.weekly-winner').count(),3);
  assert.equal(await page.getByText('98% of you got this one right!',{exact:true}).count(),1);
  assert.equal(await page.locator('a[href="https://apps.apple.com/app/id6814318676"]').count(),1);
  assert.equal(await page.locator('a[href="https://play.google.com/store/apps/details?id=pro.packone.app"]').count(),1);
  const content=await page.locator('main').innerText();
  assert.doesNotMatch(content,/Hardest Pick|A pick from the Daily|moved into/i);
  assert.ok(await page.locator('.weekly-article').evaluate(e=>e.scrollWidth<=e.clientWidth+2));
 }finally{await browser.close();}
});
