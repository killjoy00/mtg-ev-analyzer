import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';

for(const [name,type] of [['chromium',chromium],['webkit',webkit]]) {
  console.log(`Email verification browser: ${name}`);
  const browser=await type.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  const resendBodies=[];
  let signed=false;
  let providerSessionAvailable=true;
  page.on('pageerror',error=>errors.push(error.message));

  await page.route('https://api.packone.pro/growth/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace(/^\/growth/,'');
    if(path==='/v1/player/session')
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,playerId:'fixture-player'})});
    if(path==='/v1/account/session')
      return route.fulfill(signed
        ? {status:200,contentType:'application/json',body:JSON.stringify({user:{id:'verify-user',email:'verify@example.invalid',name:'Pack One Player'},session:{expiresAt:'2099-01-01T00:00:00Z'}})}
        : {status:401,contentType:'application/json',body:JSON.stringify({error:'Account session required.'})});
    if(path==='/v1/account/signup') {
      const body=route.request().postDataJSON();
      return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({ok:true,verificationRequired:true,user:{id:'verify-user',email:body.email,name:'Pack One Player'}})});
    }
    if(path==='/v1/account/send-verification-email') {
      resendBodies.push(route.request().postDataJSON());
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,message:"If an unverified account exists for that email, we've sent a verification link."})});
    }
    if(path==='/v1/account/migrate') {
      signed=true;
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,migrated:true})});
    }
    if(path==='/v1/account/link-browser')
      return route.fulfill({contentType:'application/json',body:JSON.stringify({
        ok:true,merged:false,newlyClaimed:true,validatedDailyScore:false,displayName:'Pack One Player',
        rankingIdentity:{eligible:false,reason:'username_required'},
      })});
    if(path==='/v1/profile/me')
      return route.fulfill({contentType:'application/json',body:JSON.stringify({
        player:{claimed:true,profile_public:false,display_name:'Pack One Player',display_name_reason:'username_required'},
        summary:{games:0},achievements:[],by_set:[],best_environments:[],daily_history:[],recent:[],trend:[],
      })});
    if(path==='/v1/events')
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true})});
    return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Not found.'})});
  });

  await page.route('https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/get-session')) {
      if(!providerSessionAvailable)
        return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'No session'})});
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        session:{token:'verified-neon-session',expiresAt:'2099-01-01T00:00:00Z'},
        user:{id:'verify-user',email:'verify@example.invalid',name:'Pack One Player'},
      })});
    }
    return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Not found.'})});
  });

  await page.goto(base+'/tests/auth-context-harness.html');
  await page.waitForFunction(()=>Boolean(window.__renderAccount));
  await page.locator('#account-signin').waitFor();
  await page.locator('#account-mode-toggle').click();

  const signup=page.locator('#account-signup');
  assert.equal(await signup.locator('[name="name"]').count(),0);
  assert.equal(await signup.locator('[name="email"]').getAttribute('autocomplete'),'username');
  await signup.locator('[name="email"]').fill('verify@example.invalid');
  await signup.locator('[name="password"]').fill('fixture-password-123');
  await signup.getByRole('button',{name:'Create account',exact:true}).click();

  await page.getByRole('heading',{name:'Check your email'}).waitFor();
  await page.getByText('Verification links expire after 15 minutes.').waitFor();
  await page.getByRole('button',{name:'Send a new verification link'}).click();
  await page.getByText("If an unverified account exists for that email, we've sent a verification link.").waitFor();
  assert.deepEqual(resendBodies.at(-1),{email:'verify@example.invalid'});
  await page.screenshot({path:`artifacts/ui-email-verification-pending-${name}-mobile.png`,fullPage:true});

  await page.evaluate(()=>{
    history.replaceState({},'','/tests/auth-context-harness.html?auth=verify&error=TOKEN_EXPIRED');
  });
  await page.evaluate(async()=>{
    const growth=await import('/growth.mjs');
    await growth.resumeAccountAuth('verify');
  });
  await page.getByRole('heading',{name:'Get a new verification link.'}).waitFor();
  await page.getByText(/expired or is no longer valid/i).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('auth'),false);
  assert.equal(new URL(page.url()).searchParams.has('error'),false);
  const recovery=page.locator('#account-verification-resend-form');
  await recovery.locator('[name="email"]').fill('expired@example.invalid');
  await recovery.getByRole('button',{name:'Send a new verification link'}).click();
  await page.getByText("If an unverified account exists for that email, we've sent a verification link.").waitFor();
  assert.deepEqual(resendBodies.at(-1),{email:'expired@example.invalid'});
  await page.screenshot({path:`artifacts/ui-email-verification-expired-${name}-mobile.png`,fullPage:true});

  signed=false;
  providerSessionAvailable=true;
  await page.evaluate(()=>{
    history.replaceState({},'','/tests/auth-context-harness.html?auth=verify');
  });
  await page.evaluate(async()=>{
    sessionStorage.setItem('pack1-auth-flow-v1',JSON.stringify({intent:null,source:'account',validateDailyRunId:null}));
    const growth=await import('/growth.mjs');
    await growth.resumeAccountAuth('verify');
  });
  await page.getByRole('heading',{name:'Your account is ready.'}).waitFor();
  assert.equal(await page.locator('#account-signin').count(),0,'same-browser verification should establish the authenticated onboarding session');
  assert.equal(new URL(page.url()).searchParams.has('auth'),false);
  await page.screenshot({path:`artifacts/ui-email-verification-account-ready-${name}-mobile.png`,fullPage:true});

  // A link opened in another browser/device may prove the email without carrying
  // a usable provider session. It must recover honestly instead of claiming an
  // authenticated onboarding state.
  signed=false;
  providerSessionAvailable=false;
  await page.goto(base+'/tests/auth-context-harness.html');
  await page.waitForFunction(()=>Boolean(window.__renderAccount));
  await page.evaluate(()=>{
    history.replaceState({},'','/tests/auth-context-harness.html?auth=verify');
  });
  await page.evaluate(async()=>{
    const growth=await import('/growth.mjs');
    await growth.resumeAccountAuth('verify');
  });
  await page.locator('#account-signin').waitFor();
  await page.getByText('Email verified. Sign in to continue on this browser.',{exact:true}).waitFor();
  assert.equal(await page.locator('#account-ready').count(),0,'different-browser verification must not open authenticated onboarding without a session');
  await page.screenshot({path:`artifacts/ui-email-verification-different-browser-${name}-mobile.png`,fullPage:true});

  assert.deepEqual(errors,[],name+' verification UI emitted page errors');
  await browser.close();
}
