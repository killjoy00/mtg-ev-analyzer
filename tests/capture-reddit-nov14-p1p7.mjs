// One-off capture of an actual Nov 14 Daily puzzle in Pack One's real browser UI.
// Data is a public-puzzle-only fixture from the archived production Daily.
// All gameplay/account API requests are mocked; no production writes or deploys.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';

const fixture=JSON.parse(await fs.readFile('tests/fixtures/reddit-2026-11-14-latest-p1p7.json','utf8'));
const puzzle=fixture.puzzle;
assert.equal(fixture.day,'2026-11-14');
assert.equal(puzzle.puzzle_id,'95b3b886ddbcc905e0d2630e28059b0a');
assert.equal(puzzle.pick_number,7);
assert.equal(puzzle.prior_picks.length,6);
assert.equal(puzzle.candidates.length,8);

const state={
  id:'11111111-1111-4111-8111-111111111111',
  environment:'latest',day:fixture.day,run_length:8,round:7,revision:6,
  leaderboard_eligible:false,ranked_name:null,set_reroll_allowed:false,
  answers:fixture.prior_scores,rerolls:{set:0,pack:0},complete:false,score:null,
  current:puzzle,standing:null,daily_featured_sets:[puzzle.set_id]
};
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));

const ok=body=>({status:200,contentType:'application/json',body:JSON.stringify(body)});
const apiHost=host=>host==='api.packone.pro'||host.endsWith('.neon.tech');
await page.route(url=>apiHost(url.hostname),async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  const method=route.request().method();
  if((path==='/v1/runs'||path==='/draft/v1/runs')&&method==='POST')
    return route.fulfill(ok(state));
  if(path.endsWith('/v1/player/session')||path.endsWith('/v1/session'))
    return route.fulfill(ok({token:'fixture-only-session',ok:true}));
  if(path.endsWith('/v1/daily-status'))
    return route.fulfill(ok({day:fixture.day,daily_history:[],player:{claimed:false},capabilities:[],daily_streak:0}));
  if(path.endsWith('/v1/profile/me'))
    return route.fulfill(ok({player:{display_name:'Pack Player',claimed:false},summary:{games:0},achievements:[]}));
  if(path.endsWith('/v1/events')||path.endsWith('/view'))
    return route.fulfill(ok({ok:true}));
  // Fail closed: the screenshot must never depend on a real account API.
  throw Error('Unexpected API request in screenshot fixture: '+method+' '+path);
});
await page.clock.setFixedTime(new Date('2026-11-14T18:00:00Z'));
await fs.mkdir('artifacts/historical-reddit',{recursive:true});
try {
  await page.goto('http://127.0.0.1:4173/?game=draft-run&set=latest&daily=1',{waitUntil:'domcontentloaded'});
  await page.locator('.run-cards').waitFor({timeout:30000});
  assert.equal(await page.locator('.run-card-select').count(),8);
  assert.equal(await page.locator('.run-pool-cards button').count(),6);
  assert.match(await page.locator('.draft-run-page').innerText(),/Liliana the Repentant/);
  assert.match(await page.locator('.draft-run-page').innerText(),/Rewrite Regrets/);
  assert.equal(await page.locator('#run-lock').isDisabled(),true,'Do not preselect a card');
  await page.evaluate(()=>{for(const img of document.querySelectorAll('.run-cards img,.run-pool img'))img.loading='eager';});
  await page.waitForFunction(()=>[...document.querySelectorAll('.run-cards img,.run-pool img')].every(img=>img.complete&&img.naturalWidth>0),null,{timeout:45000});
  await page.evaluate(async()=>{
    await Promise.all([...document.querySelectorAll('.run-cards img,.run-pool img')].map(img=>img.decode()));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  await page.screenshot({path:'artifacts/historical-reddit/packone-2026-11-14-p1p7-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:'artifacts/historical-reddit/packone-2026-11-14-p1p7-mobile.png',fullPage:true});
  assert.deepEqual(errors,[],'Browser page errors');
  console.log(JSON.stringify({captured:true,day:fixture.day,source:puzzle.puzzle_id,previous:puzzle.prior_picks.length,pack:puzzle.candidates.length,output:'artifacts/historical-reddit/'}));
} finally {
  await browser.close();
}
