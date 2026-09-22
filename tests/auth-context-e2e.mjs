import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const runId='11111111-1111-4111-8111-111111111111';
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));

let signed=false;
let verificationRequired=false;
let delaySignup=false;
let delaySignin=false;
let delayGoogle=false;
let googleStartFails=false;
let linkBodies=[];

const accountUser={id:'22222222-2222-4222-8222-222222222222',email:'qa@example.invalid',name:'QA Player'};
const completedRun={
  id:runId,
  environment:'mixed',
  day:'2026-09-21',
  run_length:8,
  revision:8,
  complete:true,
  leaderboard_eligible:true,
  ranked_name:'QA Player',
  score:88,
  standing:{rank:3,total:42,percentile:8,final:false},
  answers:Array.from({length:8},(_,index)=>({
    score:88,
    historicalMatch:false,
    selectedId:'card-a-'+index,
    historicalId:'card-b-'+index,
    selectedName:'Card '+(index+1),
    historicalName:'Trophy '+(index+1),
    pickNumber:index+1,
    puzzle:{set_id:'tmt',puzzle_id:'puzzle-'+(index+1)},
  })),
  rerolls:{set:0,pack:0},
};

await page.route('https://api.packone.pro/growth/**',async route=>{
  const url=new URL(route.request().url());
  const path=url.pathname.replace(/^\/growth/,'');
  let body={ok:true},status=200;

  if(path==='/v1/player/session') {
    body={ok:true};
  } else if(path==='/v1/account/session') {
    status=signed?200:401;
    body=signed?{user:accountUser,session:{expiresAt:'2099-01-01T00:00:00Z'}}:{error:'Account session required.'};
  } else if(path==='/v1/account/signup') {
    const input=route.request().postDataJSON();
    if(delaySignup)await new Promise(resolve=>setTimeout(resolve,300));
    if(verificationRequired)body={ok:true,verificationRequired:true,email:input.email};
    else {signed=true;body={ok:true,user:{...accountUser,email:input.email,name:input.name}};}
  } else if(path==='/v1/account/signin') {
    if(delaySignin)await new Promise(resolve=>setTimeout(resolve,300));
    signed=true;
    body={ok:true,user:accountUser};
  } else if(path==='/v1/account/link-browser') {
    const input=route.request().postDataJSON();
    linkBodies.push(input);
    body={ok:true,merged:false,validatedDailyScore:Boolean(input.validateDailyRunId),displayName:'QA Player'};
  } else if(path==='/v1/account/migrate') {
    signed=true;
    body={ok:true};
  } else if(path==='/v1/events') {
    body={ok:true};
  } else if(path==='/v1/profile/me') {
    body={player:{claimed:true,profile_public:false,display_name:'QA Player'},summary:{games:1},achievements:[],by_set:[],best_environments:[],daily_history:[],recent:[],trend:[]};
  } else if(path==='/v1/patreon/status') {
    body={configured:true,connected:false,capabilities:[],support_url:'https://www.patreon.com/c/PackOne'};
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
});

await page.route('https://api.packone.pro/draft/**',async route=>{
  const path=new URL(route.request().url()).pathname.replace(/^\/draft/,'');
  if(path===`/v1/runs/${runId}`) {
    // Deliberately return a standing here. Phase 3 must not display it because
    // linkAccount does not expose standing and the product may not fetch it just
    // to decorate the confirmation.
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(completedRun)});
  }
  return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Not found.'})});
});

await page.route('https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/sign-in/social')) {
    if(delayGoogle)await new Promise(resolve=>setTimeout(resolve,300));
    if(googleStartFails)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Google unavailable fixture'})});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({url:'https://accounts.google.test/fixture'})});
  }
  if(url.pathname.endsWith('/get-session')) {
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({session:{token:'google-session'},user:accountUser})});
  }
  return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Not found.'})});
});

async function fresh({source='nav',validateDailyRunId=null,intent=null,width=390}={}) {
  signed=false;verificationRequired=false;delaySignup=false;delaySignin=false;delayGoogle=false;googleStartFails=false;linkBodies=[];
  await page.setViewportSize({width,height:width<700?844:900});
  await page.goto(base+'/tests/auth-context-harness.html');
  await page.waitForFunction(()=>Boolean(window.__renderAccount));
  await page.locator('.account-page').waitFor();
  await page.evaluate(async args=>window.__renderAccount(args),{source,validateDailyRunId,intent});
}

try {
  // Normal nav/route auth defaults to sign-in and shows exactly one email mode.
  await fresh({source:'nav',width:390});
  await page.locator('#account-signin').waitFor();
  assert.equal(await page.locator('#account-signup').count(),0);
  assert.equal((await page.locator('#account-google').textContent())?.trim(),'Sign in with Google');
  assert.equal((await page.locator('.account-page h1').textContent())?.trim(),'Sign In');
  assert.match((await page.locator('.account-new-user').textContent())||'',/New to Pack One\?\s*Create account/i);
  await page.screenshot({path:'artifacts/ui-auth-signin-390.png',fullPage:true});

  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:'artifacts/ui-auth-signin-desktop.png',fullPage:true});

  // Toggle to create-account mode, still one form.
  await page.locator('#account-mode-toggle').click();
  await page.locator('#account-signup').waitFor();
  assert.equal(await page.locator('#account-signin').count(),0);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'artifacts/ui-auth-signup-390.png',fullPage:true});
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:'artifacts/ui-auth-signup-desktop.png',fullPage:true});

  // Pending Daily and Elite contexts default to signup.
  await fresh({source:'daily_result',validateDailyRunId:runId});
  await page.locator('#account-signup').waitFor();
  assert.equal(await page.locator('#account-signin').count(),0);
  await fresh({source:'practice_gate',intent:'elite'});
  await page.locator('#account-signup').waitFor();

  // Google disables while pending; errors stay in its own area and the control recovers.
  await fresh({source:'nav'});
  delayGoogle=true;googleStartFails=true;
  await page.locator('#account-google').click();
  await page.waitForFunction(()=>document.querySelector('#account-google')?.disabled===true);
  assert.equal((await page.locator('#account-google').textContent())?.trim(),'Connecting…');
  await page.getByText('Google unavailable fixture').waitFor();
  assert.equal((await page.locator('#account-signin .form-error').textContent())?.trim(),'');
  assert.equal(await page.locator('#account-google').isEnabled(),true);

  // Create-account submit also disables while its request is pending.
  await fresh({source:'nav'});
  await page.locator('#account-mode-toggle').click();
  delaySignup=true;
  const pendingSignup=page.locator('#account-signup');
  await pendingSignup.locator('[name="name"]').fill('QA Player');
  await pendingSignup.locator('[name="email"]').fill('qa@example.invalid');
  await pendingSignup.locator('[name="password"]').fill('fixture-password-123');
  await pendingSignup.getByRole('button',{name:'Create account',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#account-signup button[type="submit"]')?.disabled===true);
  assert.equal((await page.locator('#account-signup button[type="submit"]').textContent())?.trim(),'Creating account…');
  await page.locator('.my-pack-one-page').waitFor();

  // Verification-required signup is a success state with an explicit sign-in route.
  await fresh({source:'nav'});
  await page.locator('#account-mode-toggle').click();
  verificationRequired=true;
  const signup=page.locator('#account-signup');
  await signup.locator('[name="name"]').fill('QA Player');
  await signup.locator('[name="email"]').fill('verify@example.invalid');
  await signup.locator('[name="password"]').fill('fixture-password-123');
  await signup.getByRole('button',{name:'Create account',exact:true}).click();
  await page.getByText(/Check your email — we sent a verification link to verify@example\.invalid/).waitFor();
  assert.equal(await page.locator('.account-verification-success').count(),1);
  assert.equal(await page.locator('#account-verification-signin').count(),1);
  assert.equal(await page.locator('.account-verification-success.form-error').count(),0);
  await page.locator('#account-verification-signin').click();
  await page.locator('#account-signin').waitFor();

  // Email submit disables while pending and restores/finishes without double-submit.
  await fresh({source:'nav'});
  delaySignin=true;
  const signin=page.locator('#account-signin');
  await signin.locator('[name="email"]').fill('qa@example.invalid');
  await signin.locator('[name="password"]').fill('fixture-password-123');
  const signButton=signin.getByRole('button',{name:'Sign in',exact:true});
  await signButton.click();
  await page.waitForFunction(()=>document.querySelector('#account-signin button[type="submit"]')?.disabled===true);
  assert.equal((await page.locator('#account-signin button[type="submit"]').textContent())?.trim(),'Signing in…');
  await page.locator('.my-pack-one-page').waitFor();

  // Guest Daily -> email auth returns to the completed result, not My Pack One.
  await fresh({source:'daily_result',validateDailyRunId:runId});
  await page.locator('#account-mode-toggle').click(); // signup default -> sign in
  const dailySignin=page.locator('#account-signin');
  await dailySignin.locator('[name="email"]').fill('qa@example.invalid');
  await dailySignin.locator('[name="password"]').fill('fixture-password-123');
  await dailySignin.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByText("Score added to today's leaderboard",{exact:true}).waitFor();
  assert.equal(await page.locator('.my-pack-one-page').count(),0);
  assert.equal(await page.locator('.run-result-page').count(),1);
  assert.equal((await page.locator('#account-nav').textContent())?.trim(),'My Pack One');
  assert.equal(await page.getByRole('link',{name:'View leaderboard',exact:true}).count(),1);
  assert.equal(await page.locator('[data-daily-validation-confirmation] span').count(),0,'standing must be omitted because linkAccount did not expose it');
  assert.deepEqual(linkBodies.at(-1),{validateDailyRunId:runId});
  await page.screenshot({path:'artifacts/ui-post-daily-auth-return-390.png',fullPage:true});

  // The same return context survives the Google redirect plumbing.
  await fresh({source:'nav'});
  signed=false;linkBodies=[];
  await page.evaluate(({runId})=>{
    sessionStorage.setItem('pack1-auth-flow-v1',JSON.stringify({intent:null,source:'daily_result',validateDailyRunId:runId}));
    history.replaceState({},'','/tests/auth-context-harness.html?auth=google&neon_auth_session_verifier=fixture');
  },{runId});
  await page.evaluate(async()=>{const growth=await import('/growth.mjs');await growth.resumeAccountAuth('google');});
  await page.getByText("Score added to today's leaderboard",{exact:true}).waitFor();
  assert.equal(await page.locator('.my-pack-one-page').count(),0);
  assert.equal(await page.locator('.run-result-page').count(),1);
  assert.equal((await page.locator('#account-nav').textContent())?.trim(),'My Pack One');
  assert.equal(await page.locator('[data-daily-validation-confirmation] span').count(),0);
  assert.deepEqual(linkBodies.at(-1),{validateDailyRunId:runId});

  assert.deepEqual(errors,[]);
  console.log('Auth context browser contract passed: single-mode forms, Google errors, verification success, pending controls, Daily return and Google redirect.');
} finally {
  await browser.close();
}
