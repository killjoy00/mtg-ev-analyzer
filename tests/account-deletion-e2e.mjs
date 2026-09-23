import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const user={id:'11111111-1111-4111-8111-111111111111',email:'qa@example.invalid',name:'Test Player'};

async function installApi(page,{
  password=true,
  google=false,
  deletionMethod=password?'password':undefined,
  result='accepted',
  startResponses=[],
  deleteResponses=[],
}={}) {
  let signed=true,deleteBody=null,postDeletePlayerSessions=0,startCount=0;
  const startBodies=[];
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
        deletion:{
          enabled:true,
          available:password,
          googleOnly:google&&!password,
          ...(deletionMethod===undefined?{}:{method:deletionMethod}),
        },
      }:{error:'Account session required.'};
    } else if(path==='/v1/player/session') {
      if(!signed)postDeletePlayerSessions+=1;
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
    } else if(path==='/v1/account/delete/verification/start') {
      startCount+=1;
      startBodies.push(route.request().postDataJSON());
      const response=startResponses[Math.min(startCount-1,startResponses.length-1)];
      if(response==='abort') {
        await route.abort();
        return;
      }
      if(response) {
        status=response.status;
        body=response.body;
      } else {
        body={ok:true,verification:'sent',expiresInSeconds:600};
      }
    } else if(path==='/v1/account/delete') {
      deleteBody=route.request().postDataJSON();
      const response=deleteResponses.shift();
      if(response) {
        status=response.status;
        body=response.body;
      } else {
        signed=false;
        status=result==='complete'?200:202;
        body={ok:true,deletion:result,operationId:'33333333-3333-4333-8333-333333333333'};
      }
    }
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.route('https://api.packone.pro/draft/**',route=>route.fulfill({
    status:404,contentType:'application/json',body:JSON.stringify({error:'Not found.'}),
  }));
  return ()=>({deleteBody,postDeletePlayerSessions,startCount,startBodies});
}

async function openAccountTab(page) {
  await page.locator('.my-pack-one-page').waitFor();
  await page.locator('#profile-account-tab').click();
  await page.locator('#profile-account-panel').waitFor();
}

async function submitPasswordDeletion(page) {
  const form=page.locator('#account-delete');
  await form.waitFor();
  await form.locator('[name="currentPassword"]').fill('fixture-current-value');
  await form.locator('[name="confirm"]').check();
  await form.getByRole('button',{name:'Delete Account'}).click();
}

async function issueEmailCode(page) {
  const form=page.locator('#account-delete-email');
  await form.waitFor();
  await form.locator('[name="confirm"]').check();
  await form.getByRole('button',{name:'Send deletion code'}).click();
  await form.locator('#account-delete-code-step').waitFor();
  return form;
}

async function submitEmailDeletion(page,code='12345678') {
  const form=page.locator('#account-delete-email');
  await form.locator('[name="code"]').fill(code);
  await form.getByRole('button',{name:'Verify and delete account'}).click();
}

async function assertNoOverflow(page,message) {
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),message);
}

for(const [name,type] of [['chromium',chromium],['webkit',webkit]]) {
  console.log(`Account deletion browser: ${name}`);
  const browser=await type.launch({headless:true});
  try {
    // Existing password path remains unchanged and still supports accepted.
    {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      const state=await installApi(page,{result:'accepted'});
      await page.goto(base+'/tests/credential-management-harness.html');
      await openAccountTab(page);
      await page.locator('#account-delete').waitFor();
      assert.match(await page.locator('.profile-danger').textContent(),/This cannot be undone/i);
      assert.equal((await page.locator('#delete-account-title').textContent())?.trim(),'Delete Account');
      await submitPasswordDeletion(page);
      await page.waitForURL('**/?account=deleting');
      await page.getByText('Your deletion request has been accepted.').waitFor();
      await page.getByText(/No further action is required/).waitFor();
      assert.deepEqual(state().deleteBody,{confirm:true,currentPassword:'fixture-current-value'});
      assert.equal(state().postDeletePlayerSessions,0,name+' must not recreate a player session after deletion commits');
      assert.deepEqual(errors,[],name+' accepted password deletion emitted page errors');
      await assertNoOverflow(page,name+' accepted deletion overflowed');
      await page.screenshot({path:`artifacts/ui-account-deletion-accepted-${name}-mobile.png`,fullPage:true});
      await page.close();
    }

    // Existing password path also keeps the synchronous-complete response.
    {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      const state=await installApi(page,{result:'complete'});
      await page.goto(base+'/tests/credential-management-harness.html');
      await openAccountTab(page);
      await submitPasswordDeletion(page);
      await page.waitForURL('**/?account=deleted');
      await page.getByText('Your Pack One account has been deleted.').waitFor();
      await page.getByText('This action cannot be undone.').waitFor();
      assert.deepEqual(state().deleteBody,{confirm:true,currentPassword:'fixture-current-value'});
      assert.equal(state().postDeletePlayerSessions,0,name+' complete deletion must not recreate a player session');
      await page.close();
    }

    // New browser against an old backend with no deletion.method remains safely disabled.
    {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      await installApi(page,{password:false,google:true,deletionMethod:undefined});
      await page.goto(base+'/tests/credential-management-harness.html');
      await openAccountTab(page);
      await page.getByText('Deletion is temporarily unavailable for Google-only accounts.').waitFor();
      assert.equal(await page.locator('#account-delete').count(),0);
      assert.equal(await page.locator('#account-delete-email').count(),0);
      assert.equal(await page.getByRole('button',{name:'Delete account'}).isDisabled(),true);
      await assertNoOverflow(page,name+' old-backend Google-only state overflowed');
      await page.close();
    }

    // Email path: confirmation precedes send, resend is available, no password field,
    // and a successful 202 retires the browser identity.
    {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      const state=await installApi(page,{password:false,google:true,deletionMethod:'email',result:'accepted'});
      await page.goto(base+'/tests/credential-management-harness.html');
      await openAccountTab(page);
      const form=page.locator('#account-delete-email');
      await form.waitFor();
      assert.equal(await form.locator('[name="currentPassword"]').count(),0);
      await form.getByRole('button',{name:'Send deletion code'}).click();
      await form.getByText('Confirm that you understand deletion is permanent.').waitFor();
      assert.equal(state().startCount,0);
      await form.locator('[name="confirm"]').check();
      await form.getByRole('button',{name:'Send deletion code'}).click();
      await form.getByText(/Deletion code sent/i).waitFor();
      assert.equal(state().startCount,1);
      assert.deepEqual(state().startBodies[0],{confirm:true});
      await form.locator('[name="code"]').fill('87654321');
      await form.getByRole('button',{name:'Send a new code'}).click();
      await form.getByText(/Deletion code sent/i).waitFor();
      assert.equal(state().startCount,2);
      assert.equal(await form.locator('[name="code"]').inputValue(),'','resend must clear stale entered code');
      await submitEmailDeletion(page,'12345678');
      await page.waitForURL('**/?account=deleting');
      assert.deepEqual(state().deleteBody,{confirm:true,code:'12345678'});
      assert.equal(state().postDeletePlayerSessions,0,name+' email deletion must not recreate a player session');
      await assertNoOverflow(page,name+' email deletion overflowed');
      await page.close();
    }

    // Wrong/expired codes remain in the verification UI and are not treated as a rollout failure.
    {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      await installApi(page,{
        password:false,google:true,deletionMethod:'email',
        deleteResponses:[{status:400,body:{error:'Deletion code is invalid or expired.',code:'DELETE_CODE_INVALID'}}],
      });
      await page.goto(base+'/tests/credential-management-harness.html');
      await openAccountTab(page);
      await issueEmailCode(page);
      await submitEmailDeletion(page,'00000000');
      await page.getByText('Deletion code is invalid or expired.').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('account'),null);
      await page.close();
    }

    // Provider mail failures keep their specific application message.
    {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      await installApi(page,{
        password:false,google:true,deletionMethod:'email',
        startResponses:[{status:503,body:{error:'Deletion verification email could not be sent. Please try again.',code:'DELETE_EMAIL_SEND_FAILED'}}],
      });
      await page.goto(base+'/tests/credential-management-harness.html');
      await openAccountTab(page);
      const form=page.locator('#account-delete-email');
      await form.locator('[name="confirm"]').check();
      await form.getByRole('button',{name:'Send deletion code'}).click();
      await form.getByText('Deletion verification email could not be sent. Please try again.').waitFor();
      await page.close();
    }

    // Recognizable Pack One start errors retain their intended messages.
    for(const scenario of [
      {status:401,body:{error:'Account session required.',code:'ACCOUNT_SESSION'}},
      {status:429,body:{error:'Too many deletion attempts. Please try again later.',code:'RATE_LIMITED'}},
      {status:503,body:{error:'Account deletion is temporarily unavailable.',code:'DELETION_DISABLED'}},
      {status:409,body:{error:'This account is being deleted.',code:'ACCOUNT_DELETING'}},
    ]) {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      await installApi(page,{password:false,google:true,deletionMethod:'email',startResponses:[scenario]});
      await page.goto(base+'/tests/credential-management-harness.html');
      await openAccountTab(page);
      const form=page.locator('#account-delete-email');
      await form.locator('[name="confirm"]').check();
      await form.getByRole('button',{name:'Send deletion code'}).click();
      await form.getByText(scenario.body.error).waitFor();
      await page.close();
    }

    // The real rollout gap is a rejected fetch caused by the old gateway's
    // preflight/route handling, so this regression must abort rather than fake 404.
    {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      await installApi(page,{password:false,google:true,deletionMethod:'email',startResponses:['abort']});
      await page.goto(base+'/tests/credential-management-harness.html');
      await openAccountTab(page);
      const form=page.locator('#account-delete-email');
      await form.locator('[name="confirm"]').check();
      await form.getByRole('button',{name:'Send deletion code'}).click();
      await form.getByText('Account deletion verification is temporarily unavailable. Please try again.').waitFor();
      await page.close();
    }

    // Gateway-style 404 without a Pack One application code gets the same
    // temporary rollout message rather than a misleading "Not found".
    {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      await installApi(page,{
        password:false,google:true,deletionMethod:'email',
        startResponses:[{status:404,body:{error:'Not found.'}}],
      });
      await page.goto(base+'/tests/credential-management-harness.html');
      await openAccountTab(page);
      const form=page.locator('#account-delete-email');
      await form.locator('[name="confirm"]').check();
      await form.getByRole('button',{name:'Send deletion code'}).click();
      await form.getByText('Account deletion verification is temporarily unavailable. Please try again.').waitFor();
      await page.close();
    }

    // Email path also accepts the completed 200 response.
    {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      const state=await installApi(page,{password:false,google:true,deletionMethod:'email',result:'complete'});
      await page.goto(base+'/tests/credential-management-harness.html');
      await openAccountTab(page);
      await issueEmailCode(page);
      await submitEmailDeletion(page,'12345678');
      await page.waitForURL('**/?account=deleted');
      await page.getByText('Your Pack One account has been deleted.').waitFor();
      assert.deepEqual(state().deleteBody,{confirm:true,code:'12345678'});
      assert.equal(state().postDeletePlayerSessions,0);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
console.log('Account deletion Chromium/WebKit mobile contract passed.');
