// Routed My Pack One integration. All account/provider responses are synthetic;
// the production guard remains installed by the required browser runner.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'America/Chicago'});
const owner='11111111-1111-4111-8111-111111111111';
const user={id:owner,name:'Reminder fixture',email:'reminder-fixture@example.invalid'};
const state={schedule:{frequency:'daily',weekdays:[0,1,2,3,4,5,6],localTime:'23:05',timeZone:'Etc/UTC'},
  email:{enabled:false,eligible:true,suppressed:false,consentedAt:null,deliveredAt:null,deliveryActive:true},
  push:{enabled:false,consentedAt:null,providerAcceptedAt:null,deliveryActive:false},nextAt:null};
const errors=[],assets=[],saves=[];let signed=true,available=true;
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(request.url().startsWith(base))assets.push(new URL(request.url()).pathname+new URL(request.url()).search);});
await page.route('https://api.packone.pro/**',async route=>{
  const request=route.request(),pathname=new URL(request.url()).pathname;
  let status=200,value={ok:true};
  if(pathname==='/growth/v1/account/session'){
    status=signed?200:401;value=signed?{user,session:{expiresAt:'2099-01-01T00:00:00Z'}}:{error:'Account session required.'};
  }else if(pathname==='/growth/v1/profile/me')value={player:{claimed:signed,profile_public:false,display_name:user.name},summary:{games:3},achievements:[],by_set:[],best_environments:[],daily_history:[],recent:[],trend:[]};
  else if(pathname==='/growth/v1/patreon/status')value={configured:true,connected:false,capabilities:[],support_url:'https://www.patreon.com/c/PackOne'};
  else if(pathname==='/growth/v1/account/reminders'){
    if(!available){status=503;value={error:'Reminders temporarily unavailable.'};}
    else if(!signed){status=401;value={error:'Account session required.'};}
    else {
      if(request.method()==='PATCH'){
        const input=request.postDataJSON();assert.deepEqual(Object.keys(input).sort(),['channel','enabled','expectedAccountId']);
        assert.equal(input.expectedAccountId,owner);assert.equal(input.channel,'email');
        saves.push(input);state.email.enabled=input.enabled;state.email.consentedAt='2026-10-18T12:00:00Z';
        state.nextAt=input.enabled?'2026-10-19T23:05:00Z':null;
      }
      value=state;
    }
  }else if(pathname==='/draft/v1/daily-status')value={day:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles'}).format(new Date()),daily_history:[],player:{claimed:signed},capabilities:signed?['account']:[]};
  else if(pathname==='/draft/v1/set-catalog'||pathname==='/draft/v1/practice-sets')value={sets:[]};
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
});
try {
  await page.goto(base+'/tests/auth-context-harness.html');
  await page.locator('#profile-account-tab').click();await page.locator('#daily-reminder-enable').waitFor();
  assert.equal(await page.locator('#daily-reminder-settings').count(),1,'My Pack One must render one reminder setting');
  const order=await page.$$eval('#profile-account h3',items=>items.map(item=>item.id));
  assert.equal(order.indexOf('daily-reminder-heading'),order.indexOf('delete-account-title')-1,'reminders sit directly above Delete account');
  assert.ok(order.indexOf('daily-reminder-heading')>order.indexOf('credential-settings-title'),'reminders come after Sign-in & security');
  assert.doesNotMatch(await page.locator('#daily-reminder-settings').innerText(),/push|notification|device/i,'web settings never mention push');
  assert.equal(saves.length,0);
  assert.ok(assets.includes('/daily-reminder-settings.mjs?v=4'),'new settings asset is loaded');
  assert.ok(assets.includes('/growth-api.mjs?v=2'),'new reminder API exports cannot come from a stale cached module');
  await page.getByRole('button',{name:'Turn on',exact:true}).click();
  await page.getByText('Email reminders turned on.',{exact:true}).waitFor();assert.equal(saves.length,1);assert.equal(state.push.enabled,false);
  assert.equal(saves[0].enabled,true);assert.match(await page.locator('#daily-reminder-settings').innerText(),/Next email:/);
  await page.getByRole('button',{name:'Turn off',exact:true}).click();await page.getByText('Email reminders turned off.',{exact:true}).waitFor();
  assert.equal(saves.at(-1).enabled,false);
  available=false;await page.evaluate(async()=>{await (await import('/daily-reminder-settings.mjs?v=4')).bindDailyReminderSettings();});
  await page.getByRole('button',{name:'Retry',exact:true}).waitFor();assert.equal(await page.locator('#daily-reminder-enable').count(),0);
  available=true;await page.getByRole('button',{name:'Retry',exact:true}).click();await page.locator('#daily-reminder-enable').waitFor();
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  signed=false;await page.evaluate(()=>window.dispatchEvent(new Event('packone-account-changed')));
  await page.waitForFunction(()=>!document.querySelector('#daily-reminder-enable')&&!document.querySelector('#daily-reminder-optout'));assert.deepEqual(errors,[]);
  console.log('Routed My Pack One reminder setting, fresh assets, email-only consent, opt-out, retry, responsive layout and logout passed (synthetic APIs).');
}finally{await browser.close();}
