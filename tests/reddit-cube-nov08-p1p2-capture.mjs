// One-off Playwright capture of the real Pack One UI for a historical public Daily.
// This is NOT a simulated card image: it loads the website's actual frontend and
// historical public card URLs, with only the old run's API snapshot replayed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';

const fixture=JSON.parse(await fs.readFile('tests/fixtures/reddit-2026-11-08-cube-p1p2.json','utf8'));
assert.equal(fixture.date,'2026-11-08');
assert.equal(fixture.environment,'powered-cube');
assert.equal(fixture.puzzle.puzzle_id,'66ec08f95085723b93841c92bac84a51');
assert.equal(fixture.puzzle.pick_number,2);
assert.equal(fixture.puzzle.prior_picks[0].name,'Mox Jet');
assert.equal(fixture.puzzle.prior_picks.length,1);
assert.equal(fixture.puzzle.candidates.length,14);
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:970},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.clock.setFixedTime(new Date('2026-11-08T18:00:00Z'));

const runId='11111111-1111-4111-8111-111111111111';
const snapshot=()=>({
  id:runId,environment:'powered-cube',run_length:8,day:fixture.date,
  leaderboard_eligible:false,ranked_name:null,set_reroll_allowed:false,
  revision:0,round:1,rerolls:{set:0,pack:0},complete:false,score:null,
  answers:[],current:fixture.puzzle,
  standing:null,daily_featured_sets:['powered-cube'],
});

await page.route('**/*-pack1growth.compute.c-5.us-east-2.aws.neon.tech/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let body={ok:true};
  if(path==='/v1/session')body={token:'test-token'};
  if(path==='/v1/profile/me')body={player:{display_name:'Guest',claimed:false},summary:{games:0},achievements:[]};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
});
const handleGameRequest=async route=>{
  const requestUrl=new URL(route.request().url());
  const path=requestUrl.pathname;
  let body;
  if(path==='/v1/runs'&&route.request().method()==='POST')body=snapshot();
  else if(path==='/v1/daily-status')body={day:fixture.date,daily_history:[],player:{claimed:false},capabilities:[],daily_streak:0};
  else if(path.endsWith('/view'))body={ok:true};
  else if(path.startsWith('/v1/runs/'))body=snapshot();
  else body={ok:true};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
};
await page.route('**/*-draftrunapi.compute.c-5.us-east-2.aws.neon.tech/**',handleGameRequest);
await page.route('https://api.packone.pro/**',handleGameRequest);

try {
  await page.goto('http://127.0.0.1:4173/?game=draft-run&set=powered-cube&daily=1',{waitUntil:'domcontentloaded'});
  await page.locator('.run-cards').waitFor({timeout:30000});
  await page.waitForFunction(()=>document.querySelector('.run-pick')?.textContent.includes('Pick 2'));
  assert.match(await page.locator('.run-heading').innerText(),/Pick 2/);
  assert.equal(await page.locator('.run-card-select img').count(),14);
  assert.equal(await page.locator('.run-pool-cards img').count(),1);
  const cardNames=await page.locator('.run-card-select img').evaluateAll(imgs=>imgs.map(img=>img.alt));
  assert.ok(cardNames.includes('Timetwister'));
  assert.ok(cardNames.includes('Vampiric Tutor'));
  assert.ok(cardNames.includes('Wheel of Fortune'));
  assert.equal(fixture.trophy,'Wheel of Fortune');
  assert.equal(fixture.model_pick,'Timetwister');
  await page.evaluate(()=>{for(const img of document.querySelectorAll('.run-cards img,.run-pool img'))img.loading='eager';});
  await page.waitForFunction(()=>[...document.querySelectorAll('.run-cards img,.run-pool img')].every(img=>img.complete&&img.naturalWidth>0),null,{timeout:60000});

  await fs.mkdir('artifacts/reddit-cube-nov08',{recursive:true});
  for(const view of [
    {width:1440,height:1100,name:'packone-2026-11-08-cube-p1p2-desktop.png'},
    {width:980,height:1200,name:'packone-2026-11-08-cube-p1p2-compact.png'},
    {width:768,height:2300,name:'packone-2026-11-08-cube-p1p2-four-column.png',crop:true},
  ]) {
    await page.setViewportSize({width:view.width,height:view.height});
    await page.evaluate(async()=>{
      await Promise.all([...document.querySelectorAll('.run-cards img,.run-pool img')].map(img=>img.decode()));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    });
    const file='artifacts/reddit-cube-nov08/'+view.name;
    const bounds=await page.locator('.draft-run-page').boundingBox();
    const clip=view.crop?{x:0,y:0,width:view.width,height:Math.min(view.height,Math.ceil(bounds.y+bounds.height+30))}:undefined;
    await page.screenshot({path:file,fullPage:!view.crop,clip,animations:'disabled'});
    console.log('Captured '+file);
  }
  assert.deepEqual(errors,[]);
} finally {
  await browser.close();
}
