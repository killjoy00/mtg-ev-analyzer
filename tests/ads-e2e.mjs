import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
try{
  for(const scenario of [
    {name:'disabled preview',enabled:false,signed:true,expected:0},
    {name:'Supporter',enabled:true,signed:true,status:{ad_free:true,ads_allowed:false},expected:0},
    {name:'Elite',enabled:true,signed:true,status:{ad_free:true,ads_allowed:false},expected:0},
    {name:'unknown older backend',enabled:true,signed:true,status:{},expected:0},
    {name:'provider failure',enabled:true,signed:true,error:true,expected:0},
    {name:'confirmed nonmember',enabled:true,signed:true,status:{ad_free:false,ads_allowed:true},expected:1},
    {name:'guest',enabled:true,signed:false,expected:1},
  ]){
    const context=await browser.newContext(),page=await context.newPage();let google=0,membership=0;
    if(scenario.signed)await context.addInitScript(()=>localStorage.setItem('pack1-auth-session-v1','ad-test-account'));
    await page.route('**/ad-config.js',route=>route.fulfill({contentType:'text/javascript',body:`window.PACKONE_ADSENSE=${JSON.stringify({enabled:scenario.enabled,client:'ca-pub-fixture',slots:{articleTop:'fixture'}})};`}));
    await page.route('**/v1/patreon/status',route=>{membership++;assert.equal(route.request().headers()['x-pack1-auth-session'],'ad-test-account');return route.fulfill({status:scenario.error?503:200,contentType:'application/json',body:JSON.stringify(scenario.status||{})});});
    await page.route('https://pagead2.googlesyndication.com/**',route=>{google++;return route.fulfill({contentType:'text/javascript',body:''});});
    await page.goto(base+'/how-it-works/?adpreview=1');
    await page.evaluate(async()=>await(await import('/ads.mjs')).adsReady);
    assert.equal(await page.locator('script[src*="googlesyndication"]').count(),scenario.expected,scenario.name);
    assert.equal(await page.locator('[data-ad-slot]:visible').count(),scenario.expected,scenario.name);
    if(!scenario.expected)assert.equal(google,0,scenario.name+' must not contact Google');
    if(!scenario.enabled)assert.equal(membership,0,'disabled ads must not query membership');
    if(scenario.expected){
      await page.evaluate(()=>window.dispatchEvent(new Event('packone-account-changed')));
      assert.equal(await page.locator('[data-ad-slot]:visible').count(),0,'sign-in removes slots immediately');
    }
    await context.close();
  }
  console.log('Advertising browser contract passed: disabled, both paid tiers, unknown/failure, guests, and account changes. All Google requests were intercepted.');
}finally{await browser.close();}
