import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
await mkdir('artifacts',{recursive:true});
const page=await browser.newPage();
const errors=[],requests=[];let releaseProfile;
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
const day='2026-09-18';let completed=[],claimed=false;
await page.addInitScript(()=>{const OriginalDate=Date;window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:['2026-09-18T16:00:00Z']));}};});
await page.route('**/*.neon.tech/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 let body={ok:true};
 if(path==='/v1/session')body={token:'home-test'};
 if(path==='/v1/daily-status'){
  if(releaseProfile===undefined)await new Promise(resolve=>releaseProfile=resolve);
  body={player:{claimed},daily_history:completed.map(set_id=>({date:day,mode:'draft_run',set_id,score:93}))};
 }
 await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
});
try{
 await page.setViewportSize({width:390,height:844});
 await page.goto(process.env.PACK1_E2E_URL||'http://127.0.0.1:4173',{waitUntil:'domcontentloaded'});
 await page.locator('.daily-home-game a').first().waitFor();
 assert.equal(await page.getByRole('link',{name:'Play now',exact:true}).count(),3,'Play links do not wait for profile');
 assert.ok(!requests.some(u=>/\/(app\.js|social\.mjs|home-today\.mjs|data\/catalog\.json|shards\/)/.test(u)),'Home excludes the legacy replay dependency tree');
 await page.waitForFunction(()=>Boolean(document.querySelector('#account-nav')));
 while(!releaseProfile)await new Promise(r=>setTimeout(r,10));releaseProfile();
 for(const sets of [[],['mixed'],['powered-cube'],['mixed','powered-cube'],['mixed','powered-cube','latest']]){
  completed=sets;claimed=true;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(n=>document.querySelector('[data-daily-home]')?.dataset.completed===String(n),sets.length);
  assert.equal(await page.locator('.daily-home-game.is-complete').count(),sets.length);
  assert.equal(await page.locator('.daily-home-practice').count(),sets.length===3?1:0);
  assert.equal(await page.locator('.daily-home-regular,.daily-home-custom').count(),0,'Daily home must not duplicate Practice or Elite surfaces');
  if(sets.length===1)assert.equal(await page.locator('.daily-home-game').first().getAttribute('class'),'daily-home-game is-unplayed');
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:900});
   const metrics=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);assert.ok(metrics[0]<=metrics[1]+1,`No overflow at ${width}`);
  }
  await page.setViewportSize({width:390,height:844});
  if(sets.length===0){
   assert.equal(await page.getByText('Eight decisions from Powered Cube trophy drafts.',{exact:true}).count(),1);
   assert.equal(await page.getByText('Eight decisions from trophy drafts in the latest set.',{exact:true}).count(),1);
  }
  await page.screenshot({path:`artifacts/home-${sets.join('-')||'unplayed'}-mobile.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);
 console.log('Core home passed: immediate play, completion ordering, Daily-first signed-in state, factual Daily copy, responsive layout, isolated startup.');
}finally{await browser.close();}
