import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {selectDraftRun,selectDraftRunReroll,interestingDraftRunPuzzle,publicDraftRunPuzzle,gradeDraftRunPick} from '../draft-run.mjs';

const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const corpus=fs.readdirSync('corpus/draft-run').filter(f=>f.endsWith('.gz')).flatMap(f=>JSON.parse(gunzipSync(fs.readFileSync('corpus/draft-run/'+f)))).filter(interestingDraftRunPuzzle);
let puzzles=selectDraftRun(corpus,'browser-contract'),answers=[],revision=0,rerolls={set:1,pack:1};
const sources=puzzles.map(p=>p.source_draft_hash),errors=[],events=[];
const id='11111111-1111-4111-8111-111111111111',shareId='1234567890abcdef12345678';
const snapshot=()=>({id,day:'2026-09-10',revision,round:answers.length+1,answers,rerolls,complete:answers.length===10,score:answers.length===10?Math.round(answers.reduce((n,a)=>n+a.score,0)/10):null,current:answers.length===10?null:publicDraftRunPuzzle(puzzles[answers.length]),standing:answers.length===10?{rank:1,total:20,percentile:5,final:false}:null});
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:async value=>{window.__runShare=value;}});Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false});});
await page.route('**/*-pack1growth.compute.c-5.us-east-2.aws.neon.tech/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body={ok:true};
  if(path==='/v1/session')body={token:'test-token'};
  if(path==='/v1/events'){events.push(...(route.request().postDataJSON().events||[]));}
  if(path==='/v1/profile/me')body={player:{display_name:'Test Guest',claimed:false},summary:{games:0},achievements:[]};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
});
await page.route('**/*-draftrunapi.compute.c-5.us-east-2.aws.neon.tech/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body;
  if(path.endsWith('/share'))body={id:shareId};
  else if(path.includes('/challenges/'))body={id:shareId,name:'Your friend',score:88};
  else if(path.endsWith('/reroll')){
    const req=route.request().postDataJSON(),round=answers.length,old=puzzles[round];
    assert.equal(req.revision,revision);assert.equal(req.round,round);assert.equal(rerolls[req.type],1);
    puzzles[round]=selectDraftRunReroll(corpus,old,{type:req.type,round,seed:'browser-contract',excludedSources:sources});sources.push(puzzles[round].source_draft_hash);rerolls[req.type]=0;revision++;body=snapshot();
  }else if(path.endsWith('/pick')){
    const req=route.request().postDataJSON(),p=puzzles[answers.length];assert.equal(req.revision,revision);assert.equal(req.puzzleId,p.puzzle_id);
    answers.push({...gradeDraftRunPick(p,req.cardId),puzzle:publicDraftRunPuzzle(p),ranking:p.candidates.map(c=>({id:c.id,name:c.name,score:gradeDraftRunPick(p,c.id).score}))});revision++;body=snapshot();
  }else if(path==='/v1/leaderboard')body={rows:[],period:'daily'};
  else body=snapshot();
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
});
async function noOverflow(){const r=await page.evaluate(()=>({w:document.documentElement.clientWidth,s:document.documentElement.scrollWidth}));assert.ok(r.s<=r.w+1,`overflow ${r.s}>${r.w}`);}
try{
  await page.goto(base);await page.locator('.draft-run-feature').waitFor();
  assert.ok(await page.getByRole('link',{name:'Play today’s Draft Run',exact:true}).isVisible());
  assert.equal(await page.locator('.cube-mode-section #set-select').count(),0);
  assert.equal(await page.locator('.mode-section:not(.cube-mode-section) #set-select').count(),1);
  assert.equal(await page.locator('[data-ad-slot="home"]').isVisible(),false);
  await noOverflow();await page.screenshot({path:'artifacts/ui-draft-run-home-mobile.png',fullPage:true});
  await page.getByRole('link',{name:'Play today’s Draft Run',exact:true}).click();await page.locator('.run-cards').waitFor();
  assert.equal(await page.locator('.run-pool').count(),0);assert.equal(await page.locator('.run-card-score').count(),0);
  assert.equal(await page.locator('#home-editorial').isVisible(),false);
  const originalSet=puzzles[0].set_id;await page.locator('[data-reroll="set"]').click();await page.getByRole('button',{name:'New set · 0',exact:true}).waitFor();
  assert.notEqual(puzzles[0].set_id,originalSet);const replacementSet=puzzles[0].set_id;
  await page.locator('[data-reroll="pack"]').click();await page.getByRole('button',{name:'New pack · 0',exact:true}).waitFor();
  assert.equal(puzzles[0].set_id,replacementSet);await noOverflow();
  await page.waitForFunction(()=>[...document.querySelectorAll('.run-cards img')].every(img=>img.complete&&img.naturalWidth>0),null,{timeout:30000});
  await page.locator('.run-zoom').first().click();await page.locator('.run-card-dialog').waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
  // Offscreen images can finish loading before asynchronous decoding paints them.
  await page.evaluate(()=>Promise.all([...document.querySelectorAll('.run-cards img')].map(img=>img.decode())));
  await page.locator('.run-card').last().scrollIntoViewIfNeeded();
  await page.screenshot({path:'artifacts/ui-draft-run-mobile-last-row.png'});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'artifacts/ui-draft-run-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await noOverflow();await page.screenshot({path:'artifacts/ui-draft-run-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});
  for(let round=0;round<10;round++){
    const p=puzzles[round];assert.equal(await page.locator('.run-pool-cards>button').count(),p.pick_number-1);
    await page.locator(`[data-pick="${p.historical_pick_id}"]`).click();await page.locator('#run-lock').click();await page.locator('#run-next').waitFor();
    assert.match(await page.locator('.run-feedback').innerText(),/100/);assert.equal(answers.length,round+1);
    await page.locator('#run-next').click();
    if(round===0){assert.equal(await page.locator('.run-pool-cards>button').count(),1);await page.reload();await page.locator('.run-cards').waitFor();assert.equal(answers.length,1);}
  }
  await page.locator('.run-result-page').waitFor();assert.match(await page.locator('.run-final-score').innerText(),/100/);await noOverflow();
  await page.screenshot({path:'artifacts/ui-draft-run-result-mobile.png',fullPage:true});
  await page.locator('#run-challenge').click();await page.waitForFunction(()=>Boolean(window.__runShare));
  const shared=await page.evaluate(()=>window.__runShare);assert.match(shared.url,new RegExp('challenge='+shareId));assert.doesNotMatch(shared.url,/profile|token/);
  await page.goto(shared.url);await page.locator('#accept-run-challenge').waitFor();assert.match(await page.locator('.run-invite').innerText(),/Can you beat 88/);await noOverflow();
  await page.screenshot({path:'artifacts/ui-draft-run-invite-mobile.png',fullPage:true});
  await page.goto(base+'/?game=draft-run&board=daily');await page.locator('.run-board').waitFor();await noOverflow();
  assert.deepEqual(errors,[]);
  console.log('Draft Run browser regression passed: 10 rounds, rerolls, resume, zoom, desktop/mobile, result, share, recipient and leaderboard.');
}finally{await browser.close();}
