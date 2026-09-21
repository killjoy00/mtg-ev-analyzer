import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const user={id:'11111111-1111-4111-8111-111111111111',email:'qa@example.invalid',name:'Test Player'};

async function installApi(page,{password=true,google=false,result='accepted'}={}) {
  let signed=true,deleteBody=null;
  // A delete commits on the first-party production gateway and then performs a
  // full navigation to /?account=deleted|deleting. Keep that navigation on the
  // same first-party architecture in localhost E2E instead of letting the
  // local-development config switch to direct Neon function origins.
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
  await page.route('https://api.packone.pro/growth/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace(/^\/growth/,'');
    let body={ok:true},status=200;
    if(path==='/v1/account/session') {
      status=signed?200:401;
      body=signed?{
        user,
        session:{expiresAt:'2099-01-01T00:00:00Z'},
        credentials:{password,google},
        deletion:{enabled:true,available:password,googleOnly:google&&!password},
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
    } else if(path==='/v1/account/delete') {
      deleteBody=route.request().postDataJSON();
      signed=false;
      status=result==='complete'?200:202;
      body={ok:true,deletion:result,operationId:'33333333-3333-4333-8333-333333333333'};
    }
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.route('https://api.packone.pro/draft/**',route=>route.fulfill({
    status:404,contentType:'application/json',body:JSON.stringify({error:'Not found.'}),
  }));
  return ()=>deleteBody;
}

async function submitDeletion(page) {
  const form=page.locator('#account-delete');
  await form.waitFor();
  await form.locator('[name="currentPassword"]').fill('fixture-current-value');
  await form.locator('[name="confirm"]').check();
  await form.getByRole('button',{name:'Permanently delete account'}).click();
}

for(const [name,type] of [['chromium',chromium],['webkit',webkit]]) {
  console.log(`Account deletion browser: ${name}`);
  const browser=await type.launch({headless:true});
  try {
    {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      const deleteBody=await installApi(page,{result:'accepted'});
      await page.goto(base+'/tests/credential-management-harness.html');
      await page.locator('#account-delete').waitFor();
      assert.match(await page.locator('.profile-danger').textContent(),/server-side recovery finishes the irreversible operation/i);
      await submitDeletion(page);
      await page.waitForURL('**/?account=deleting');
      try {
        await page.getByText('Your deletion request has been accepted.').waitFor({timeout:5000});
      } catch (error) {
        const state=await page.evaluate(()=>({
          href:location.href,
          readyState:document.readyState,
          appText:document.querySelector('#app')?.textContent?.replace(/\\s+/g,' ').trim().slice(0,1200)||'',
        }));
        console.error('Accepted deletion confirmation missing:',JSON.stringify({...state,pageErrors:errors}));
        throw error;
      }
      await page.getByText(/No further action is required/).waitFor();
      assert.equal(await page.locator('.player-profile-page').count(),0,name+' accepted deletion receipt must remain terminal');
      assert.deepEqual(deleteBody(),{currentPassword:'fixture-current-value',confirm:true});
      assert.deepEqual(errors,[],name+' accepted deletion emitted page errors');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),name+' accepted deletion overflowed');
      await page.screenshot({path:`artifacts/ui-account-deletion-accepted-${name}-mobile.png`,fullPage:true});
      await page.close();
    }

    {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      const deleteBody=await installApi(page,{result:'complete'});
      await page.goto(base+'/tests/credential-management-harness.html');
      await submitDeletion(page);
      await page.waitForURL('**/?account=deleted');
      await page.getByText('Your Pack One account has been deleted.').waitFor();
      await page.getByText('This action cannot be undone.').waitFor();
      assert.equal(await page.locator('.player-profile-page').count(),0,name+' completed deletion receipt must remain terminal');
      assert.deepEqual(deleteBody(),{currentPassword:'fixture-current-value',confirm:true});
      await page.close();
    }

    {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      await installApi(page,{password:false,google:true});
      await page.goto(base+'/tests/credential-management-harness.html');
      await page.getByText('Deletion is temporarily unavailable for Google-only accounts.').waitFor();
      assert.equal(await page.locator('#account-delete').count(),0);
      assert.equal(await page.getByRole('button',{name:'Delete account'}).isDisabled(),true);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),name+' Google-only deletion state overflowed');
      await page.screenshot({path:`artifacts/ui-account-deletion-google-only-${name}-mobile.png`,fullPage:true});
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
console.log('Account deletion Chromium/WebKit mobile contract passed.');
