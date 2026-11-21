// One-off real Pack One gameplay recording, using an actual historical Daily
// decision and the authentic server-calculated reveal from a completed run.
// This changes no app code and does not write to production or player accounts.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';

const f=JSON.parse(await fs.readFile('tests/fixtures/indiegaming-2026-11-14-demo.json','utf8'));
assert.equal(f.date,'2026-11-14');
assert.equal(f.environment,'latest');
assert.equal(f.puzzle.puzzle_id,'95b3b886ddbcc905e0d2630e28059b0a');
assert.equal(f.puzzle.pick_number,7);
assert.equal(f.prior_scores.length,6);
assert.equal(f.answer.puzzle.puzzle_id,f.puzzle.puzzle_id);
assert.equal(f.answer.selectedId,'rewrite-regrets');
assert.equal(f.answer.historicalId,'liliana-the-repentant');
assert.equal(f.answer.score,95);
assert.equal(f.next_puzzle.pick_number,8);
await fs.mkdir('artifacts/indiegaming-demo',{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({
  viewport:{width:768,height:1100},deviceScaleFactor:1,
  recordVideo:{dir:'artifacts/indiegaming-demo',size:{width:768,height:1100}}
});
const page=await context.newPage(),video=page.video();
const started=performance.now(),marks={};
const mark=name=>{marks[name]=(performance.now()-started)/1000; console.log('MARK '+name+' '+marks[name].toFixed(2));};
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')console.log('BROWSER ERROR '+m.text().slice(0,350));});
await page.clock.setFixedTime(new Date('2026-11-14T18:00:00Z'));

let locked=false;
const runId='22222222-2222-4222-8222-222222222222';
const snapshot=()=>({
  id:runId,environment:'latest',run_length:8,day:f.date,
  leaderboard_eligible:false,ranked_name:null,set_reroll_allowed:false,
  revision:locked?7:6,round:locked?8:7,rerolls:{set:0,pack:0},
  complete:false,score:null,
  answers:[...f.prior_scores.map(score=>({score})),...(locked?[f.answer]:[])],
  current:locked?f.next_puzzle:f.puzzle,
  standing:null,daily_featured_sets:['fra']
});

await page.route('**/*-pack1growth.compute.c-5.us-east-2.aws.neon.tech/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let body={ok:true};
  if(path==='/v1/session')body={token:'test-token'};
  if(path==='/v1/profile/me')body={player:{display_name:'Guest',claimed:false},summary:{games:0},achievements:[]};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
});
const handleGame=async route=>{
  const u=new URL(route.request().url()),path=u.pathname;
  let body;
  if(path==='/v1/runs'&&route.request().method()==='POST')body=snapshot();
  else if(path==='/v1/daily-status')body={day:f.date,daily_history:[],player:{claimed:false},capabilities:[],daily_streak:0};
  else if(path.endsWith('/view'))body={ok:true};
  else if(path.endsWith('/pick')&&route.request().method()==='POST') {
    const request=route.request().postDataJSON();
    assert.equal(request.cardId,f.answer.selectedId);
    assert.equal(request.puzzleId,f.puzzle.puzzle_id);
    locked=true;
    body=snapshot();
    mark('server_reveal');
  } else if(path.startsWith('/v1/runs/'))body=snapshot();
  else body={ok:true};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
};
await page.route('**/*-draftrunapi.compute.c-5.us-east-2.aws.neon.tech/**',handleGame);
await page.route('https://api.packone.pro/**',handleGame);

try {
  mark('begin_navigation');
  await page.goto('http://127.0.0.1:4173/?game=draft-run&set=latest&daily=1',{waitUntil:'domcontentloaded'});
  await page.locator('.run-cards').waitFor({timeout:30000});
  await page.waitForFunction(()=>document.querySelector('.run-pick')?.textContent.includes('Pick 7'),null,{timeout:30000});
  assert.equal(await page.locator('.run-card-select img').count(),8);
  await page.evaluate(()=>{for(const img of document.querySelectorAll('.run-cards img,.run-pool img'))img.loading='eager';});
  await page.waitForFunction(()=>[...document.querySelectorAll('.run-cards img,.run-pool img')].every(img=>img.complete&&img.naturalWidth>0),null,{timeout:60000});
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  mark('ready');
  await page.screenshot({path:'artifacts/indiegaming-demo/01-choice.png',animations:'disabled'});
  await page.waitForTimeout(3800);
  await page.locator('[data-pick="rewrite-regrets"]').click();
  assert.equal(await page.locator('[data-pick="rewrite-regrets"]').getAttribute('aria-pressed'),'true');
  mark('selected');
  await page.waitForTimeout(2300);
  mark('locking');
  await page.locator('#run-lock').click();
  await page.locator('.run-feedback').waitFor({timeout:30000});
  assert.match(await page.locator('.run-feedback-score').innerText(),/95/);
  assert.match(await page.locator('#run-feedback-result').innerText(),/Liliana/i);
  mark('revealed');
  await page.screenshot({path:'artifacts/indiegaming-demo/02-reveal.png',animations:'disabled'});
  await page.waitForTimeout(5000);
  await page.locator('.run-analysis').scrollIntoViewIfNeeded();
  mark('analysis');
  await page.waitForTimeout(2800);
  await page.locator('#run-next').click();
  await page.waitForFunction(()=>document.querySelector('.run-pick')?.textContent.includes('Pick 8'),null,{timeout:30000});
  mark('next_pick');
  await page.evaluate(()=>{for(const img of document.querySelectorAll('.run-cards img,.run-pool img'))img.loading='eager';});
  await page.waitForFunction(()=>[...document.querySelectorAll('.run-cards img,.run-pool img')].every(img=>img.complete&&img.naturalWidth>0),null,{timeout:60000});
  await page.screenshot({path:'artifacts/indiegaming-demo/03-next.png',animations:'disabled'});
  await page.waitForTimeout(3000);
  mark('finished');
  assert.deepEqual(errors,[]);
} finally {
  await context.close();
  if(video)await video.saveAs('artifacts/indiegaming-demo/packone-real-gameplay.webm');
  await fs.writeFile('artifacts/indiegaming-demo/timing.json',JSON.stringify({marks,authenticSource:'2026-11-14 Latest Set Daily (FRA) P1P7, original 17Lands trophy draft; server-computed score/reveal from historical completed run',selectedCard:f.answer.selectedName,originalDrafterPick:f.answer.historicalName,score:f.answer.score},null,2)+'\n');
  await browser.close();
}
