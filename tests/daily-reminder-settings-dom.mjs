// Actual settings DOM/event behavior in Chromium, with synthetic account APIs.
// This deliberately makes no network requests: it is not real email delivery,
// a production deployment, or a replacement for the routed Account E2E below.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
const cssFile=(file,seen=new Set())=>{
  if(seen.has(file))return '';seen.add(file);
  let css=fs.readFileSync(file,'utf8').replace(/@import url\(["']([^"']+)["']\);/g,(_,relative)=>cssFile(path.resolve(path.dirname(file),relative.split('?')[0]),seen));
  return css.replace(/url\((?:["'])?([^)\'"?]+\.woff2)(?:["'])?\)/g,(_,relative)=>'url(data:font/woff2;base64,'+fs.readFileSync(path.resolve(path.dirname(file),relative)).toString('base64')+')');
};
const source=fs.readFileSync('daily-reminder-settings.mjs','utf8').replace(/^import .*;\n/,'').replaceAll('export ','');
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'America/Chicago'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const checked=[];
async function check(name,fn){await fn();checked.push(name);console.log('PASS '+name);}
const input=name=>page.locator('#daily-reminder-form [name="'+name+'"]');
const text=()=>page.locator('#daily-reminder-content').innerText();
async function ready(){await page.locator('#daily-reminder-form').waitFor();}
async function render(changes={}){await page.evaluate(async changes=>window.reminderFixture.render(changes),changes);await ready();}
try {
  await page.setContent('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"></head><body><main class="my-pack-one-page my-pack-one-account-panel" style="max-width:960px;margin:24px auto;padding:16px"><h1>Account settings</h1><div class="profile-account" id="settings-test"></div></main></body></html>');
  await page.addStyleTag({content:cssFile(path.resolve('visual-c.css'))+'\n'+cssFile(path.resolve('profile.css'))});
  await page.evaluate(source=>{
    const initial=()=>({schedule:{frequency:'daily',weekdays:[1],localTime:'09:00',timeZone:'America/Chicago'},email:{enabled:false,eligible:true,suppressed:false,consentedAt:null,deliveredAt:null,deliveryActive:true},push:{enabled:false,consentedAt:null,providerAcceptedAt:null,deliveryActive:false},nextAt:null});
    const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
    const h={A,B,owner:A,states:{[A]:initial(),[B]:initial()},saves:[],verifications:[],releases:[],delay:null,error:false};
    const getAuthSession=async()=>h.owner?{user:{id:h.owner,email:h.owner+'@example.invalid'}}:null;
    const loadDailyReminders=async()=>{
      if(h.error)throw Error('Backend temporarily unavailable.');
      const owner=h.owner,value=structuredClone(h.states[owner]);
      if(h.delay==='load'&&owner===A){h.delay=null;await new Promise(resolve=>h.releases.push(resolve));}
      return value;
    };
    const saveDailyReminders=async value=>{
      if(value.expectedAccountId!==h.owner)throw Error('Account changed.');
      assertFields(value);
      const owner=h.owner,state=h.states[owner];h.saves.push(structuredClone(value));
      state.email.enabled=value.enabled;state.email.consentedAt||='2026-10-18T12:00:00Z';
      state.schedule={frequency:value.frequency,weekdays:value.weekdays,localTime:value.localTime,timeZone:value.timeZone};
      state.nextAt=value.enabled?'2026-10-20T14:00:00Z':null;
      if(h.delay==='save'){h.delay=null;await new Promise(resolve=>h.releases.push(resolve));}
      return structuredClone(state);
    };
    function assertFields(value){if(value.channel!=='email'||'email' in value||'pushEnabled' in value)throw Error('Wrong channel or arbitrary destination.');}
    const requestVerificationEmail=async email=>{h.verifications.push(email);};
    const module=new Function('getAuthSession','loadDailyReminders','saveDailyReminders','requestVerificationEmail','ACCOUNT_SIGNAL_KEY',source+'\nreturn {dailyReminderSettingsMarkup,bindDailyReminderSettings};')(getAuthSession,loadDailyReminders,saveDailyReminders,requestVerificationEmail,'fixture-account-signal');
    h.render=async changes=>{
      Object.assign(h.states[h.owner].email,changes.email||{});
      Object.assign(h.states[h.owner].push,changes.push||{});
      Object.assign(h.states[h.owner].schedule,changes.schedule||{});
      document.querySelector('#settings-test').innerHTML=module.dailyReminderSettingsMarkup({signedIn:Boolean(h.owner)});
      return module.bindDailyReminderSettings();
    };
    h.switchOwner=owner=>{h.owner=owner;window.dispatchEvent(new Event('packone-account-changed'));};
    h.release=()=>{for(const resolve of h.releases.splice(0))resolve();};
    window.reminderFixture=h;
  },source);
  await check('both channels default off, no arbitrary destination or automatic request',async()=>{
    await render();assert.equal(await input('emailEnabled').isChecked(),false);
    assert.equal(await page.locator('#daily-reminder-form [name="email"]').count(),0);
    assert.match(await text(),/Push: Off/);assert.equal(await page.evaluate(()=>reminderFixture.saves.length),0);
  });
  await check('email activation does not require push readiness or enable push',async()=>{
    await input('emailEnabled').check();await page.getByRole('button',{name:'Save email reminders',exact:true}).click();
    await page.getByText('Email reminder schedule saved.',{exact:true}).waitFor();
    assert.match(await text(),/Push: Off/);assert.equal(await page.evaluate(()=>reminderFixture.states[reminderFixture.owner].push.enabled),false);
    assert.deepEqual(await page.evaluate(()=>reminderFixture.saves[0].weekdays),[0,1,2,3,4,5,6]);
  });
  await check('weekly validation and saved local schedule survive reload',async()=>{
    await input('frequency').selectOption('weekly');await page.getByRole('button',{name:'Save email reminders',exact:true}).click();
    await page.getByText('Select exactly one day for weekly reminders.',{exact:true}).waitFor();
    for(const item of await input('weekdays').all())await item.uncheck();
    await page.locator('[name="weekdays"][value="3"]').check();await input('localTime').fill('18:30');await input('timeZone').fill('America/Denver');
    await page.getByRole('button',{name:'Save email reminders',exact:true}).click();await page.getByText('Email reminder schedule saved.',{exact:true}).waitFor();
    await render();assert.match(await text(),/Saved: Wed at 18:30 \(America\/Denver\)/);
  });
  await check('immediate opt-out uses persisted schedule despite invalid editor fields',async()=>{
    await input('timeZone').fill('Not/AZone');await input('localTime').fill('');
    await page.getByRole('button',{name:'Turn off email now',exact:true}).click();await page.getByText('Email reminders turned off.',{exact:true}).waitFor();
    assert.equal(await input('emailEnabled').isChecked(),false);
    assert.equal(await page.evaluate(()=>reminderFixture.saves.at(-1).timeZone),'America/Denver');
  });
  await check('unverified account has disabled opt-in and explicit account-bound verification',async()=>{
    await render({email:{eligible:false}});assert.equal(await input('emailEnabled').isDisabled(),true);
    await page.getByRole('button',{name:'Send verification email',exact:true}).click();await page.getByText('Verification requested. Check your account email.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>reminderFixture.verifications.at(-1)),await page.evaluate(()=>reminderFixture.owner+'@example.invalid'));
  });
  await check('bounce suppression blocks re-opt-in and changed address requires reconsent guidance',async()=>{
    await render({email:{eligible:true,suppressed:true}});assert.equal(await input('emailEnabled').isDisabled(),true);assert.match(await text(),/bounce or complaint/);
    await render({email:{suppressed:false,addressChanged:true}});assert.match(await text(),/new verified address/);
  });
  await check('backend-first/frontend-first rollout failure gives a retry, not a silent successful save',async()=>{
    await page.evaluate(async()=>{reminderFixture.error=true;await reminderFixture.render({});});
    await page.getByRole('button',{name:'Retry',exact:true}).waitFor();assert.equal(await page.locator('#daily-reminder-form').count(),0);
    await page.evaluate(()=>{reminderFixture.error=false;});await page.getByRole('button',{name:'Retry',exact:true}).click();await ready();
  });
  await check('account switch clears an in-flight previous-account save and cannot overwrite B',async()=>{
    await render({email:{addressChanged:false}});await input('emailEnabled').check();await page.evaluate(()=>{reminderFixture.delay='save';});
    await page.getByRole('button',{name:'Save email reminders',exact:true}).click();await page.waitForFunction(()=>reminderFixture.releases.length===1);
    await page.evaluate(()=>reminderFixture.switchOwner(reminderFixture.B));await ready();await page.evaluate(()=>reminderFixture.release());
    await page.waitForFunction(()=>document.querySelector('[name="timeZone"]').value==='America/Chicago');
    assert.equal(await input('emailEnabled').isChecked(),false);assert.doesNotMatch(await text(),/Email reminder schedule saved\./);
  });
  await check('post-save reload racing account switch cannot attach A success to B',async()=>{
    await page.evaluate(()=>reminderFixture.switchOwner(reminderFixture.A));await ready();await page.evaluate(()=>{reminderFixture.delay='load';});
    await page.getByRole('button',{name:'Save email reminders',exact:true}).click();await page.waitForFunction(()=>reminderFixture.releases.length===1);
    await page.evaluate(()=>reminderFixture.switchOwner(reminderFixture.B));await ready();await page.evaluate(()=>reminderFixture.release());
    await page.waitForTimeout(50);assert.equal(await input('emailEnabled').isChecked(),false);assert.doesNotMatch(await text(),/Email reminder schedule saved\./);
  });
  await check('responsive controls remain in the viewport at 320, 390 and 1440 pixels',async()=>{
    await fs.promises.mkdir('artifacts/reminders',{recursive:true});
    for(const width of [320,390,1440]){
      await page.setViewportSize({width,height:900});await page.evaluate(()=>document.fonts.ready);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'overflow at '+width);
      for(const item of await page.locator('#daily-reminder-form input, #daily-reminder-form select, #daily-reminder-form button').all()){
        const box=await item.boundingBox();assert.ok(box&&box.x>=-1&&box.x+box.width<=width+1,'control out of bounds');
      }
      await page.screenshot({path:'artifacts/reminders/settings-'+width+'.png',fullPage:true});
    }
  });
  await check('logout clears settings without exposing the previous account schedule',async()=>{
    await page.evaluate(()=>reminderFixture.switchOwner(null));await page.getByText('Sign in and verify your account email to manage Daily reminders.',{exact:true}).waitFor();
    assert.equal(await page.locator('#daily-reminder-form').count(),0);
  });
  assert.deepEqual(errors,[]);console.log('Completed '+checked.length+' actual Chromium settings DOM contracts with synthetic APIs.');
}finally{await browser.close();}
