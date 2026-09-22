import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';

for(const [name,type] of [['chromium',chromium],['webkit',webkit]]) {
  console.log(`Email verification browser: ${name}`);
  const browser=await type.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  const resendBodies=[];
  page.on('pageerror',error=>errors.push(error.message));

  await page.route('https://api.packone.pro/growth/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace(/^\/growth/,'');
    if(path==='/v1/player/session')
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,playerId:'fixture-player'})});
    if(path==='/v1/account/session')
      return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Account session required.'})});
    if(path==='/v1/account/signup') {
      const body=route.request().postDataJSON();
      return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({ok:true,verificationRequired:true,email:body.email})});
    }
    if(path==='/v1/account/send-verification-email') {
      resendBodies.push(route.request().postDataJSON());
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,message:"If an unverified account exists for that email, we've sent a verification link."})});
    }
    if(path==='/v1/events')
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true})});
    return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Not found.'})});
  });

  await page.goto(base+'/tests/auth-context-harness.html');
  await page.waitForFunction(()=>Boolean(window.__renderAccount));
  await page.locator('#account-signin').waitFor();
  await page.locator('#account-mode-toggle').click();

  const signup=page.locator('#account-signup');
  await signup.locator('[name="name"]').fill('Verification QA');
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

  await page.evaluate(()=>{
    history.replaceState({},'','/tests/auth-context-harness.html?auth=verify');
  });
  await page.evaluate(async()=>{
    const growth=await import('/growth.mjs');
    await growth.resumeAccountAuth('verify');
  });
  await page.getByText('Email verified.',{exact:true}).waitFor();
  await page.locator('#account-signin').waitFor();
  assert.equal(new URL(page.url()).searchParams.has('auth'),false);

  assert.deepEqual(errors,[],name+' verification UI emitted page errors');
  await browser.close();
}
