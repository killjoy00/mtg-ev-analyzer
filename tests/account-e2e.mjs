import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
let signed=false,claims=0;
await page.route('https://www.patreon.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Patreon fixture</title><p>Patreon</p>'}));
await page.route('https://**.neonauth.c-5.us-east-2.aws.neon.tech/**',async route=>{
  const path=new URL(route.request().url()).pathname;assert.match(path,/sign-(in|up)\/email$/);
  const body=route.request().postDataJSON();assert.equal(body.email,'qa@example.invalid');signed=true;
  await route.fulfill({contentType:'application/json',body:JSON.stringify({token:'auth-fixture',user:{email:body.email,name:'Test Player'}})});
});
await page.route('https://**-pack1growth.compute.c-5.us-east-2.aws.neon.tech/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body={ok:true},status=200;
  if(path==='/v1/session')body={token:'guest-fixture'};
  if(path==='/v1/account/link'){claims++;assert.equal(route.request().headers()['x-pack1-auth-session'],'auth-fixture');body={token:'claimed-fixture',merged:true};}
  if(path==='/v1/account/session'){status=signed?200:401;body=signed?{session:{token:'auth-fixture'},user:{email:'qa@example.invalid',name:'Test Player'}}:{error:'Signed out'};}
  if(path==='/v1/account/signout')signed=false;
  if(path==='/v1/patreon/status')body={configured:true,webhook_configured:false,connected:false,membership:null,capabilities:[],support_url:'https://www.patreon.com/c/PackOne'};
  if(path==='/v1/profile/me')body={player:{claimed:signed,profile_public:false,display_name:'Test Player'},summary:{games:3},achievements:[]};
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
});
async function fillAuth(kind='signin'){
  const form=page.locator('#account-'+kind);
  await form.locator('[name="email"]').fill('qa@example.invalid');
  await form.locator('[name="password"]').fill('fixture-password-123');
  if(kind==='signup')await form.locator('[name="name"]').fill('Test Player');
  await form.getByRole('button',{name:kind==='signin'?'Sign in':'Create account',exact:true}).click();
}
try {
  await page.goto(base);await page.locator('#account-nav').click();await page.locator('#account-signin').waitFor();
  assert.equal(await page.locator('.player-profile-page').count(),0,'Account opens account access for a guest');
  assert.equal(await page.locator('#profile-nav').count(),0);
  await page.screenshot({path:'artifacts/ui-account-mobile.png',fullPage:true});

  await page.locator('#account-career').click();await page.locator('.player-profile-page').waitFor();
  assert.match(await page.locator('.profile-claim').textContent(),/Guest record/);
  await page.locator('#profile-claim-account').click();await page.locator('#account-signin').waitFor();

  for(const kind of ['signin','signup']) {
    await fillAuth(kind);
    await page.locator('#profile-account #account-signout').waitFor();assert.ok(claims>0);
    assert.equal(await page.locator('#profile-account #profile-settings-form').count(),1);
    assert.match(await page.locator('#profile-account').textContent(),/qa@example.invalid/);
    assert.equal(await page.locator('#patreon-connect').count(),1);
    assert.match(await page.locator('.profile-membership').textContent(),/Unlock Elite practice/);
    assert.match(await page.locator('.profile-membership').textContent(),/Become Elite on Patreon/);
    assert.match(await page.locator('.profile-membership').textContent(),/Already a member\? Connect Patreon/);
    assert.equal(await page.evaluate(()=>localStorage.getItem('pack1-api-session-v1')),'claimed-fixture');
    await page.evaluate(()=>localStorage.setItem('pack1-player-name-v1','Test Player'));
    await page.locator('#account-signout').click();await page.locator('#account-signin').waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('pack1-auth-session-v1')),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem('pack1-player-name-v1')),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem('pack1-auth-user-v1')),null);
    assert.notEqual(await page.evaluate(()=>localStorage.getItem('pack1-api-session-v1')),'claimed-fixture');
    assert.equal(await page.locator('.player-profile-page').count(),0);
    assert.equal(await page.locator('#account-signup [name="name"]').inputValue(),'');
  }

  await page.goto(base);await page.locator('[data-home-elite]').first().click();await page.locator('#account-signin').waitFor();
  assert.match(await page.locator('.account-page').textContent(),/Unlock Elite practice/);
  assert.match(await page.locator('.account-page').textContent(),/send you to Patreon/);
  await fillAuth('signin');
  await page.waitForURL('https://www.patreon.com/c/PackOne');
  assert.equal(page.url(),'https://www.patreon.com/c/PackOne');

  await page.goto(base);await page.locator('[data-home-elite]').first().click();
  await page.waitForURL('https://www.patreon.com/c/PackOne');
  assert.equal(page.url(),'https://www.patreon.com/c/PackOne','Signed-in free users go directly to Patreon');

  await page.goto(base);await page.locator('#account-nav').click();await page.locator('#account-signout').waitFor();
  await page.locator('#account-signout').click();await page.locator('#account-signin').waitFor();

  assert.deepEqual(errors,[]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
  console.log('Account browser contract passed: guest account access, guest career, sign in/up, linking, Patreon Elite handoff, membership connection surface and sign-out identity separation.');
}finally{await browser.close();}
