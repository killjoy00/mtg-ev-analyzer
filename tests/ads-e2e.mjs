import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const HOME_SLOT='1543495960';
const googleStub=`(()=>{const q=window.adsbygoogle||[];const fill=()=>{const ad=document.querySelector("ins.adsbygoogle:not([data-test-filled])");if(ad){ad.dataset.testPrefillWidth=String(ad.offsetWidth);ad.dataset.testFilled="1";ad.innerHTML='<div data-test-creative style="min-height:90px;display:grid;place-items:center;width:100%">Advertisement</div>';}};q.forEach(fill);const push=Array.prototype.push;q.push=function(){const n=push.apply(q,arguments);fill();return n;};window.adsbygoogle=q;fill();})();`;
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});

function dailyFixture(signed=false){
  return {player:{claimed:signed},capabilities:[],membership:{connected:false},daily_history:[],summary:{}};
}

async function installRoutes(page,{signed=false,config='enabled',status={ads_allowed:true},error=false,articleTop='article-fixture'}={}){
  const state={google:0,membership:0,blocked:[]};
  await page.addInitScript(()=>{
    window.__adTestDebug={accountChanges:0,storageSignals:0};
    addEventListener('packone-account-changed',()=>window.__adTestDebug.accountChanges++);
    addEventListener('storage',event=>{if(event.key==='pack1-account-signal-v1'||event.key==='pack1-auth-session-v1'||event.key===null)window.__adTestDebug.storageSignals++;});
  });
  await page.route('**/ad-config.js',route=>{
    if(config==='real')return route.continue();
    const enabled=config==='enabled';
    const body='window.PACKONE_ADSENSE='+JSON.stringify({enabled,client:'ca-pub-fixture',slots:{home:HOME_SLOT,articleTop,articleInline:''}})+';';
    return route.fulfill({contentType:'text/javascript',body});
  });
  await page.route('https://pagead2.googlesyndication.com/**',route=>{
    state.google++;
    return route.fulfill({contentType:'text/javascript',body:googleStub});
  });
  for(const host of ['googleads.g.doubleclick.net','tpc.googlesyndication.com','fundingchoicesmessages.google.com']){
    await page.route('https://'+host+'/**',route=>{state.blocked.push(route.request().url());return route.abort();});
  }
  await page.route('**/*-pack1growth.compute.c-5.us-east-2.aws.neon.tech/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path==='/v1/patreon/status'){
      state.membership++;
      if(signed)assert.equal(request.headers()['x-pack1-auth-session'],'ad-test-account');
      return route.fulfill({status:error?503:200,contentType:'application/json',body:JSON.stringify(error?{error:'fixture failure'}:status)});
    }
    if(path==='/v1/session')return route.fulfill({contentType:'application/json',body:JSON.stringify({token:'guest-session'})});
    if(path==='/v1/account/session')return route.fulfill({status:signed?200:401,contentType:'application/json',body:JSON.stringify(signed?{user:{id:'qa-user',email:'qa@example.invalid',name:'QA'},session:{expiresAt:'2099-01-01T00:00:00Z'}}:{error:'signed out'})});
    if(path==='/v1/profile/me')return route.fulfill({contentType:'application/json',body:JSON.stringify({...dailyFixture(signed),achievements:[],progress:[],player:{...dailyFixture(signed).player,display_name:'QA',profile_key:'qa'}})});
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true})});
  });
  await page.route('**/*-draftrunapi.compute.c-5.us-east-2.aws.neon.tech/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/v1/daily-status')return route.fulfill({contentType:'application/json',body:JSON.stringify(dailyFixture(signed))});
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true})});
  });
  return state;
}

async function waitFor(state,key,value=1){
  for(let i=0;i<100&&state[key]!==value;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(state[key],value,key+' did not reach '+value);
}

async function assertOneFill(page,state,slotId=HOME_SLOT){
  try {
    await page.locator('ins.adsbygoogle').waitFor({state:'attached',timeout:5000});
  } catch(error) {
    const debug=await page.evaluate(()=>({
      config:window.PACKONE_ADSENSE,
      daily:Boolean(document.querySelector('#app [data-daily-home]')),
      homeSlot:document.querySelector('[data-ad-slot="home"]')?.outerHTML||null,
      accountChanges:window.__adTestDebug?.accountChanges??null,
      storageSignals:window.__adTestDebug?.storageSignals??null,
      authSession:localStorage.getItem('pack1-auth-session-v1'),
      playerSession:Boolean(localStorage.getItem('pack1-api-session-v1')),
      search:location.search,
      bodyClass:document.body.className,
    }));
    throw new Error('Ad fill timed out: '+JSON.stringify(debug),{cause:error});
  }
  assert.equal(state.google,1,'one Google script request');
  assert.equal(await page.locator('script[src*="googlesyndication"]').count(),1);
  assert.equal(await page.locator('ins.adsbygoogle').count(),1);
  assert.equal(await page.locator('ins.adsbygoogle').getAttribute('data-ad-slot'),slotId);
  await page.locator('ins.adsbygoogle[data-test-prefill-width]').waitFor({state:'attached'});
  const prefillWidth=Number(await page.locator('ins.adsbygoogle').getAttribute('data-test-prefill-width'));
  assert.ok(prefillWidth>0,'responsive ad must have a measurable width before the fake creative is injected');
  assert.equal(await page.evaluate(()=>window.adsbygoogle?.length),1);
  await page.locator('[data-test-creative]').waitFor();
  assert.deepEqual(state.blocked,[]);
}

async function refreshHome(page,type){
  await page.locator('[data-daily-home]').evaluate(el=>{el.dataset.adRefreshMarker='1';});
  if(type==='visibility')assert.equal(await page.evaluate(()=>document.hidden),false,'visibility refresh requires a foreground page');
  await page.evaluate(kind=>{
    if(kind==='focus')window.dispatchEvent(new Event('focus'));
    else document.dispatchEvent(new Event('visibilitychange'));
  },type);
  await page.waitForFunction(()=>!document.querySelector('[data-daily-home][data-ad-refresh-marker="1"]'));
}

try{
  {
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
    const state=await installRoutes(page,{config:'real'});
    await page.goto(base);
    await page.locator('[data-daily-home]').waitFor();
    const slot=page.locator('[data-ad-slot="home"]');
    const promo=page.locator('.tcg-affiliate-promo');
    const link=page.locator('.tcg-affiliate-link');
    const logo=page.locator('.tcg-affiliate-logo');
    await promo.waitFor({state:'visible'});
    assert.equal(await slot.count(),1);
    assert.equal(await slot.getAttribute('hidden'),null);
    assert.equal(await slot.getAttribute('data-slot-content'),'affiliate');
    assert.match(await link.getAttribute('href'),/^https:\/\/partner\.tcgplayer\.com\/c\/7742974\/1780961\/21018\?u=/);
    assert.equal(await link.getAttribute('rel'),'sponsored noopener');
    assert.equal(await link.getAttribute('data-tcgplayer-surface'),'daily_home_banner');
    assert.equal(await page.locator('.tcg-affiliate-copy strong').textContent(),'Shop Magic on TCGplayer');
    assert.equal(await page.locator('.tcg-affiliate-copy > span').textContent(),'Singles, sealed product, and more');
    assert.equal(await page.locator('.tcg-affiliate-cta').textContent(),'Shop TCGplayer →');
    assert.equal(await page.locator('.tcg-affiliate-disclosure').textContent(),'Affiliate link — Pack One may earn a commission from purchases.');
    await logo.waitFor({state:'visible'});
    const image=await logo.evaluate(el=>({
      src:new URL(el.currentSrc||el.src).pathname,
      naturalWidth:el.naturalWidth,
      naturalHeight:el.naturalHeight,
      width:el.getBoundingClientRect().width,
      height:el.getBoundingClientRect().height,
    }));
    assert.equal(image.src,'/assets/tcgplayer-logo-primary-stroke.webp');
    assert.deepEqual([image.naturalWidth,image.naturalHeight],[512,227]);
    assert.ok(Math.abs((image.width/image.height)-(512/227))<0.02,'official TCGplayer logo must preserve its aspect ratio');
    assert.equal(state.google,0,'affiliate fallback never contacts Google');
    assert.equal(state.membership,0,'guest affiliate fallback skips membership');
    assert.deepEqual(state.blocked,[]);

    for(const width of [320,390,1280]){
      await page.setViewportSize({width,height:width===1280?900:844});
      const dimensions=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
      assert.ok(dimensions.scroll<=dimensions.client,'affiliate banner must not overflow at '+width+'px');
      assert.ok((await promo.boundingBox()).width>0,'affiliate banner must remain measurable at '+width+'px');
      await page.screenshot({path:'artifacts/tcgplayer-home-'+width+'.png',fullPage:true});
    }
    await context.close();
  }

  {
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
    const state=await installRoutes(page,{signed:false});
    await page.goto(base);
    await page.locator('[data-daily-home]').waitFor();
    await assertOneFill(page,state);
    assert.equal(state.membership,0,'guests never need a membership request');
    await refreshHome(page,'focus');
    await refreshHome(page,'visibility');
    await assertOneFill(page,state);
    assert.equal(state.google,1,'Daily re-renders do not request a second ad');

    for(const width of [320,390,1280]){
      await page.setViewportSize({width,height:width===1280?900:844});
      const dimensions=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
      assert.ok(dimensions.scroll<=dimensions.client,'home ad must not overflow at '+width+'px');
      assert.equal(await page.evaluate(()=>{
        const app=document.querySelector('#app'),slot=document.querySelector('[data-ad-slot="home"]');
        return Boolean(app&&slot&&slot.parentElement?.classList.contains('app-shell')&&(app.compareDocumentPosition(slot)&Node.DOCUMENT_POSITION_FOLLOWING));
      }),true,'home banner stays after the complete Daily/practice app content');
      await page.screenshot({path:'artifacts/ads-home-'+width+'.png',fullPage:true});
    }

    await page.setViewportSize({width:390,height:844});
    await page.locator('#account-nav').click();
    await page.locator('#account-signin').waitFor();
    await page.locator('[data-ad-slot="home"]').waitFor({state:'hidden'});
    assert.equal(await page.locator('ins.adsbygoogle').count(),0);
    assert.equal(state.google,1);
    await page.evaluate(async()=>{(await import('/daily-home.mjs')).renderDailyHome();});
    await page.locator('[data-daily-home]').waitFor();
    assert.notEqual(await page.locator('[data-ad-slot="home"]').getAttribute('hidden'),null,'returning in-place cannot refill a spent page load');
    assert.equal(state.google,1);
    await context.close();
  }

  {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(()=>localStorage.setItem('pack1-auth-session-v1','ad-test-account'));
    const page=await context.newPage(),state=await installRoutes(page,{signed:true,status:{ad_free:false,ads_allowed:true}});
    await page.goto(base);
    await page.locator('[data-daily-home]').waitFor();
    await waitFor(state,'membership',1);
    await assertOneFill(page,state);
    await context.close();
  }

  {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(()=>localStorage.setItem('pack1-auth-session-v1','ad-test-account'));
    const page=await context.newPage(),state=await installRoutes(page,{signed:true,config:'disabled',status:{ad_free:false,ads_allowed:true}});
    await page.goto(base);
    await page.locator('[data-daily-home]').waitFor();
    await waitFor(state,'membership',1);
    await page.locator('.tcg-affiliate-promo').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-ad-slot="home"]').getAttribute('data-slot-content'),'affiliate');
    assert.equal(state.google,0);
    assert.equal(state.membership,1);
    await context.close();
  }

  for(const scenario of [
    {name:'ad-free membership',status:{ad_free:true,ads_allowed:false}},
    {name:'unknown response',status:{}},
    {name:'provider failure',status:{},error:true},
  ]){
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(()=>localStorage.setItem('pack1-auth-session-v1','ad-test-account'));
    const page=await context.newPage(),state=await installRoutes(page,{signed:true,status:scenario.status,error:scenario.error});
    await page.goto(base);
    await page.locator('[data-daily-home]').waitFor();
    await waitFor(state,'membership',1);
    assert.equal(state.google,0,scenario.name+' must not contact Google');
    assert.equal(await page.locator('ins.adsbygoogle').count(),0,scenario.name);
    assert.notEqual(await page.locator('[data-ad-slot="home"]').getAttribute('hidden'),null,scenario.name);
    await context.close();
  }

  for(const scenario of [
    {name:'affiliate ad-free membership',status:{ad_free:true,ads_allowed:false}},
    {name:'affiliate unknown response',status:{}},
    {name:'affiliate provider failure',status:{},error:true},
  ]){
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(()=>localStorage.setItem('pack1-auth-session-v1','ad-test-account'));
    const page=await context.newPage(),state=await installRoutes(page,{signed:true,config:'disabled',status:scenario.status,error:scenario.error});
    await page.goto(base);
    await page.locator('[data-daily-home]').waitFor();
    await waitFor(state,'membership',1);
    assert.equal(state.google,0,scenario.name+' must not contact Google');
    assert.equal(await page.locator('.tcg-affiliate-promo').count(),0,scenario.name);
    assert.notEqual(await page.locator('[data-ad-slot="home"]').getAttribute('hidden'),null,scenario.name);
    await context.close();
  }

  {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const pageA=await context.newPage(),stateA=await installRoutes(pageA,{signed:false});
    await pageA.goto(base);await pageA.locator('[data-daily-home]').waitFor();await assertOneFill(pageA,stateA);
    const pageB=await context.newPage();await installRoutes(pageB,{config:'disabled'});
    await pageB.goto(base+'/how-it-works/');
    await pageB.evaluate(async()=>{(await import('/growth-api.mjs')).signalAccountChange();});
    await pageA.locator('[data-ad-slot="home"]').waitFor({state:'hidden'});
    assert.equal(await pageA.locator('ins.adsbygoogle').count(),0);
    assert.equal(stateA.google,1,'cross-tab signal clears without a replacement');
    await context.close();
  }

  {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const pageA=await context.newPage(),stateA=await installRoutes(pageA,{signed:false,config:'disabled'});
    await pageA.goto(base);
    await pageA.locator('[data-daily-home]').waitFor();
    await pageA.locator('.tcg-affiliate-promo').waitFor({state:'visible'});
    const pageB=await context.newPage();await installRoutes(pageB,{config:'disabled'});
    await pageB.goto(base+'/how-it-works/');
    await pageB.evaluate(async()=>{(await import('/growth-api.mjs')).signalAccountChange();});
    await pageA.locator('[data-ad-slot="home"]').waitFor({state:'hidden'});
    assert.equal(await pageA.locator('.tcg-affiliate-promo').count(),0);
    assert.equal(stateA.google,0,'affiliate invalidation never contacts Google');
    await pageA.evaluate(async()=>{(await import('/daily-home.mjs')).renderDailyHome();});
    await pageA.locator('[data-daily-home]').waitFor();
    assert.notEqual(await pageA.locator('[data-ad-slot="home"]').getAttribute('hidden'),null,'cleared affiliate cannot refill in-place');
    await context.close();
  }

  {
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
    const state=await installRoutes(page,{signed:false,config:'disabled'});
    await page.goto(base+'/?game=draft-run');
    await page.locator('.run-cards').waitFor();
    assert.equal(await page.locator('.tcg-affiliate-promo').count(),0,'gameplay never renders the affiliate fallback');
    assert.notEqual(await page.locator('[data-ad-slot="home"]').getAttribute('hidden'),null);
    assert.equal(state.google,0);
    assert.equal(state.membership,0,'gameplay rejects affiliate fallback before membership lookup');
    await context.close();
  }

  {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(()=>localStorage.setItem('pack1-auth-session-v1','ad-test-account'));
    const pageA=await context.newPage(),stateA=await installRoutes(pageA,{signed:true,status:{ad_free:false,ads_allowed:true}});
    await pageA.goto(base);await pageA.locator('[data-daily-home]').waitFor();await waitFor(stateA,'membership',1);await assertOneFill(pageA,stateA);
    const pageB=await context.newPage();
    await installRoutes(pageB,{signed:true,config:'disabled',status:{configured:true,connected:true,capabilities:[],membership:{effective_state:'active_non_elite'},ads_allowed:true}});
    await pageB.goto(base+'/?patreon=connected');
    await pageA.locator('[data-ad-slot="home"]').waitFor({state:'hidden'});
    assert.equal(stateA.google,1,'Patreon connected signal clears without a replacement');
    await context.close();
  }

  {
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
    const state=await installRoutes(page,{signed:false,articleTop:'article-fixture'});
    await page.goto(base+'/how-it-works/?adpreview=1');
    await assertOneFill(page,state,'article-fixture');
    assert.equal(await page.locator('[data-ad-slot="article-top"]:visible').count(),1,'editorial article-top still fills through its explicit mapping');
    await context.close();
  }

  console.log('Advertising browser contract passed: TCGplayer fallback, Google placement, one-shot lifecycle, membership failures, cross-tab invalidation, responsive visuals, gameplay exclusion and editorial mapping.');
}finally{await browser.close();}
