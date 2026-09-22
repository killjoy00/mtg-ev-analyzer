// Live, unranked QA guest: actual browser -> production APIs -> stored Dailies.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[],requests=[],metrics=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
await fs.mkdir('artifacts/production',{recursive:true});
await page.addInitScript(()=>localStorage.setItem('pack1-player-name-v1','QA production mobile'));
const overflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
try {
 let t=Date.now();await page.goto('https://packone.pro',{waitUntil:'domcontentloaded'});await page.locator('.daily-home-game a').first().waitFor();
 metrics.push({action:'homepage_play_ctas',ms:Date.now()-t});
 assert.equal(await page.getByRole('link',{name:'Play now',exact:true}).count(),3);
 const config=await page.evaluate(()=>window.PACK1_API);
 assert.equal(config.firstParty,true);assert.equal(config.growthUrl,'https://api.packone.pro/growth');assert.equal(config.draftRunUrl,'https://api.packone.pro/draft');
 assert.ok(!requests.some(u=>/\/(app\.js|social\.mjs|home-today\.mjs|data\/catalog\.json|shards\/)/.test(u)),'No historical dependency tree on home');
 assert.ok(!requests.some(u=>/-pack1growth\.compute\.c-5\.us-east-2\.aws\.neon\.tech|draftrunapi\.compute\.c-5\.us-east-2\.aws\.neon\.tech/.test(u)),'Production browser uses the first-party account/gameplay gateway');
 await page.locator('#account-nav').click();await page.locator('#account-google').waitFor();
 assert.equal(await page.locator('#account-google').innerText(),'Sign in with Google');
 assert.equal(await page.evaluate(()=>localStorage.getItem('pack1-auth-session-v1')),null);
 await page.goto('https://packone.pro',{waitUntil:'domcontentloaded'});await page.locator('.daily-home-game a').first().waitFor();
 await page.screenshot({path:'artifacts/production/home-mobile.png',fullPage:true});
 for(const [index,environment] of ['mixed','powered-cube','latest'].entries()) {
  t=Date.now();const startResponse=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/v1/runs')&&r.request().method()==='POST');
  await page.locator(`[data-environment="${environment}"] a`).click();
  let state=await (await startResponse).json();await page.locator('.run-cards').waitFor();
  metrics.push({action:environment+'_first_pack',ms:Date.now()-t});
  assert.equal(state.run_length,8);assert.match(await page.locator('.run-ranking-state').innerText(),/Playing as guest/);assert.equal(state.leaderboard_eligible,false);
  assert.deepEqual(state.rerolls,{set:0,pack:0});assert.equal(await page.locator('[data-reroll]').count(),0);
  for(let round=0;round<8;round++) {
   await overflow();await page.locator('.run-card-select').first().waitFor();
   if(round<2){
    await page.evaluate(()=>{for(const img of document.querySelectorAll('.run-cards img,.run-pool img'))img.loading='eager';});
    await page.waitForFunction(()=>[...document.querySelectorAll('.run-cards img,.run-pool img')].every(i=>i.complete&&i.naturalWidth>0),null,{timeout:45000});
    for(const width of [320,390,768,1440]) {
     await page.setViewportSize({width,height:width<768?844:1000});await overflow();
     if(round===1){const pool=await page.locator('.run-pool-cards img').first().boundingBox(),pack=await page.locator('.run-card-select img').first().boundingBox();assert.ok(Math.abs(pool.width/pack.width-.85)<.03,`Pool ratio at ${width}: ${pool.width/pack.width}`);}
     await page.evaluate(async()=>{await Promise.all([...document.querySelectorAll('.run-cards img,.run-pool img')].map(i=>i.decode()));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
     if(width===390||width===1440)await page.screenshot({path:`artifacts/production/${environment}-pick-${round+1}-${width}.png`,fullPage:true});
    }
    await page.setViewportSize({width:390,height:844});
   }
   await page.locator('.run-card-select').first().click();
   const reply=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/pick')&&r.request().method()==='POST');
   await page.locator('#run-lock').click();state=await (await reply).json();await page.locator('#run-next').waitFor();
   const answer=state.answers[round];assert.equal(answer.historicalMatch?answer.score===100:answer.score>=0&&answer.score<=95,true);
   await page.locator('#run-next').click();
  }
  await page.locator('.run-result-page').waitFor();assert.equal(state.complete,true);if(environment==='latest')assert.ok(state.answers.every(a=>a.puzzle.set_id===state.daily_featured_sets[0]));assert.equal(state.standing,null);
  await page.screenshot({path:`artifacts/production/${environment}-result-mobile.png`,fullPage:true});
  await page.goto('https://packone.pro',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(n=>document.querySelector('[data-daily-home]')?.dataset.completed===String(n),index+1);
  assert.equal(await page.getByRole('link',{name:'Play now',exact:true}).count(),2-index);
  await page.screenshot({path:`artifacts/production/home-completed-${index+1}.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,metrics}));
 await fs.writeFile('artifacts/production/measurements.json',JSON.stringify({passed:true,metrics},null,2));
} finally {await browser.close();}
