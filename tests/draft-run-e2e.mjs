import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {selectDraftRun,selectDraftRunReroll,interestingDraftRunPuzzle,publicDraftRunPuzzle,gradeDraftRunPick,calibratedSupports,supportSharpening} from '../draft-run.mjs';
import {rateDraftRunPuzzle} from '../draft-run-difficulty.mjs';

const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const corpus=fs.readdirSync('corpus/draft-run').filter(f=>f.endsWith('.gz')).flatMap(f=>JSON.parse(gunzipSync(fs.readFileSync('corpus/draft-run/'+f)))).filter(interestingDraftRunPuzzle);
const environment=process.env.PACK1_TEST_ENVIRONMENT||'mixed',cube=environment==='powered-cube';
const selectionVersion=process.env.PACK1_TEST_SELECTION_VERSION||'eight-pick-v3';
const daily=process.env.PACK1_TEST_DAILY==='1';
let shareCalls=0,eliteAccess=false,adGoogle=0,adMembership=0,runStarts=[];
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
  if(path==='/v1/patreon/status')adMembership++;
  if(path==='/v1/events'){events.push(...(route.request().postDataJSON().events||[]));}
  if(path==='/v1/profile/me')body={player:{display_name:'Test Guest',claimed:false},summary:{games:0},achievements:[]};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
});
await page.route('**/*-draftrunapi.compute.c-5.us-east-2.aws.neon.tech/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body;
  if(path==='/v1/runs'&&route.request().method()==='POST'){runStarts.push(route.request().postDataJSON());body=snapshot();}
  else if(path.endsWith('/share')){shareCalls++;body={id:shareId};}
  else if(path.endsWith('/view')){const req=route.request().postDataJSON();assert.equal(req.revision,revision);assert.equal(req.puzzleId,puzzles[answers.length].puzzle_id);views.push(req);body={ok:true};}
  else if(path.includes('/challenges/')||path.includes('/shared-runs/'))body={id:shareId,name:'Your friend',score:88,environment,run_length:puzzles.length};
  else if(path.endsWith('/reroll')){
    const req=route.request().postDataJSON(),round=answers.length,old=puzzles[round];
    assert.equal(req.revision,revision);assert.equal(req.round,round);assert.ok(rerolls[req.type]>0);
    puzzles[round]=selectDraftRunReroll(corpus,old,{type:req.type,round,seed:'browser-contract',excludedSources:sources,environment,selectionVersion});sources.push(puzzles[round].source_draft_hash);rerolls[req.type]-=1;revision++;body=snapshot();
  }else if(path.endsWith('/pick')){
    const req=route.request().postDataJSON(),p=puzzles[answers.length];assert.equal(req.revision,revision);assert.equal(req.puzzleId,p.puzzle_id);
    assert.equal(req.viewId,views.at(-1).viewId);assert.ok(Number.isInteger(req.activeMs)&&req.activeMs>=0);
    const grade=gradeDraftRunPick(p,req.cardId),evidence=rateDraftRunPuzzle(p),calibrated=calibratedSupports(p.candidates,supportSharpening(p.corpus_version));
    grade.modelTargetDisagreement=evidence.modelTargetDisagreement;
    answers.push({...grade,puzzle:publicDraftRunPuzzle(p),ranking:[...p.candidates].sort((a,b)=>b.model_probability-a.model_probability).map(c=>({id:c.id,name:c.name,support:calibrated.get(c.id),score:gradeDraftRunPick(p,c.id).score}))});revision++;body=snapshot();
  }else if(path==='/v1/daily-status')body=eliteAccess?{player:{claimed:true},capabilities:['account','custom_corpus','unlimited_cube_practice']}:{player:{claimed:false},capabilities:[]};
  else if(path==='/v1/leaderboard')body={rows:[],period:'daily'};
  else body=snapshot();
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
});
async function noOverflow(){const r=await page.evaluate(()=>({w:document.documentElement.clientWidth,s:document.documentElement.scrollWidth}));assert.ok(r.s<=r.w+1,`overflow ${r.s}>${r.w}`);}
try{
  await page.goto(base);
  await page.locator('[data-daily-home]').waitFor();
  await noOverflow();
  await page.route('**/ad-config.js',route=>route.fulfill({contentType:'text/javascript',body:"window.PACKONE_ADSENSE={enabled:true,client:'ca-pub-fixture',slots:{home:'1543495960',articleTop:'',articleInline:''}};"}));
  await page.route('https://pagead2.googlesyndication.com/**',route=>{adGoogle++;return route.fulfill({contentType:'text/javascript',body:''});});
  for(const host of ['googleads.g.doubleclick.net','tpc.googlesyndication.com','fundingchoicesmessages.google.com'])await page.route('https://'+host+'/**',route=>{adGoogle++;return route.abort();});
  if(daily)await page.locator(`[data-environment="${environment}"] a`).click();
  else await page.goto(base+'/?game=draft-run'+(cube?'&set=powered-cube':''));
  await page.locator('.run-cards').waitFor();
  assert.equal(await page.locator('[data-ad-slot="home"]').count(),1,'game shell retains the dormant static slot');
  assert.equal(await page.locator('[data-ad-slot="home"]:visible').count(),0,'game view never exposes the home ad slot');
  assert.equal(adGoogle,0,'enabled mock still makes no Google request in gameplay');
  assert.equal(adMembership,0,'gameplay is rejected before membership lookup');
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
  const zoomTarget=await page.locator('.run-zoom').first().boundingBox();assert.ok(zoomTarget&&zoomTarget.height>=43.5,'Enlarge control meets the 44px target');
  if(!daily){const rerollTarget=await page.locator('.run-lock .run-tools .button').first().boundingBox();assert.ok(rerollTarget&&rerollTarget.height>=43.5,'Reroll control meets the 44px target');}
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
  const weakChoice=puzzles[0].candidates.filter(c=>c.id!==puzzles[0].historical_pick_id).sort((a,b)=>gradeDraftRunPick(puzzles[0],a.id).score-gradeDraftRunPick(puzzles[0],b.id).score)[0];
  assert.ok(weakChoice&&gradeDraftRunPick(puzzles[0],weakChoice.id).score<60,'round one fixture provides a weak non-match');
  assert.equal(rateDraftRunPuzzle(puzzles[0]).modelTargetDisagreement,false,'browser weak-state fixture is not the rare target-disagreement case');
  const exerciseStrong=!daily&&!cube&&selectionVersion==='eight-pick-v3';
  const strongRound=exerciseStrong?puzzles.findIndex((p,i)=>i>0&&!rateDraftRunPuzzle(p).modelTargetDisagreement&&p.candidates.some(c=>c.id!==p.historical_pick_id&&gradeDraftRunPick(p,c.id).score>=85)):-1;
  if(exerciseStrong)assert.ok(strongRound>0,'default browser fixture provides a strong supported alternative after round one');
  const strongChoice=strongRound>0?puzzles[strongRound].candidates.filter(c=>c.id!==puzzles[strongRound].historical_pick_id&&gradeDraftRunPick(puzzles[strongRound],c.id).score>=85).sort((a,b)=>gradeDraftRunPick(puzzles[strongRound],b.id).score-gradeDraftRunPick(puzzles[strongRound],a.id).score)[0]:null;
  for(let round=0;round<puzzles.length;round++){
    const p=puzzles[round];if(cube)assert.equal(p.set_id,'powered-cube');assert.equal(await page.locator('.run-pool-cards>button').count(),p.pick_number-1);
    const selected=round===0?weakChoice.id:round===strongRound?strongChoice.id:p.historical_pick_id;
    const expectedGrade=gradeDraftRunPick(p,selected);
    await page.locator(`[data-pick="${selected}"]`).click();await page.locator('#run-lock').click();await page.locator('#run-next').waitFor();
    assert.equal(views.at(-1).puzzleId,p.puzzle_id,'Feedback must not record the next decision as viewed');
    assert.equal(Number.parseInt(await page.locator('.run-feedback-score').innerText(),10),expectedGrade.score,'visible pick score matches gradeDraftRunPick');
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'run-feedback-result','locked result receives deterministic focus');
    assert.equal(await page.locator('.run-analysis').getAttribute('open'),null,'analysis stays collapsed by default');
    assert.equal(await page.locator('.run-pack-review').getAttribute('open'),null,'pack review stays collapsed by default');
    assert.equal(await page.locator('.run-card-shop:visible').count(),0,'affiliate links stay out of the compact default result');
    const domOrder=await page.evaluate(()=>{
      const next=document.querySelector('#run-next'),analysis=document.querySelector('.run-analysis'),pack=document.querySelector('.run-pack-review');
      return Boolean(next&&analysis&&pack&&(next.compareDocumentPosition(analysis)&Node.DOCUMENT_POSITION_FOLLOWING)&&(analysis.compareDocumentPosition(pack)&Node.DOCUMENT_POSITION_FOLLOWING));
    });
    assert.equal(domOrder,true,'continuation precedes analysis and pack review in DOM order');
    if(expectedGrade.historicalMatch){
      assert.match(await page.locator('.run-feedback-copy').innerText(),/You matched the trophy drafter\./);
      assert.equal(await page.locator('.run-trophy-thumb').count(),0,'trophy matches do not repeat a card thumbnail');
      assert.equal(await page.locator('.run-feedback-copy p').count(),0,'trophy match needs no filler sentence');
    }else{
      assert.equal(await page.locator('.run-trophy-thumb').count(),1,'non-match shows one compact trophy thumbnail');
      assert.equal(await page.locator('.run-feedback-copy p').count(),1,'compact non-match has at most one explanatory sentence');
      const chosenName=p.candidates.find(c=>c.id===selected)?.name;
      const compactCopy=await page.locator('.run-feedback-copy p').innerText();
      assert.ok(chosenName&&compactCopy.includes(`You chose ${chosenName}`),'compact reveal names the player’s chosen card');
      assert.ok((await page.locator('#run-feedback-result').getAttribute('aria-label'))?.includes(`You chose ${chosenName}`),'accessible result label names the player’s chosen card');
      assert.doesNotMatch(await page.locator('.run-feedback').innerText(),/Model’s strongest|leading model support|partial credit/i);
      if(round===0)assert.match(compactCopy,/less support/);
      if(round===strongRound)assert.match(await page.locator('.run-feedback-copy p').innerText(),/strongly supported alternative/);
      const wordCount=(await page.locator('.run-feedback').innerText()).trim().split(/\s+/).length;
      assert.ok(wordCount<45,`compact reveal remains short (${wordCount} words)`);
    }
    if(round===0){
      const feedbackBox=await page.locator('.run-feedback').boundingBox();assert.ok(feedbackBox&&feedbackBox.height<280,`compact mobile result stays under 280px (${feedbackBox?.height})`);
      const prefix=`artifacts/${selectionVersion==='first-pack-v2'?'legacy-':''}ui-${cube?'cube-run':'draft-run'}`;
      await page.screenshot({path:`${prefix}-reveal-mobile.png`});
      await page.setViewportSize({width:1440,height:1000});await noOverflow();
      await page.screenshot({path:`${prefix}-reveal-desktop.png`});
      await page.setViewportSize({width:390,height:844});await noOverflow();
    }
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.id),'run-next','Next pick is the next Tab stop after the focused result');
    await page.locator('.run-analysis>summary').click();
    await page.getByRole('heading',{name:'Model’s strongest choice: '+expectedGrade.consensusName,exact:true}).waitFor();
    assert.equal(await page.locator('.run-consensus-leaders li').count(),3);
    assert.equal(await page.locator('.run-consensus-leaders li').first().locator('[data-zoom]').getAttribute('data-zoom'),p.historical_pick_id);
    assert.doesNotMatch(await page.locator('.run-consensus-leaders li').first().innerText(),/%/);
    assert.equal(await page.locator('.run-consensus tbody tr').first().locator('td').first().textContent(),'—');
    assert.equal(await page.locator('.run-consensus details').count(),0,'analysis does not retain a nested comparison disclosure');
    const shops=page.locator('.run-analysis .run-card-shop');
    assert.ok(await shops.count()>=1,'revealed-card commerce links remain in analysis');
    assert.equal(await shops.first().getAttribute('rel'),'sponsored noopener');
    assert.equal(await shops.first().getAttribute('data-tcgplayer-surface'),'draft_run_reveal');
    assert.match(await shops.first().getAttribute('href'),/^https:\/\/partner\.tcgplayer\.com\//);
    if(round===0){
      const beforeClicks=events.filter(event=>event.name==='tcgplayer_click').length;
      await shops.first().evaluate(el=>{el.addEventListener('click',event=>event.preventDefault(),{once:true});el.click();});
      for(let i=0;i<30&&events.filter(event=>event.name==='tcgplayer_click').length===beforeClicks;i++)await page.waitForTimeout(50);
      const commerce=events.filter(event=>event.name==='tcgplayer_click').at(-1);
      assert.ok(commerce,'TCGplayer reveal click is instrumented');
      assert.equal(commerce.props.surface,'draft_run_reveal');
      await page.locator('.run-consensus').scrollIntoViewIfNeeded();
      await page.screenshot({path:`artifacts/${selectionVersion==='first-pack-v2'?'legacy-':''}ui-${cube?'cube-run':'draft-run'}-consensus-mobile.png`});
    }
    assert.equal(answers.length,round+1);
    assert.equal(await page.locator('.run-card-score').count(),0);
    await page.locator('#run-next').click();
    if(round===0){const thumb=await page.locator('.run-pool-cards img').first().boundingBox(),pack=await page.locator('.run-card-select img').first().boundingBox();assert.ok(Math.abs(thumb.width/pack.width-.85)<.03,`Prior picks are about 85% of pack cards: ${thumb.width}/${pack.width}`);assert.equal(await page.locator('.run-pool-cards>button').count(),cube?2:1);await page.reload();await page.locator('.run-cards').waitFor();assert.equal(answers.length,1);}
  }
  await page.locator('.run-result-page').waitFor();assert.equal(await page.locator('.run-image-share,#run-share-image').count(),0);assert.equal(await page.locator('.run-review-list li').count(),puzzles.length);assert.match(await page.locator('.run-final-score').innerText(),new RegExp(String(snapshot().score))); assert.equal(await page.locator('.run-result-actions .button').count(),4);assert.equal(await page.locator('#home-editorial').count(),0);assert.ok(await page.getByRole('button',{name:'View your career',exact:true}).isVisible());assert.equal(await page.locator('.run-result-page .run-note').evaluate(el=>getComputedStyle(el).marginTop),'24px','result footnote retains its spacing');await noOverflow();
  assert.equal((await page.locator('.run-result-actions .button').first().textContent())?.trim(),daily?'Back to Dailies':cube?'Start Another Powered Cube Run':'Start Another Draft Run');
  const actionStyles=await page.locator('.run-result-actions .button').evaluateAll(nodes=>nodes.map(node=>{const style=getComputedStyle(node);return [style.display,style.alignItems,style.justifyContent];}));
  assert.ok(actionStyles.every(([display,align,justify])=>display==='flex'&&align==='center'&&justify==='center'),'Result actions use the same centered layout');
  await page.screenshot({path:`artifacts/${selectionVersion==='first-pack-v2'?'legacy-':''}ui-${cube?'cube-run':'draft-run'}-result-mobile.png`,fullPage:true});
  await page.locator('#run-share').click();await page.waitForFunction(()=>Boolean(window.__runShare));
  assert.equal((await page.locator('#run-share-status').textContent())?.trim(),'');
  const shared=await page.evaluate(()=>window.__runShare);const expectedSquares=answers.map(a=>a.historicalMatch?'🟩':a.score>=85?'🟦':a.score>=60?'🟨':a.score>=25?'🟧':'⬛').join('');assert.ok(shared.text.includes(expectedSquares),'share text reflects the answers exercised by this browser run');assert.equal(shared.files,undefined);assert.doesNotMatch(shared.url,/profile|token/);
  if(daily){
    assert.match(shared.text,/Daily 2026-09-10/);assert.match(shared.url,/daily=1/);assert.match(shared.url,/ref=result_share/);assert.doesNotMatch(shared.url,/challenge=/);assert.equal(shareCalls,0);
    assert.equal(await page.locator('#run-challenge').count(),0);
    await page.goto(shared.url);
    await page.waitForFunction(()=>!new URL(location.href).searchParams.has('ref'));
    await page.waitForFunction(()=>Boolean(new URL(location.href).searchParams.get('run')));
    assert.equal(runStarts.at(-1).source,'result_share');
    for(let i=0;i<30&&!events.some(event=>event.name==='daily_share_arrival');i++)await page.waitForTimeout(100);
    const arrivals=events.filter(event=>event.name==='daily_share_arrival');
    assert.equal(arrivals.length,1);assert.equal(arrivals[0].props.source,'result_share');assert.equal(arrivals[0].props.daily,true);
  }else{
    assert.match(shared.url,new RegExp('shared='+shareId));
    await page.goto(shared.url);await page.locator('#accept-run-challenge').waitFor();assert.match(await page.locator('.run-invite').innerText(),/Play this run and compare/);await noOverflow();
    await page.screenshot({path:`artifacts/${selectionVersion==='first-pack-v2'?'legacy-':''}ui-${cube?'cube-run':'draft-run'}-invite-mobile.png`,fullPage:true});
  }
  await page.goto(base+'/?game=draft-run&board=daily'+(cube?'&set=powered-cube':''));await page.locator('.run-board').waitFor();
  assert.equal(await page.locator('.run-board-games a').count(),3);
  assert.equal((await page.locator('.run-board-games a.active').innerText()).trim(),cube?'Cube':'Draft Run');
  assert.equal(await page.locator('.run-board-actions .button').count(),2);
  assert.equal((await page.locator('.run-board-actions .button').nth(1).textContent())?.trim(),'Practice a Draft Run');
  const boardActionStyles=await page.locator('.run-board-actions .button').evaluateAll(nodes=>nodes.map(node=>{const style=getComputedStyle(node);return [style.display,style.alignItems,style.justifyContent];}));
  assert.ok(boardActionStyles.every(([display,align,justify])=>display==='flex'&&align==='center'&&justify==='center'),'Leaderboard actions use the same centered layout');
  assert.equal(await page.getByRole('link',{name:'Top 3 practice',exact:true}).count(),0);
  assert.doesNotMatch(await page.locator('.run-board').innerText(),/Full Pack|Top 3, Full Pack|Cube boards/i);
  await noOverflow();

  eliteAccess=false;
  await page.goto(base+'/?game=draft-run&set=latest&board=daily');await page.locator('.run-board').waitFor();
  assert.equal(await page.getByRole('link',{name:'Practice a Draft Run',exact:true}).getAttribute('href'),'?game=draft-run');
  assert.equal(await page.getByRole('link',{name:'Choose sets for practice',exact:true}).count(),0);
  eliteAccess=true;
  await page.goto(base+'/?game=draft-run&set=latest&board=daily');await page.locator('.run-board').waitFor();
  assert.equal(await page.getByRole('link',{name:'Choose sets for practice',exact:true}).getAttribute('href'),'?game=draft-run&custom=1');

  await page.goto(base+'/?legacy-board=1'+(cube?'&set=powered-cube':''));await page.locator('.run-board').waitFor();
  const retiredBoardUrl=new URL(page.url());assert.equal(retiredBoardUrl.searchParams.get('game'),'draft-run');assert.equal(retiredBoardUrl.searchParams.get('board'),'daily');assert.equal(retiredBoardUrl.searchParams.has('legacy-board'),false);
  assert.deepEqual(errors,[]);
  console.log(environment+' '+puzzles.length+'-round browser regression passed:, rerolls, resume, zoom, desktop/mobile, result, share, recipient and leaderboard.');
}finally{await browser.close();}
