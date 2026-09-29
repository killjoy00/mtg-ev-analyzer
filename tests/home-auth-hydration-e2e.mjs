import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
const user={id:'22222222-2222-4222-8222-222222222222',email:'qa@example.invalid',name:'QA Player'};

async function fixture({auth='guest',claimed=false,complete=false,holdAuth=false,holdDaily=false,dailyFailure=false,width=1000}={}) {
  const context=await browser.newContext({viewport:{width,height:800}});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const state={auth,claimed,complete,dailyFailure};
  let releaseAuth=()=>{},releaseDaily=()=>{};
  const authGate=holdAuth?new Promise(resolve=>releaseAuth=resolve):Promise.resolve();
  const dailyGate=holdDaily?new Promise(resolve=>releaseDaily=resolve):Promise.resolve();

  await page.addInitScript(()=>{
    const OriginalDate=Date;const now=OriginalDate.parse('2026-09-28T19:00:00Z');
    window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  });
  if(auth!=='guest') {
    await page.addInitScript(()=>localStorage.setItem('pack1-auth-session-v1','auth-fixture'));
  }

  await page.route('https://**-pack1growth.compute.c-5.us-east-2.aws.neon.tech/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let status=200,body={ok:true};
    if(path==='/v1/session')body={token:'guest-fixture'};
    else if(path==='/v1/account/session') {
      await authGate;
      if(state.auth==='signed-in')body={session:{token:'auth-fixture'},user};
      else if(state.auth==='expired'){status=401;body={error:'Expired session'};}
      else if(state.auth==='failure'){status=503;body={error:'Account unavailable'};}
      else {status=401;body={error:'Signed out'};}
    } else if(path==='/v1/events')body={ok:true};
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });

  await page.route('https://**-draftrunapi.compute.c-5.us-east-2.aws.neon.tech/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path!=='/v1/daily-status')return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Not found'})});
    await dailyGate;
    if(state.dailyFailure)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Daily unavailable'})});
    const daily_history=state.complete?[{date:'2026-09-28',mode:'draft_run',set_id:'mixed',score:91}]:[];
    await route.fulfill({contentType:'application/json',body:JSON.stringify({
      capabilities:state.claimed?['account']:[],
      player:{claimed:state.claimed},
      membership:{connected:false},
      daily_history,
      daily_streak:state.claimed?3:0,
    })});
  });

  return {context,page,errors,state,releaseAuth,releaseDaily};
}

try {
  // Returning members keep the signed-in nav geometry while both remote reads
  // are slow, and completed Dailies are unknown rather than falsely unplayed.
  {
    const f=await fixture({auth:'signed-in',claimed:true,complete:true,holdAuth:true,holdDaily:true});
    await f.page.goto(base);
    await f.page.locator('[data-home-state="checking"]').waitFor();
    assert.equal((await f.page.locator('#account-nav').textContent())?.trim(),'Account');
    assert.equal(await f.page.locator('#how-nav').isHidden(),true);
    assert.equal(await f.page.locator('.daily-home-game.is-unplayed').count(),0);
    assert.equal(await f.page.locator('.daily-home-game.is-pending').count(),3);
    assert.doesNotMatch((await f.page.locator('.daily-home').textContent())||'',/Start here|Free · No account required/);
    const before=await f.page.locator('.top-actions').boundingBox();

    f.releaseAuth();f.releaseDaily();
    await f.page.waitForFunction(()=>document.querySelector('#account-nav')?.dataset.accountState==='signed-in');
    await f.page.locator('[data-home-state="ready"]').waitFor();
    assert.equal((await f.page.locator('#account-nav').textContent())?.trim(),'My Pack One');
    const after=await f.page.locator('.top-actions').boundingBox();
    assert.ok(before&&after&&Math.abs(before.width-after.width)<1,'returning-member nav width changed during hydration');
    const titles=await f.page.locator('.daily-home-game h2').allTextContents();
    assert.deepEqual(titles,['Daily Draft Run','Daily Powered Cube','Daily Latest Set']);
    assert.equal(await f.page.locator('.daily-home-game').first().getAttribute('class').then(value=>String(value).includes('is-complete')),true);
    assert.deepEqual(f.errors,[]);
    await f.context.close();
  }

  // A genuine guest gets guest affordances only after Daily status is known.
  {
    const f=await fixture({auth:'guest',claimed:false,holdDaily:true,width:390});
    await f.page.goto(base);
    await f.page.locator('[data-home-state="checking"]').waitFor();
    assert.doesNotMatch((await f.page.locator('.daily-home').textContent())||'',/Start here|Free · No account required/);
    f.releaseDaily();
    await f.page.locator('[data-home-state="ready"]').waitFor();
    assert.equal((await f.page.locator('#account-nav').textContent())?.trim(),'Sign in');
    assert.match((await f.page.locator('.daily-home').textContent())||'',/Start here/);
    assert.match((await f.page.locator('.daily-home').textContent())||'',/Free · No account required/);
    assert.deepEqual(f.errors,[]);
    await f.context.close();
  }

  // An expired credential is a real signed-out state, not an infrastructure error.
  {
    const f=await fixture({auth:'expired',claimed:false});
    await f.page.goto(base);
    await f.page.waitForFunction(()=>document.querySelector('#account-nav')?.dataset.accountState==='signed-out');
    await f.page.locator('[data-home-state="ready"]').waitFor();
    assert.equal((await f.page.locator('#account-nav').textContent())?.trim(),'Sign in');
    assert.equal(await f.page.evaluate(()=>localStorage.getItem('pack1-auth-session-v1')),null);
    assert.deepEqual(f.errors,[]);
    await f.context.close();
  }

  // Infrastructure failures remain explicitly unavailable and both retry paths
  // recover without first misrepresenting the player as a guest.
  {
    const f=await fixture({auth:'failure',claimed:true,dailyFailure:true,width:390});
    await f.page.goto(base);
    await f.page.waitForFunction(()=>document.querySelector('#account-nav')?.dataset.accountState==='unavailable');
    await f.page.locator('[data-home-state="unavailable"]').waitFor();
    assert.equal((await f.page.locator('#account-nav').textContent())?.trim(),'Retry account');
    assert.match((await f.page.locator('.daily-home').textContent())||'',/Daily progress is temporarily unavailable/);
    assert.doesNotMatch((await f.page.locator('.daily-home').textContent())||'',/Start here|Free · No account required/);

    f.state.auth='signed-in';
    f.state.dailyFailure=false;
    await f.page.locator('#account-nav').click();
    await f.page.waitForFunction(()=>document.querySelector('#account-nav')?.dataset.accountState==='signed-in');
    assert.equal((await f.page.locator('#account-nav').textContent())?.trim(),'My Pack One');
    await f.page.locator('[data-home-retry]').click();
    await f.page.locator('[data-home-state="ready"]').waitFor();
    assert.deepEqual(f.errors,[]);
    await f.context.close();
  }

  console.log('Homepage auth hydration passed: member, guest, expired session, slow reads, failures and retries.');
} finally {
  await browser.close();
}
