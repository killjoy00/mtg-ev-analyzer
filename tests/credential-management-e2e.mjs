import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';

for(const [name,type] of [['chromium',chromium],['webkit',webkit]]) {
  console.log(`Credential management browser: ${name}`);
  const browser=await type.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];let signed=true,passwordCredential=true,googleCredential=false,passwordBody=null;
  page.on('pageerror',error=>errors.push(error.message));

  await page.route('https://api.packone.pro/growth/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace(/^\/growth/,'');
    let body={ok:true},status=200;
    if(path==='/v1/account/session') {
      status=signed?200:401;
      body=signed?{
        user:{id:'11111111-1111-4111-8111-111111111111',email:'qa@example.invalid',name:'Test Player'},
        session:{expiresAt:'2099-01-01T00:00:00Z'},
        credentials:{password:passwordCredential,google:googleCredential},
      }:{error:'Account session required.'};
    } else if(path==='/v1/player/session') {
      body={ok:true};
    } else if(path==='/v1/account/link-browser') {
      body={ok:true,merged:false};
    } else if(path==='/v1/profile/me') {
      body={
        player:{claimed:true,profile_public:false,display_name:'Test Player',profile_key:'fixture',favorite_set_id:null,showcase_achievement:null},
        summary:{games:3,average_score:72,best_score:85,current_streak:1},
        achievements:[],by_set:[],best_environments:[],daily_history:[],recent:[],
      };
    } else if(path==='/v1/patreon/status') {
      body={configured:true,connected:false,capabilities:[],support_url:'https://www.patreon.com/c/PackOne'};
    } else if(path==='/v1/account/password-change') {
      passwordBody=route.request().postDataJSON();
      signed=false;
      body={ok:true,signedOut:true};
    }
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });

  await page.route('https://api.packone.pro/draft/**',async route=>{
    await route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Not found.'})});
  });

  try {
    await page.goto(base+'/tests/credential-management-harness.html');
    await page.locator('.my-pack-one-page').waitFor();
    await page.locator('#profile-account-tab').click();
    await page.locator('#account-password-change').waitFor();
    assert.equal(await page.locator('body').getAttribute('data-harness-error'),null,name+' harness failed');
    assert.match(await page.getByRole('region',{name:'Sign-in credentials'}).textContent(),/Change password/);

    const form=page.locator('#account-password-change');
    await form.locator('[name="currentPassword"]').fill('Current-password-123!');
    await form.locator('[name="newPassword"]').fill('New-password-456!');
    await form.locator('[name="confirmPassword"]').fill('New-password-456!');
    await form.getByRole('button',{name:'Change password'}).click();

    await page.getByText('Password changed. You have been signed out everywhere.').waitFor();
    assert.deepEqual(passwordBody,{
      currentPassword:'Current-password-123!',
      newPassword:'New-password-456!',
    });
    assert.equal(await page.locator('#account-signin').count(),1);
    assert.equal(await page.locator('#account-password-change').count(),0);
    await page.screenshot({path:`artifacts/ui-credential-management-${name}-mobile.png`,fullPage:true});

    signed=true;passwordCredential=false;googleCredential=true;passwordBody=null;
    await page.goto(base+'/tests/credential-management-harness.html');
    await page.locator('.my-pack-one-page').waitFor();
    await page.locator('#profile-account-tab').click();
    await page.getByText('This account signs in with Google and does not have a Pack One password to change.').waitFor();
    assert.equal(await page.locator('#account-password-change').count(),0);
    // The profile stylesheet is injected dynamically by the product layer.
    // Wait for it before measuring layout so this assertion checks the rendered
    // UI rather than a transient unstyled frame on a fast harness navigation.
    await page.waitForFunction(()=>Boolean(document.querySelector('link[data-pack1-profile-css]')?.sheet));

    assert.deepEqual(errors,[],name+' emitted page errors');
    const layout=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(layout.scroll<=layout.client+1,name+` mobile layout overflowed: ${layout.scroll} > ${layout.client}`);
  } finally {
    await browser.close();
  }
}
console.log('Credential management Chromium/WebKit mobile contract passed.');
