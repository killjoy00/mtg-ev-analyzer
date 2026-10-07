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
let unverifiedSignin=false;
let nextLinkNewlyClaimed=false;
let nextLinkRankingReason=null;
let linkBodies=[];
let resendBodies=[];
let resendCooldown=false;

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
    if(verificationRequired)body={ok:true,verificationRequired:true,user:{...accountUser,email:input.email,name:'Pack One Player'}};
    else {signed=true;body={ok:true,user:{...accountUser,email:input.email,name:'Pack One Player'},session:{expiresAt:'2099-01-01T00:00:00Z'}};}
  } else if(path==='/v1/account/signin') {
    if(delaySignin)await new Promise(resolve=>setTimeout(resolve,300));
    if(unverifiedSignin) {
      status=403;
      body={error:'Verify your email to finish creating your account. Check your inbox or send a new link.',code:'EMAIL_NOT_VERIFIED'};
    } else {
      signed=true;
      body={ok:true,user:accountUser,session:{expiresAt:'2099-01-01T00:00:00Z'}};
    }
  } else if(path==='/v1/account/send-verification-email') {
    resendBodies.push(route.request().postDataJSON());
    if(resendCooldown) {
      status=429;
      body={error:'Please wait before requesting another verification link.',code:'VERIFICATION_COOLDOWN'};
      return route.fulfill({status,headers:{'retry-after':'90'},contentType:'application/json',body:JSON.stringify(body)});
    }
    body={ok:true,message:"Request accepted. If that address belongs to an unverified Pack One account, a new verification link will be sent."};
  } else if(path==='/v1/account/link-browser') {
    const input=route.request().postDataJSON();
    linkBodies.push(input);
    body={
      ok:true,
      merged:false,
      newlyClaimed:nextLinkNewlyClaimed,
      validatedDailyScore:Boolean(input.validateDailyRunId),
      displayName:'QA Player',
      rankingIdentity:nextLinkRankingReason?{eligible:false,reason:nextLinkRankingReason}:{eligible:true},
    };
    nextLinkNewlyClaimed=false;
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
  signed=false;verificationRequired=false;delaySignup=false;delaySignin=false;delayGoogle=false;googleStartFails=false;unverifiedSignin=false;nextLinkNewlyClaimed=false;nextLinkRankingReason=null;linkBodies=[];resendBodies=[];resendCooldown=false;
  await page.setViewportSize({width,height:width<700?844:900});
  await page.goto(base+'/tests/auth-context-harness.html');
  await page.waitForFunction(()=>Boolean(window.__renderAccount));
  await page.locator('.account-page').waitFor();
  await page.evaluate(async args=>window.__renderAccount(args),{source,validateDailyRunId,intent});
}

async function startVerificationSignup({source,validateDailyRunId=null,intent=null,email='verify@example.invalid'}={}) {
  await fresh({source,validateDailyRunId,intent});
  verificationRequired=true;
  const signup=page.locator('#account-signup');
  await signup.locator('[name="email"]').fill(email);
  await signup.locator('[name="password"]').fill('fixture-password-123');
  await signup.getByRole('button',{name:'Create account',exact:true}).click();
  await page.getByRole('heading',{name:'Check your email'}).waitFor();
  return page.evaluate(()=>JSON.parse(sessionStorage.getItem('pack1-auth-flow-v1')||'null'));
}

async function resumeVerificationAfterReload({navigate=false}={}) {
  signed=false;
  await page.goto(base+'/tests/auth-context-harness.html?auth=verify',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.__renderAccount));
  if(navigate) {
    await page.evaluate(()=>{void import('/growth.mjs').then(growth=>growth.resumeAccountAuth('verify'));});
    return;
  }
  await page.evaluate(async()=>{const growth=await import('/growth.mjs');await growth.resumeAccountAuth('verify');});
}

async function captureProductionAuthEvidence() {
  signed=false;
  verificationRequired=false;
  nextLinkNewlyClaimed=false;
  nextLinkRankingReason=null;
  linkBodies=[];
  await page.route('**/leaderboard-config.js',route=>route.fulfill({
    status:200,
    contentType:'application/javascript',
    body:`window.PACK1_API={
      firstParty:true,
      authBase:'https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth',
      url:'https://api.packone.pro/legacy',
      growthUrl:'https://api.packone.pro/growth',
      draftRunUrl:'https://api.packone.pro/draft'
    };`,
  }));
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(document.querySelector('#account-nav')));
  await page.evaluate(async()=>{
    const growth=await import('/growth.mjs');
    await growth.renderAccount({source:'nav',mode:'signin'});
  });
  await page.locator('#account-signin').waitFor();
  await page.screenshot({path:'artifacts/ui-auth-production-signin-390.png',fullPage:true});

  await page.evaluate(async()=>{
    const growth=await import('/growth.mjs');
    await growth.renderAccount({source:'nav',mode:'signup'});
  });
  await page.locator('#account-signup').waitFor();
  await page.screenshot({path:'artifacts/ui-auth-production-signup-390.png',fullPage:true});

  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:'artifacts/ui-auth-production-signup-desktop.png',fullPage:true});

  await page.setViewportSize({width:390,height:844});
  const textGrowth = await page.evaluate(() => {
    const elements = [...document.querySelectorAll('#app *')];
    const metrics = elements.map(element => ({ element, size: parseFloat(getComputedStyle(element).fontSize), line: parseFloat(getComputedStyle(element).lineHeight), before: element.getAttribute('style') }));
    for (const { element, size, line } of metrics) {
      element.dataset.textScaleOriginalStyle = element.getAttribute('style') || '';
      element.style.fontSize = `${size * 1.25}px`;
      if (Number.isFinite(line)) element.style.lineHeight = `${line * 1.25}px`;
    }
    return metrics.filter(({ element, size }) => size > 0 && element.textContent.trim())
      .map(({ element, size }) => parseFloat(getComputedStyle(element).fontSize) / size);
  });
  assert.ok(textGrowth.length > 0 && textGrowth.every(ratio => ratio >= 1.24), 'Large-text evidence must enlarge actual computed typography by 25%.');
  await page.screenshot({path:'artifacts/ui-auth-production-signup-large-text-390.png',fullPage:true});
  await page.evaluate(() => document.querySelectorAll('[data-text-scale-original-style]').forEach(element => { element.setAttribute('style', element.dataset.textScaleOriginalStyle); delete element.dataset.textScaleOriginalStyle; }));

  // Verification completion remains on the deterministic harness below so the
  // E2E safety guard never permits the real production growth endpoint. The
  // harness now loads the production visual layer; the real root shell above
  // supplies final sign-in/signup appearance evidence.
}

try {
  await captureProductionAuthEvidence();

  // Normal nav/route auth defaults to sign-in and shows exactly one email mode.
  await fresh({source:'nav',width:390});
  await page.locator('#account-signin').waitFor();
  assert.equal(await page.locator('#account-signup').count(),0);
  assert.equal((await page.locator('#account-google').textContent())?.trim(),'Sign in with Google');
  assert.equal((await page.locator('#account-apple').textContent())?.trim(),'Sign in with Apple');
  assert.equal((await page.locator('.account-page h1').textContent())?.trim(),'Sign In');
  assert.match((await page.locator('.account-mode-toggle').textContent())||'',/New to Pack One\?\s*Create account/i);
  assert.equal(await page.locator('.account-auth-card #account-signin').count(),1);
  assert.equal(await page.locator('.account-auth-card .account-social').count(),1);
  assert.equal(await page.locator('.account-creation-consent').count(),0);
  await page.screenshot({path:'artifacts/ui-auth-signin-390.png',fullPage:true});

  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:'artifacts/ui-auth-signin-desktop.png',fullPage:true});

  // Toggle to create-account mode, still one form.
  await page.locator('#account-mode-toggle').click();
  await page.locator('#account-signup').waitFor();
  assert.equal(await page.locator('#account-signin').count(),0);
  assert.equal((await page.locator('#account-google').textContent())?.trim(),'Create with Google');
  assert.equal((await page.locator('#account-apple').textContent())?.trim(),'Create with Apple');
  assert.equal((await page.locator('.account-creation-consent').textContent())?.trim(),'By creating an account, you agree to the Pack One Terms.');
  assert.equal(await page.locator('.account-creation-consent a[href="https://packone.pro/terms/"]').count(),1);
  assert.equal(await page.locator('.account-creation-consent a').count(),1);
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
  assert.equal(await signup.locator('[name="name"]').count(),0);
  assert.equal(await signup.locator('[name="email"]').getAttribute('autocomplete'),'username');
  await signup.locator('[name="email"]').fill('verify@example.invalid');
  await signup.locator('[name="password"]').fill('fixture-password-123');
  await signup.getByRole('button',{name:'Create account',exact:true}).click();
  await page.getByRole('heading',{name:'Check your email'}).waitFor();
  await page.getByText(/We sent a verification link to verify@example\.invalid/).waitFor();
  assert.equal(await page.locator('.account-verification-success').count(),1);
  assert.equal(await page.locator('#account-verification-signin').count(),1);
  assert.equal(await page.locator('.account-verification-success.form-error').count(),0);
  await page.locator('#account-verification-signin').click();
  await page.locator('#account-signin').waitFor();

  // Verification-required email signup persists pending Daily context across a full document reload.
  let savedFlow=await startVerificationSignup({source:'daily_result',validateDailyRunId:runId,email:'daily-verify@example.invalid'});
  assert.deepEqual(savedFlow,{intent:null,source:'daily_result',validateDailyRunId:runId});
  nextLinkNewlyClaimed=false;
  await resumeVerificationAfterReload();
  await page.getByText("Score added to today's leaderboard",{exact:true}).waitFor();
  assert.deepEqual(linkBodies.at(-1),{validateDailyRunId:runId},'verification return must submit the pending Daily run when linking the account');

  // Elite entry intent survives the verification reload and resumes at the Elite destination.
  savedFlow=await startVerificationSignup({source:'practice_gate',intent:'elite',email:'elite-verify@example.invalid'});
  assert.deepEqual(savedFlow,{intent:'elite',source:'practice_gate',validateDailyRunId:null});
  nextLinkNewlyClaimed=false;
  await resumeVerificationAfterReload({navigate:true});
  await page.waitForURL(url=>new URL(url).pathname==='/patreon/');
  assert.equal(new URL(page.url()).pathname,'/patreon/');

  // Patreon activation intent also survives the reload and resumes the provider handoff screen.
  savedFlow=await startVerificationSignup({source:'welcome_note',intent:'patreon-activate',email:'patreon-verify@example.invalid'});
  assert.deepEqual(savedFlow,{intent:'patreon-activate',source:'welcome_note',validateDailyRunId:null});
  nextLinkNewlyClaimed=false;
  await resumeVerificationAfterReload();
  await page.getByRole('heading',{name:'Activate Pack One Elite'}).waitFor();
  await page.getByRole('heading',{name:'Authorize Patreon to activate Elite.'}).waitFor();
  await page.evaluate(()=>sessionStorage.removeItem('pack1-patreon-activation-v1'));

  // Unverified password sign-in gets a recovery message and a resend action.
  await fresh({source:'nav'});
  unverifiedSignin=true;
  const unverified=page.locator('#account-signin');
  await unverified.locator('[name="email"]').fill('qa@example.invalid');
  await unverified.locator('[name="password"]').fill('fixture-password-123');
  await unverified.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByText('Verify your email to finish creating your account. Check your inbox or send a new link.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Send a new verification link',exact:true}).click();
  await page.getByText("Request accepted. If that address belongs to an unverified Pack One account, a new verification link will be sent.",{exact:true}).waitFor();
  assert.deepEqual(resendBodies.at(-1),{email:'qa@example.invalid'});
  resendCooldown=true;
  await page.getByRole('button',{name:'Send a new verification link',exact:true}).click();
  await page.getByText('Cooldown active. Try again in about 2 minutes.',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-state="cooldown"]').count(),1);

  // A first account claim routes through the compact account-ready step.
  await fresh({source:'nav'});
  nextLinkNewlyClaimed=true;
  nextLinkRankingReason='username_required';
  const newlyClaimed=page.locator('#account-signin');
  await newlyClaimed.locator('[name="email"]').fill('qa@example.invalid');
  await newlyClaimed.locator('[name="password"]').fill('fixture-password-123');
  await newlyClaimed.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('heading',{name:'Your account is ready.'}).waitFor();
  assert.equal(await page.locator('#account-ready input[name="displayName"]').evaluate(el=>document.activeElement===el),true);
  assert.equal(await page.locator('#account-ready input[name="displayName"]').inputValue(),'');
  await page.getByText('Optional. Choose a display name if you want to join Daily leaderboards. Shown on Daily leaderboards and your public profile.',{exact:true}).waitFor();
  assert.equal((await page.locator('#account-ready .form-error').textContent())?.trim(),'');
  await page.getByRole('button',{name:'Skip for now',exact:true}).click();
  assert.equal(await page.locator('#account-ready').count(),0);

  // Social OAuth first claims use the same account-ready step and precise name reason.
  await fresh({source:'nav'});
  nextLinkNewlyClaimed=true;
  nextLinkRankingReason='name_not_allowed';
  await page.evaluate(()=>{
    sessionStorage.setItem('pack1-auth-flow-v1',JSON.stringify({intent:null,source:'nav',validateDailyRunId:null}));
    history.replaceState({},'','/tests/auth-context-harness.html?auth=google&neon_auth_session_verifier=fixture');
  });
  await page.evaluate(async()=>{const growth=await import('/growth.mjs');await growth.resumeAccountAuth('google');});
  await page.getByRole('heading',{name:'Your account is ready.'}).waitFor();
  const socialError=page.locator('#account-ready .form-error');
  await page.getByText('That display name is not allowed. Choose another to join Daily leaderboards.',{exact:true}).waitFor();
  await page.locator('#account-ready input[name="displayName"]').fill('New Display Name');
  assert.equal((await socialError.textContent())?.trim(),'');
  await page.getByRole('button',{name:'Skip for now',exact:true}).click();

  // A verification callback that returns authenticated also uses account-ready.
  await fresh({source:'nav'});
  signed=true;
  nextLinkNewlyClaimed=true;
  nextLinkRankingReason='username_taken';
  await page.evaluate(()=>{
    sessionStorage.setItem('pack1-auth-flow-v1',JSON.stringify({intent:null,source:'account',validateDailyRunId:null}));
    history.replaceState({},'','/tests/auth-context-harness.html?auth=verify');
  });
  await page.evaluate(async()=>{const growth=await import('/growth.mjs');await growth.resumeAccountAuth('verify');});
  await page.getByRole('heading',{name:'Your account is ready.'}).waitFor();
  await page.getByText('Choose a different display name. That one is already taken.',{exact:true}).waitFor();
  assert.equal(await page.locator('#account-signin').count(),0,'normal verification completion must not require another sign-in');
  await page.screenshot({path:'artifacts/ui-auth-verification-account-ready-390.png',fullPage:true});
  await page.getByRole('button',{name:'Skip for now',exact:true}).click();

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
  console.log('Auth context browser contract passed: single-mode forms, verification recovery, first-claim account-ready across email/OAuth/verification, pending controls, and Daily return.');
} finally {
  await browser.close();
}
