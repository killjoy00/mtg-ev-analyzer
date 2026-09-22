import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));

const accountUser={id:'22222222-2222-4222-8222-222222222222',email:'qa@example.invalid',name:'QA Player'};
const disconnected={configured:true,connected:false,membership:null,capabilities:[],support_url:'https://www.patreon.com/c/PackOne'};
const elite={configured:true,connected:true,membership:{effective_state:'elite_entitled',sync_pending:false},capabilities:['custom_corpus','unlimited_cube_practice'],support_url:'https://www.patreon.com/c/PackOne'};
const supporter={configured:true,connected:true,membership:{effective_state:'active_non_elite',sync_pending:false},capabilities:[],support_url:'https://www.patreon.com/c/PackOne'};
const pending={configured:true,connected:true,membership:{effective_state:'active_non_elite',sync_pending:true},capabilities:[],support_url:'https://www.patreon.com/c/PackOne'};
const notEntitled={configured:true,connected:true,membership:{effective_state:'not_entitled',sync_pending:false},capabilities:[],support_url:'https://www.patreon.com/c/PackOne'};

let signed=false;
let verificationRequired=false;
let patreonStatus=disconnected;
let connectCalls=0;
let linkCalls=0;

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
  if(path==='/v1/player/session')body={ok:true};
  else if(path==='/v1/account/session'){
    status=signed?200:401;
    body=signed?{user:accountUser,session:{expiresAt:'2099-01-01T00:00:00Z'}}:{error:'Account session required.'};
  } else if(path==='/v1/account/signin'){
    signed=true;body={ok:true,user:accountUser};
  } else if(path==='/v1/account/signup'){
    const input=route.request().postDataJSON();
    if(verificationRequired)body={ok:true,verificationRequired:true,email:input.email};
    else {signed=true;body={ok:true,user:{...accountUser,email:input.email,name:input.name}};}
  } else if(path==='/v1/account/link-browser'){
    linkCalls++;body={ok:true,merged:false,displayName:'QA Player'};
  } else if(path==='/v1/account/migrate'){
    signed=true;body={ok:true};
  } else if(path==='/v1/patreon/status'){
    body=patreonStatus;
  } else if(path==='/v1/patreon/connect'){
    connectCalls++;
    body={url:'https://www.patreon.com/oauth2/authorize?response_type=code&client_id=fixture&redirect_uri=https%3A%2F%2Fexample.invalid%2Fcallback&scope=identity&state='+String(connectCalls).padStart(64,'a')};
  } else if(path==='/v1/events'){
    body={ok:true,accepted:1};
  } else if(path==='/v1/profile/me'){
    body={player:{claimed:true,profile_public:false,display_name:'QA Player'},summary:{games:1},achievements:[],by_set:[],best_environments:[],daily_history:[],recent:[],trend:[]};
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
});

await page.route('https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/sign-in/social'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({url:'https://accounts.google.test/fixture'})});
  if(path.endsWith('/get-session'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({session:{token:'google-session'},user:accountUser})});
  return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Not found.'})});
});

await page.route('https://accounts.google.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Google fixture</title><p>Google</p>'}));
await page.route('https://www.patreon.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Patreon fixture</title><p>Patreon</p>'}));

async function reset({isSigned=false,status=disconnected,verify=false}={}){
  signed=isSigned;verificationRequired=verify;patreonStatus=status;connectCalls=0;linkCalls=0;
  await page.goto(base+'/leaderboard-config.js');
  await page.evaluate(()=>{sessionStorage.clear();localStorage.clear();});
}

async function fill(kind){
  await page.locator('#account-signin,#account-signup').first().waitFor();
  if(await page.locator('#account-'+kind).count()===0)await page.locator('#account-mode-toggle').click();
  const form=page.locator('#account-'+kind);await form.waitFor();
  if(kind==='signup')await form.locator('[name="name"]').fill('QA Player');
  await form.locator('[name="email"]').fill('qa@example.invalid');
  await form.locator('[name="password"]').fill('fixture-password-123');
  await form.getByRole('button',{name:kind==='signup'?'Create account':'Sign in',exact:true}).click();
}

try {
  // Password auth keeps a separate activation marker through account auth and Patreon OAuth.
  await reset();
  await page.goto(base+'/?patreon=activate');
  await page.locator('#account-signup').waitFor();
  assert.equal((await page.locator('.account-page h1').textContent())?.trim(),'Activate Pack One Elite');
  assert.equal(await page.evaluate(()=>Boolean(sessionStorage.getItem('pack1-patreon-activation-v1'))),true);
  await fill('signin');
  await page.waitForURL(/https:\/\/www\.patreon\.com\/oauth2\/authorize/);
  assert.equal(connectCalls,1);
  assert.ok(linkCalls>0);
  patreonStatus=elite;
  await page.goto(base+'/?patreon=connected');
  await page.getByText('Elite is active.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Choose your sets',exact:true}).count(),1);
  assert.equal(await page.getByRole('link',{name:'Start Powered Cube practice',exact:true}).count(),1);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('pack1-patreon-activation-v1')),null,'terminal success clears activation intent');
  await page.screenshot({path:'artifacts/ui-patreon-activation-success-390.png',fullPage:true});

  // Account creation does not bypass verification and retains activation for the eventual verified return.
  await reset({verify:true});
  await page.goto(base+'/?patreon=activate');
  await fill('signup');
  await page.getByText(/Check your email — we sent a verification link/).waitFor();
  assert.equal(signed,false);
  assert.equal(connectCalls,0);
  assert.equal(await page.evaluate(()=>Boolean(sessionStorage.getItem('pack1-patreon-activation-v1'))),true);

  // Google consumes its one-shot auth flow but the Patreon activation marker survives into Patreon and back.
  await reset();
  await page.goto(base+'/?patreon=activate');
  await page.locator('#account-google').click();
  await page.waitForURL('https://accounts.google.test/fixture');
  await page.goto(base+'/?auth=google&neon_auth_session_verifier=fixture');
  await page.waitForURL(/https:\/\/www\.patreon\.com\/oauth2\/authorize/);
  assert.equal(connectCalls,1);
  patreonStatus=disconnected;
  await page.goto(base+'/?patreon=expired');
  await page.getByText('Your Patreon authorization expired.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>Boolean(sessionStorage.getItem('pack1-patreon-activation-v1'))),true,'recoverable OAuth result keeps activation intent');
  await page.getByRole('link',{name:'Back to Pack One',exact:true}).click();
  await page.waitForURL(base+'/');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('pack1-patreon-activation-v1')),null,'deliberate exit clears activation intent');

  // Already Elite is terminal success and never starts unnecessary OAuth.
  await reset({isSigned:true,status:elite});
  await page.goto(base+'/?patreon=activate');
  await page.getByText('Elite is active.',{exact:true}).waitFor();
  assert.equal(connectCalls,0);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('pack1-patreon-activation-v1')),null);

  // A connected active Supporter is explicitly non-Elite, not pending.
  await reset({isSigned:true,status:supporter});
  await page.goto(base+'/?patreon=activate');
  await page.getByText('Patreon is connected, but Elite is not active.',{exact:true}).waitFor();
  assert.doesNotMatch((await page.locator('.patreon-activation-page').textContent())||'',/waiting for the latest membership update/i);
  assert.equal(connectCalls,0);
  await page.getByRole('button',{name:'Check Patreon again',exact:true}).click();
  await page.waitForURL(/https:\/\/www\.patreon\.com\/oauth2\/authorize/);
  assert.equal(connectCalls,1);

  // Real sync_pending is pending even if the last authoritative row was a Supporter.
  await reset({isSigned:true,status:pending});
  await page.goto(base+'/?patreon=activate');
  await page.getByText('We’re waiting for the latest membership update.',{exact:true}).waitFor();
  assert.equal(connectCalls,0);

  // Authoritative non-entitlement is truthful and is not mislabeled pending.
  await reset({isSigned:true,status:notEntitled});
  await page.goto(base+'/?patreon=activate');
  await page.getByText('Patreon is connected, but Pack One does not currently see an active Elite entitlement.',{exact:true}).waitFor();
  assert.doesNotMatch((await page.locator('.patreon-activation-page').textContent())||'',/waiting for the latest membership update/i);

  // Provider identity uniqueness gets a safe focused result with no other-account details.
  await reset({isSigned:true,status:disconnected});
  await page.evaluate(()=>sessionStorage.setItem('pack1-patreon-activation-v1',JSON.stringify({source:'oauth_return'})));
  await page.goto(base+'/?patreon=conflict');
  const conflict=(await page.locator('.patreon-activation-page').textContent())||'';
  assert.match(conflict,/already connected to another Pack One account/i);
  assert.doesNotMatch(conflict,/qa@example\.invalid|22222222-2222-4222-8222-222222222222/i);
  assert.equal(connectCalls,0);

  // A different Patreon identity cannot silently replace the account's existing provider link.
  await reset({isSigned:true,status:supporter});
  await page.evaluate(()=>sessionStorage.setItem('pack1-patreon-activation-v1',JSON.stringify({source:'oauth_return'})));
  await page.goto(base+'/?patreon=identity-mismatch');
  await page.getByText('This Pack One account is already connected to a different Patreon account.',{exact:true}).waitFor();
  assert.equal(connectCalls,0);

  assert.deepEqual(errors,[]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
  console.log('Patreon activation browser contract passed: auth continuation, two-hop OAuth resume, classification, recovery, conflict safety and terminal cleanup.');
} finally {
  await browser.close();
}
