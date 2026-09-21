import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
let signed=false,claims=0;

await page.route('https://www.patreon.com/**',route=>route.fulfill({
  contentType:'text/html',
  body:'<!doctype html><title>Patreon fixture</title><p>Patreon</p>',
}));

await page.route('https://**.neonauth.c-7.us-east-2.aws.neon.tech/**',async route=>{
  const target=new URL(route.request().url()),path=target.pathname;assert.equal(target.host,'ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech');assert.match(path,/sign-(in|up)\/email$/);
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

await page.route('https://**-draftrunapi.compute.c-5.us-east-2.aws.neon.tech/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path!=='/v1/daily-status')return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Not found.'})});
  const body={
    day:'2026-09-19',
    capabilities:signed?['account','unlimited_regular_practice']:[],
    player:{claimed:signed},
    membership:{connected:false},
    daily_history:[],
  };
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
});

async function fillAuth(kind='signin'){
  const form=page.locator('#account-'+kind);
  await form.locator('[name="email"]').fill('qa@example.invalid');
  await form.locator('[name="password"]').fill('fixture-password-123');
  if(kind==='signup')await form.locator('[name="name"]').fill('Test Player');
  await form.getByRole('button',{name:kind==='signin'?'Sign in':'Create account',exact:true}).click();
}

try {
  // Deletion return states are terminal. They must not fall through to the
  // generic account route and be replaced by the player profile.
  for(const [state,heading] of [
    ['deleted','Your Pack One account has been deleted.'],
    ['deleting','Your deletion request has been accepted.'],
  ]) {
    await page.goto(base+'/?account='+state);
    await page.getByText(heading).waitFor();
    assert.equal(await page.locator('.player-profile-page').count(),0,state+' deletion receipt was replaced by profile rendering');
  }

  // Account remains the combined career/account surface for guests and members.
  await page.goto(base);
  await page.locator('#account-nav').click();
  await page.locator('.player-profile-page').waitFor();
  assert.match(await page.locator('.profile-claim').textContent(),/Guest record/);
  assert.equal(await page.locator('#profile-nav').count(),0);
  assert.equal((await page.locator('.profile-hero-actions #profile-claim-account').textContent())?.trim(),'Sign In');
  assert.match(await page.locator('.profile-hero-actions #profile-claim-account').getAttribute('class'),/primary/);
  assert.equal((await page.locator('.profile-hero-actions #profile-share').textContent())?.trim(),'Share my record');
  assert.match(await page.locator('.profile-hero-actions #profile-share').getAttribute('class'),/secondary/);
  assert.equal(await page.locator('.profile-claim #profile-claim-account').count(),0);
  assert.doesNotMatch(await page.locator('.profile-claim').textContent(),/Save my progress/);
  await page.locator('#profile-claim-account').click();
  await page.locator('#account-signin').waitFor();
  assert.match(await page.locator('.account-page header').textContent(),/A free account saves your record and enables leaderboard participation\./);
  await page.screenshot({path:'artifacts/ui-account-mobile.png',fullPage:true});

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
    await page.locator('#account-signout').click();
    await page.locator('#account-signin').waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('pack1-auth-session-v1')),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem('pack1-player-name-v1')),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem('pack1-auth-user-v1')),null);
    assert.notEqual(await page.evaluate(()=>localStorage.getItem('pack1-api-session-v1')),'claimed-fixture');
    assert.equal(await page.locator('.player-profile-page').count(),0);
    assert.equal(await page.locator('#account-signup [name="name"]').inputValue(),'');
  }

  // Guests are not shown a paid ask on the landing page. The underlying guest
  // handoff still works when an explicit premium action invokes it.
  await page.goto(base);
  await page.locator('[data-daily-home]').waitFor();
  assert.equal(await page.locator('[data-home-elite]').count(),0);
  await page.evaluate(async()=>{const growth=await import('./growth.mjs');await growth.beginEliteUpgrade({source:'e2e_explicit_premium'});});
  await page.locator('#account-signin').waitFor();
  assert.match(await page.locator('.account-page').textContent(),/Unlock Elite practice/);
  assert.match(await page.locator('.account-page').textContent(),/send you to Patreon/);
  await fillAuth('signin');
  await page.waitForURL('https://www.patreon.com/c/PackOne');
  assert.equal(page.url(),'https://www.patreon.com/c/PackOne');

  // A signed-in free member gets the Elite CTA and goes straight to Patreon.
  await page.goto(base);
  await page.locator('[data-home-elite]').first().waitFor();
  await page.locator('[data-home-elite]').first().click();
  await page.waitForURL('https://www.patreon.com/c/PackOne');
  assert.equal(page.url(),'https://www.patreon.com/c/PackOne');

  // Account still returns to the combined career/settings surface after that flow.
  await page.goto(base);
  await page.locator('#account-nav').click();
  await page.locator('#account-signout').waitFor();
  assert.equal(await page.locator('.player-profile-page').count(),1);
  await page.locator('#account-signout').click();
  await page.locator('#account-signin').waitFor();

  assert.deepEqual(errors,[]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
  console.log('Account browser contract passed: combined career/account surface, sign in/up, linking, Patreon Elite handoff, membership connection and sign-out identity separation.');
}finally{await browser.close();}
