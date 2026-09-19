import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {selectDraftRun,selectDraftRunReroll,interestingDraftRunPuzzle,publicDraftRunPuzzle,gradeDraftRunPick} from '../draft-run.mjs';

const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const corpus=fs.readdirSync('corpus/draft-run').filter(f=>f.endsWith('.gz')).flatMap(f=>JSON.parse(gunzipSync(fs.readFileSync('corpus/draft-run/'+f)))).filter(interestingDraftRunPuzzle);
const environment=process.env.PACK1_TEST_ENVIRONMENT||'mixed',cube=environment==='powered-cube';
const selectionVersion=process.env.PACK1_TEST_SELECTION_VERSION||'eight-pick-v3';
const daily=process.env.PACK1_TEST_DAILY==='1';
let shareCalls=0;
let puzzles=selectDraftRun(corpus,'browser-contract',environment,{selectionVersion}),answers=[],revision=0,rerolls=cube?{set:0,pack:2}:{set:1,pack:1};
const sources=puzzles.map(p=>p.source_draft_hash),errors=[],events=[],views=[];
const id='11111111-1111-4111-8111-111111111111',shareId='1234567890abcdef12345678';
const snapshot=()=>({id,environment,leaderboard_eligible:daily,ranked_name:daily?'QA ranked player':null,run_length:puzzles.length,set_reroll_allowed:!daily,day:daily?'2026-09-10':null,revision,round:answers.length+1,answers,rerolls,complete:answers.length===puzzles.length,score:answers.length===puzzles.length?Math.round(answers.reduce((n,a)=>n+a.score,0)/puzzles.length):null,current:answers.length===puzzles.length?null:publicDraftRunPuzzle(puzzles[answers.length]),standing:answers.length===puzzles.length?{rank:1,total:20,percentile:5,final:false}:null});
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
  if(path.endsWith('/share')){shareCalls++;body={id:shareId};}
  else if(path.endsWith('/view')){const req=route.request().postDataJSON();assert.equal(req.revision,revision);assert.equal(req.puzzleId,puzzles[answers.length].puzzle_id);views.push(req);body={ok:true};}
  else if(path.includes('/challenges/')||path.includes('/shared-runs/'))body={id:shareId,name:'Your friend',score:88,environment,run_length:puzzles.length};
  else if(path.endsWith('/reroll')){
    const req=route.request().postDataJSON(),round=answers.length,old=puzzles[round];
    assert.equal(req.revision,revision);assert.equal(req.round,round);assert.ok(rerolls[req.type]>0);
    puzzles[round]=selectDraftRunReroll(corpus,old,{type:req.type,round,seed:'browser-contract',excludedSources:sources,environment,selectionVersion});sources.push(puzzles[round].source_draft_hash);rerolls[req.type]-=1;revision++;body=snapshot();
  }else if(path.endsWith('/pick')){
    const req=route.request().postDataJSON(),p=puzzles[answers.length];assert.equal(req.revision,revision);assert.equal(req.puzzleId,p.puzzle_id);
    assert.equal(req.viewId,views.at(-1).viewId);assert.ok(Number.isInteger(req.activeMs)&&req.activeMs>=0);
    answers.push({...gradeDraftRunPick(p,req.cardId),puzzle:publicDraftRunPuzzle(p),ranking:p.candidates.map(c=>({id:c.id,name:c.name,support:c.model_probability,score:gradeDraftRunPick(p,c.id).score}))});revision++;body=snapshot();
  }else if(path==='/v1/leaderboard')body={rows:[],period:'daily'};
  else body=snapshot();
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
});
async function noOverflow(){const r=await page.evaluate(()=>({w:document.documentElement.clientWidth,s:document.documentElement.scrollWidth}));assert.ok(r.s<=r.w+1,`overflow ${r.s}>${r.w}`);}
try{
  await page.goto(base);
  await page.locator('[data-daily-home]').waitFor();
  await noOverflow();
  if(daily)await page.locator(`[data-environment="${environment}"] a`).click();
  else await page.goto(base+'/?game=draft-run'+(cube?'&set=powered-cube':''));
  await page.locator('.run-cards').waitFor();
  assert.equal(await page.locator('.run-steps li').count(),puzzles.length);assert.equal(await page.locator('.run-pool').count(),cube?1:0);assert.equal(await page.locator('.run-card-score').count(),0);
  assert.doesNotMatch(await page.locator('.run-heading').innerText(),/difficulty/i);
  const displayNames=JSON.parse(fs.readFileSync('data/set-display-names.json','utf8')).names;
  await page.waitForFunction(name=>document.querySelector('.run-heading')?.textContent.includes(name),displayNames[puzzles[0].set_id]);
  assert.equal(await page.locator('#home-editorial').count(),0);
  if(daily){assert.equal(await page.locator('[data-reroll]').count(),0,'No Daily rerolls');assert.equal(await page.locator('.run-ranking-state').innerText(),'Ranked as QA ranked player');}
  if(!daily){
  const originalSet=puzzles[0].set_id;
  if(cube){
    assert.equal(originalSet,'powered-cube');assert.equal(puzzles[0].pick_number,2);
    assert.equal(await page.locator('[data-reroll="set"]').count(),0);
    await page.locator('[data-reroll="pack"]').click();await page.getByRole('button',{name:'Reroll pack · 1',exact:true}).waitFor();
  }else{
    await page.locator('[data-reroll="set"]').click();await page.getByRole('button',{name:'Reroll set · 0',exact:true}).waitFor();
    assert.notEqual(puzzles[0].set_id,originalSet);
  }
  const replacementSet=puzzles[0].set_id;
  await page.locator('[data-reroll="pack"]').click();await page.getByRole('button',{name:'Reroll pack · 0',exact:true}).waitFor();
  assert.equal(puzzles[0].set_id,replacementSet);
  }
  await noOverflow();
  await page.waitForFunction(()=>[...document.querySelectorAll('.run-cards img')].every(img=>img.complete&&img.naturalWidth>0),null,{timeout:30000});
  await page.locator('.run-zoom').first().click();await page.locator('.run-card-dialog').waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
  // Offscreen images can finish loading before asynchronous decoding paints them.
  await page.evaluate(()=>Promise.all([...document.querySelectorAll('.run-cards img')].map(img=>img.decode())));
  assert.equal(await page.locator('.run-cards').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),3);
  await page.locator('.run-card').last().scrollIntoViewIfNeeded();
  const dock=await page.locator('.run-lock').boundingBox();assert.ok(dock.y+dock.height<=845,'Rerolls and lock remain within the viewport');
  await page.screenshot({path:`artifacts/${selectionVersion==='first-pack-v2'?'legacy-':''}ui-${cube?'cube-run':'draft-run'}-mobile-last-row.png`});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`artifacts/${selectionVersion==='first-pack-v2'?'legacy-':''}ui-${cube?'cube-run':'draft-run'}-mobile.png`,fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await noOverflow();await page.screenshot({path:`artifacts/${selectionVersion==='first-pack-v2'?'legacy-':''}ui-${cube?'cube-run':'draft-run'}-desktop.png`,fullPage:true});await page.setViewportSize({width:390,height:844});
  for(let round=0;round<puzzles.length;round++){
    const p=puzzles[round];if(cube)assert.equal(p.set_id,'powered-cube');assert.equal(await page.locator('.run-pool-cards>button').count(),p.pick_number-1);
    const selected=round===0?p.candidates.filter(c=>c.id!==p.historical_pick_id).sort((a,b)=>a.model_probability-b.model_probability)[0].id:p.historical_pick_id;
    await page.locator(`[data-pick="${selected}"]`).click();await page.locator('#run-lock').click();await page.locator('#run-next').waitFor();
    assert.equal(views.at(-1).puzzleId,p.puzzle_id,'Feedback must not record the next decision as viewed');
    assert.match(await page.locator('.run-feedback').innerText(),/100/);
    await page.getByRole('heading',{name:'Model’s strongest choice: '+gradeDraftRunPick(p,p.historical_pick_id).consensusName,exact:true}).waitFor();
    assert.equal(await page.locator('.run-consensus-leaders li').count(),3);
    assert.equal(await page.locator('.run-consensus-leaders li').first().locator('[data-zoom]').getAttribute('data-zoom'),p.historical_pick_id);
    assert.doesNotMatch(await page.locator('.run-consensus-leaders li').first().innerText(),/%/);
    assert.equal(await page.locator('.run-consensus tbody tr').first().locator('td').first().textContent(),'—');
    assert.equal(await page.locator('.run-pack-review').getAttribute('open'),null);assert.equal(answers.length,round+1);
    assert.equal(await page.locator('.run-card-score').count(),0);
    if(round===0){await page.screenshot({path:`artifacts/${selectionVersion==='first-pack-v2'?'legacy-':''}ui-${cube?'cube-run':'draft-run'}-consensus-mobile.png`,fullPage:true});}
    await page.locator('#run-next').click();
    if(round===0){const thumb=await page.locator('.run-pool-cards img').first().boundingBox(),pack=await page.locator('.run-card-select img').first().boundingBox();assert.ok(Math.abs(thumb.width/pack.width-.85)<.03,`Prior picks are about 85% of pack cards: ${thumb.width}/${pack.width}`);assert.equal(await page.locator('.run-pool-cards>button').count(),cube?2:1);await page.reload();await page.locator('.run-cards').waitFor();assert.equal(answers.length,1);}
  }
  await page.locator('.run-result-page').waitFor();assert.equal(await page.locator('.run-image-share,#run-share-image').count(),0);assert.equal(await page.locator('.run-review-list li').count(),puzzles.length);assert.match(await page.locator('.run-final-score').innerText(),new RegExp(String(snapshot().score))); assert.equal(await page.locator('.run-result-actions .button').count(),4);assert.equal(await page.locator('#home-editorial').count(),0);assert.ok(await page.getByRole('button',{name:'View your career',exact:true}).isVisible());await noOverflow();
  await page.screenshot({path:`artifacts/${selectionVersion==='first-pack-v2'?'legacy-':''}ui-${cube?'cube-run':'draft-run'}-result-mobile.png`,fullPage:true});
  await page.locator('#run-share').click();await page.waitForFunction(()=>Boolean(window.__runShare));
  const shared=await page.evaluate(()=>window.__runShare);assert.match(shared.text,new RegExp('🟩{'+(puzzles.length-1)+'}','u'));assert.equal(shared.files,undefined);assert.doesNotMatch(shared.url,/profile|token/);
  if(daily){
    assert.match(shared.text,/Daily 2026-09-10/);assert.match(shared.url,/daily=1/);assert.doesNotMatch(shared.url,/challenge=/);assert.equal(shareCalls,0);
    assert.equal(await page.locator('#run-challenge').count(),0);
  }else{
    assert.match(shared.url,new RegExp('shared='+shareId));
    await page.goto(shared.url);await page.locator('#accept-run-challenge').waitFor();assert.match(await page.locator('.run-invite').innerText(),/Play this run and compare/);await noOverflow();
    await page.screenshot({path:`artifacts/${selectionVersion==='first-pack-v2'?'legacy-':''}ui-${cube?'cube-run':'draft-run'}-invite-mobile.png`,fullPage:true});
  }
  await page.goto(base+'/?game=draft-run&board=daily'+(cube?'&set=powered-cube':''));await page.locator('.run-board').waitFor();
  assert.equal(await page.locator('.run-board-games a').count(),3);
  assert.equal((await page.locator('.run-board-games a.active').innerText()).trim(),cube?'Cube':'Draft Run');
  assert.equal(await page.locator('.run-board-actions .button').count(),2);
  assert.equal(await page.getByRole('link',{name:'Top 3 practice',exact:true}).count(),0);
  assert.doesNotMatch(await page.locator('.run-board').innerText(),/Full Pack|Top 3, Full Pack|Cube boards/i);
  await noOverflow();
  await page.goto(base+'/?legacy-board=1'+(cube?'&set=powered-cube':''));await page.locator('.run-board').waitFor();
  const retiredBoardUrl=new URL(page.url());assert.equal(retiredBoardUrl.searchParams.get('game'),'draft-run');assert.equal(retiredBoardUrl.searchParams.get('board'),'daily');assert.equal(retiredBoardUrl.searchParams.has('legacy-board'),false);
  assert.deepEqual(errors,[]);
  console.log(environment+' '+puzzles.length+'-round browser regression passed:, rerolls, resume, zoom, desktop/mobile, result, share, recipient and leaderboard.');
}finally{await browser.close();}
