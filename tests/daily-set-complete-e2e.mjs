import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';

// A guest's Daily result offers one sign-in handoff, and only on the result
// that completes today's three Dailies according to the Daily status endpoint.
const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const today='2026-10-07',yesterday='2026-10-06';
const id='22222222-2222-4222-8222-222222222222';
const finished=(environment,date=today)=>({date,mode:'draft_run',set_id:environment,score:81,run_id:environment+'-'+date});
const answers=Array.from({length:8},(_,i)=>({puzzle:{set_id:'mkm',puzzle_id:'p'+i},pickNumber:1,selectedName:'Card '+i,historicalMatch:i%2===0,score:i%2===0?100:70}));
const callout='[data-daily-set-complete]';
fs.mkdirSync('artifacts',{recursive:true});

const browser=await chromium.launch({headless:true});
const errors=[];
async function guestPage({clock=today+'T18:00:00Z',install=false,signedIn=false}={}) {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const state={environment:'mixed',day:today,statusDay:today,history:[]};
  if(install)await page.clock.install({time:new Date(clock)});else await page.clock.setFixedTime(new Date(clock));
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(signed=>{
    if(signed)localStorage.setItem('pack1-auth-session-v1','synthetic-session');
    Object.defineProperty(navigator,'share',{configurable:true,value:async value=>{window.__runShare=value;}});
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__runCopied=value;}}});
  },signedIn);
  await page.route('**/*-pack1growth.compute.c-5.us-east-2.aws.neon.tech/**',async route=>{
    const path=new URL(route.request().url()).pathname;let body={ok:true};
    if(path==='/v1/session')body={token:'test-token'};
    if(path==='/v1/account/session')body=signedIn?{user:{id:'synthetic-user'}}:{};
    if(path==='/v1/profile/me')body={player:{display_name:'Guest',claimed:signedIn},summary:{games:0},achievements:[]};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.route('**/*-draftrunapi.compute.c-5.us-east-2.aws.neon.tech/**',async route=>{
    const path=new URL(route.request().url()).pathname;let body;
    if(path==='/v1/daily-status')body={day:state.statusDay,daily_history:state.history,player:{claimed:signedIn},capabilities:signedIn?['account','unlimited_regular_practice']:[],daily_streak:1,ranking_identity:{eligible:false,reason:signedIn?null:'account_required'}};
    else if(path===`/v1/runs/${id}`)body={id,environment:state.environment,day:state.day,leaderboard_eligible:false,ranked_name:null,ranking_identity:{eligible:false,reason:signedIn?null:'account_required'},run_length:8,set_reroll_allowed:false,revision:8,round:9,answers,rerolls:{set:0,pack:0},complete:true,score:85,current:null,standing:null};
    else body={};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  return {page,state};
}
async function openResult(page,state,{environment,history,day=today,statusDay=today}) {
  Object.assign(state,{environment,history,day,statusDay});
  await page.goto(`${base}/?game=draft-run${environment==='mixed'?'':'&set='+environment}&run=${id}`);
  await page.locator('.run-result-page').waitFor();
  // The reset cue is appended after the Daily status read settles.
  await page.locator('.post-game-daily-cue').waitFor();
}
async function noOverflow(page) {
  const r=await page.evaluate(()=>({w:document.documentElement.clientWidth,s:document.documentElement.scrollWidth}));
  assert.ok(r.s<=r.w+1,`overflow ${r.s}>${r.w}`);
}
async function assertHidden(page,message) {
  assert.equal(await page.locator(callout).isVisible(),false,message);
}

try {
  const {page,state}=await guestPage();

  await openResult(page,state,{environment:'mixed',history:[finished('mixed')]});
  await assertHidden(page,'1 of 3 Dailies shows no callout');
  assert.match(await page.locator('.run-ranking-state').innerText(),/Playing as guest\. Sign in to add this score to the leaderboard\./);

  await openResult(page,state,{environment:'powered-cube',history:[finished('mixed'),finished('powered-cube')]});
  await assertHidden(page,'2 of 3 Dailies shows no callout');

  await openResult(page,state,{environment:'latest',history:[finished('mixed'),finished('powered-cube'),finished('latest')]});
  await page.locator(callout).waitFor({state:'visible'});
  assert.equal(await page.locator(callout).count(),1,'one callout on the page');
  assert.equal(await page.locator(`${callout} .eyebrow`).textContent(),'Finished all 3 free dailies');
  assert.equal(await page.locator(`${callout} h2`).textContent(),'Sign in to keep playing with unlimited draft runs.');
  assert.equal(await page.locator(`${callout} h2 + p`).textContent(),'Create a free account to save progress, track stats, and compete on the leaderboard.');
  assert.deepEqual(await page.locator(`${callout} button, ${callout} a`).allTextContents(),['Sign in for unlimited runs'],'one CTA, no dismiss or secondary action');
  assert.doesNotMatch(await page.locator(callout).innerText(),/maybe later|dismiss|not now/i);
  const order=await page.evaluate(()=>{
    const page=document.querySelector('.run-result-page'),nodes=[...page.children];
    const at=selector=>nodes.indexOf(page.querySelector(':scope>'+selector));
    return {guest:at('.run-ranking-state'),callout:at('[data-daily-set-complete]'),actions:at('.run-result-actions')};
  });
  assert.equal(order.callout,order.guest+1,'callout sits directly below the guest message');
  assert.equal(order.actions,order.callout+1,'and directly above the action buttons');
  assert.deepEqual(
    (await page.locator('.run-result-actions .button').allTextContents()).map(text=>text.trim()),
    ['Back to Dailies','Leaderboard','Sign in to add score'],
    'navigation actions are unchanged; sharing moved to its own panel above',
  );

  const desktop=await page.locator(callout).evaluate(node=>{
    const box=node.getBoundingClientRect(),button=node.querySelector('button').getBoundingClientRect(),copy=node.querySelector('div').getBoundingClientRect(),style=getComputedStyle(node);
    return {direction:style.flexDirection,radius:style.borderTopLeftRadius,border:style.borderTopWidth,background:style.backgroundColor,buttonRight:button.right,boxRight:box.right,buttonLeft:button.left,copyRight:copy.right,buttonTop:button.top,copyBottom:copy.bottom};
  });
  assert.equal(desktop.direction,'row','desktop places copy and button side by side');
  assert.ok(desktop.buttonLeft>=desktop.copyRight,'button sits to the right of the copy');
  assert.ok(desktop.buttonTop<desktop.copyBottom,'button shares the copy row');
  assert.equal(desktop.border,'1px');assert.notEqual(desktop.radius,'0px');assert.equal(desktop.background,'rgb(229, 237, 244)');
  await noOverflow(page);
  await page.locator('.run-result-page').evaluate(node=>node.scrollIntoView());
  await page.screenshot({path:'artifacts/ui-daily-set-complete-desktop.png',clip:await page.locator('.run-result-page').evaluate(node=>{const b=node.getBoundingClientRect();return {x:Math.max(0,b.x-24),y:window.scrollY+b.y,width:b.width+48,height:Math.min(b.height,720)};}),fullPage:true});

  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    const mobile=await page.locator(callout).evaluate(node=>{
      const box=node.getBoundingClientRect(),button=node.querySelector('button').getBoundingClientRect(),copy=node.querySelector('div').getBoundingClientRect();
      return {direction:getComputedStyle(node).flexDirection,buttonTop:button.top,copyBottom:copy.bottom,buttonWidth:button.width,inner:box.width-32,scroll:node.scrollWidth,client:node.clientWidth};
    });
    assert.equal(mobile.direction,'column',`${width}px stacks the callout`);
    assert.ok(mobile.buttonTop>=mobile.copyBottom,`${width}px places the button below the copy`);
    assert.ok(Math.abs(mobile.buttonWidth-mobile.inner)<=2,`${width}px button spans the callout`);
    assert.ok(mobile.scroll<=mobile.client,`${width}px callout content does not overflow`);
    await noOverflow(page);
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'artifacts/ui-daily-set-complete-mobile.png',fullPage:true});

  // Existing actions keep working beside the callout.
  assert.equal(await page.locator('[data-next-daily-action]').getAttribute('href'),'./');
  assert.equal(await page.getByRole('link',{name:'Leaderboard',exact:true}).getAttribute('href'),'?game=draft-run&set=latest&board=daily');
  await page.locator('#run-share').click();await page.waitForFunction(()=>Boolean(window.__runShare));
  await page.locator('#run-copy-result').click();await page.waitForFunction(()=>Boolean(window.__runCopied));
  await page.locator(callout).waitFor({state:'visible'});

  await page.getByRole('button',{name:'Sign in for unlimited runs',exact:true}).click();
  await page.getByRole('heading',{name:'Add your score to the leaderboard.',exact:true}).waitFor();
  assert.ok(await page.locator('#account-form, form').first().isVisible(),'the existing account form opens');

  await openResult(page,state,{environment:'latest',history:[finished('mixed'),finished('powered-cube'),finished('latest')]});
  await page.locator(callout).waitFor({state:'visible'});
  await page.locator('#run-career').click();
  await page.getByRole('heading',{name:'Add your score to the leaderboard.',exact:true}).waitFor();

  // Any completion order counts, and the result on screen counts even if the
  // history read is briefly behind its final write.
  await openResult(page,state,{environment:'mixed',history:[finished('latest'),finished('powered-cube'),finished('mixed')]});
  await page.locator(callout).waitFor({state:'visible'});
  await openResult(page,state,{environment:'powered-cube',history:[finished('latest'),finished('mixed')]});
  await page.locator(callout).waitFor({state:'visible'});

  // Yesterday's set never carries into today.
  await openResult(page,state,{environment:'latest',history:[finished('mixed',yesterday),finished('powered-cube',yesterday),finished('latest')]});
  await assertHidden(page,'yesterday\'s Dailies do not complete today\'s set');
  await openResult(page,state,{environment:'latest',day:yesterday,history:[finished('mixed'),finished('powered-cube'),finished('latest')]});
  await assertHidden(page,'a previous day\'s result never shows the callout');
  await openResult(page,state,{environment:'latest',history:[finished('mixed'),finished('powered-cube'),finished('latest')],statusDay:yesterday});
  await assertHidden(page,'a stale status day never shows the callout');

  // Unavailable status leaves the result without the callout.
  await page.route('**/*-draftrunapi.compute.c-5.us-east-2.aws.neon.tech/v1/daily-status',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'}),{times:1});
  await openResult(page,state,{environment:'latest',history:[finished('mixed'),finished('powered-cube'),finished('latest')]});
  await assertHidden(page,'failed status shows no callout');
  await page.close();

  const signed=await guestPage({signedIn:true});
  await openResult(signed.page,signed.state,{environment:'latest',history:[finished('mixed'),finished('powered-cube'),finished('latest')]});
  assert.equal(await signed.page.locator(callout).count(),0,'signed-in players never get the guest callout');
  assert.match(await signed.page.locator('.run-ranking-state').innerText(),/Signed in\./);
  await signed.page.close();

  // A result left open across Pacific midnight drops the callout at the reset.
  const late=await guestPage({clock:'2026-10-08T06:59:00Z',install:true});
  await openResult(late.page,late.state,{environment:'latest',history:[finished('mixed'),finished('powered-cube'),finished('latest')]});
  await late.page.locator(callout).waitFor({state:'visible'});
  await late.page.clock.fastForward('02:00');
  await late.page.locator(callout).waitFor({state:'hidden'});
  await late.page.close();

  assert.deepEqual(errors,[]);
  console.log('Guest daily-set-complete callout passed: 1/3, 2/3, 3/3, any order, signed in, reset, CTA, desktop/mobile.');
} finally {await browser.close();}
