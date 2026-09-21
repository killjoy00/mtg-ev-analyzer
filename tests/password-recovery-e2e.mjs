import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';

for(const [name,type] of [['chromium',chromium],['webkit',webkit]]) {
  console.log(`Password recovery browser: ${name}`);
  const browser=await type.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];let resetMode='success',requestBodies=[];
  page.on('pageerror',error=>errors.push(error.message));

  await page.route('https://**-pack1growth.compute.c-5.us-east-2.aws.neon.tech/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/v1/account/request-password-reset') {
      requestBodies.push(route.request().postDataJSON());
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,message:"If an account exists for that email, we've sent a password reset link."})});
    }
    if(path==='/v1/account/reset-password') {
      requestBodies.push(route.request().postDataJSON());
      if(resetMode==='policy')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Password was not accepted.',code:'PASSWORD_POLICY'})});
      if(resetMode==='expired')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'This password reset link has expired.',code:'EXPIRED_RESET'})});
      if(resetMode==='reused')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'This password reset link is invalid or has already been used.',code:'INVALID_RESET'})});
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true})});
    }
    if(path==='/v1/session')return route.fulfill({contentType:'application/json',body:JSON.stringify({token:'guest-fixture'})});
    if(path==='/v1/account/session')return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Signed out'})});
    if(path==='/v1/patreon/status')return route.fulfill({contentType:'application/json',body:JSON.stringify({configured:true,webhook_configured:false,connected:false,membership:null,capabilities:[],support_url:'https://www.patreon.com/c/PackOne'})});
    if(path==='/v1/profile/me')return route.fulfill({contentType:'application/json',body:JSON.stringify({player:{claimed:false,profile_public:false,display_name:'Guest Player'},summary:{games:0},achievements:[]})});
    return route.fulfill({contentType:'application/json',body:'{"ok":true}'});
  });

  await page.route('https://**-draftrunapi.compute.c-5.us-east-2.aws.neon.tech/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path!=='/v1/daily-status')return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Not found.'})});
    return route.fulfill({contentType:'application/json',body:JSON.stringify({
      day:'2026-09-20',
      capabilities:[],
      player:{claimed:false},
      membership:{connected:false},
      daily_history:[],
    })});
  });

  await page.goto(base);
  await page.locator('#account-nav').click();
  await page.locator('.player-profile-page').waitFor();
  await page.locator('#profile-claim-account').click();
  await page.locator('#account-signin').waitFor();
  await page.locator('#account-forgot').waitFor();
  assert.equal((await page.locator('#account-forgot').textContent())?.trim(),'Forgot password?');
  await page.locator('#account-forgot').click();
  await page.locator('#account-recovery-request [name="email"]').fill('qa@example.invalid');
  await page.getByRole('button',{name:'Send reset link'}).click();
  await page.getByText("If an account exists for that email, we've sent a password reset link.").waitFor();
  assert.deepEqual(requestBodies.at(-1),{email:'qa@example.invalid'});
  await page.screenshot({path:`artifacts/ui-password-recovery-${name}-mobile.png`,fullPage:true});

  const token='fixture-token-1234567890abcdef';
  resetMode='success';
  await page.goto(base+'/reset-password/?token='+token);
  await page.locator('#reset-password-form').waitFor();
  assert.equal(page.url(),base+'/reset-password/','recovery token is removed from visible URL/history');
  await page.locator('[name="password"]').fill('New-password-123!');
  await page.locator('[name="confirm"]').fill('New-password-123!');
  await page.getByRole('button',{name:'Reset password'}).click();
  await page.getByText('Your password has been changed.').waitFor();
  assert.deepEqual(requestBodies.at(-1),{token,newPassword:'New-password-123!'});

  resetMode='policy';
  await page.goto(base+'/reset-password/?token='+token);
  await page.locator('[name="password"]').fill('short123');
  await page.locator('[name="confirm"]').fill('short123');
  await page.getByRole('button',{name:'Reset password'}).click();
  await page.getByText('Password was not accepted.').waitFor();

  await page.goto(base+'/reset-password/?error=TOKEN_EXPIRED&token='+token);
  await page.getByText('Reset link expired').waitFor();
  assert.equal(page.url(),base+'/reset-password/');

  await page.goto(base+'/reset-password/?error=TOKEN_REUSED&token='+token);
  await page.getByText('Reset link already used').waitFor();

  await page.goto(base+'/reset-password/?error=INVALID_TOKEN&token='+token);
  await page.getByText('Reset link unavailable').waitFor();

  await page.goto(base+'/reset-password/');
  await page.getByText('Reset link unavailable').waitFor();

  assert.deepEqual(errors,[],name+' emitted page errors');
  await browser.close();
}
console.log('Password recovery Chromium/WebKit mobile contract passed.');
