import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});

async function noOverflow(page,label) {
  const metrics=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
  assert.ok(metrics.scroll<=metrics.client+1,`${label} horizontal overflow: ${metrics.scroll} > ${metrics.client}`);
}

try {
  const guest=await browser.newPage({viewport:{width:390,height:844}});
  await guest.goto(base+'/practice/',{waitUntil:'domcontentloaded'});
  await guest.getByRole('heading',{name:'Keep drafting.'}).waitFor();
  assert.equal(await guest.getByRole('link',{name:'Sign in or create an account'}).count(),1);
  assert.equal(await guest.getByRole('link',{name:'Back to Dailies'}).count(),1);
  await noOverflow(guest,'guest Practice hub');
  await guest.close();

  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(()=>localStorage.setItem('pack1-auth-session-v1','practice-hub-auth'));
  const page=await context.newPage();
  let elite=false;
  await page.route('**/*.neon.tech/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let body={ok:true},status=200;
    if(path==='/v1/account/session')body={user:{id:'practice-user',email:'practice@example.com',name:'Practice Player'}};
    else if(path==='/v1/patreon/status')body=elite
      ? {configured:true,connected:true,membership:{effective_state:'elite_entitled'},capabilities:['custom_corpus','unlimited_cube_practice']}
      : {configured:true,connected:false,membership:null,capabilities:[]};
    else if(path==='/v1/session')body={token:'practice-browser'};
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });

  await page.goto(base+'/practice/',{waitUntil:'domcontentloaded'});
  await page.locator('[data-practice-hub]').waitFor();
  assert.equal(await page.locator('.practice-card').count(),3);
  assert.equal(await page.getByRole('heading',{name:'Draft Run',exact:true}).count(),1);
  assert.equal(await page.getByRole('heading',{name:'Powered Cube',exact:true}).count(),1);
  assert.equal(await page.getByRole('heading',{name:'Choose your sets',exact:true}).count(),1);
  assert.equal(await page.getByRole('link',{name:'Start Draft Run',exact:true}).getAttribute('href'),'/?game=draft-run');
  assert.equal(await page.getByRole('button',{name:'Upgrade to Elite',exact:true}).count(),2);
  assert.equal(await page.locator('[data-nav="practice"]').getAttribute('aria-current'),'page');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await noOverflow(page,`free Practice hub at ${width}`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'artifacts/practice-hub-free-mobile.png',fullPage:true});

  elite=true;
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('[data-practice-hub][data-elite="1"]').waitFor();
  assert.equal(await page.getByRole('button',{name:'Upgrade to Elite',exact:true}).count(),0);
  assert.equal(await page.getByRole('link',{name:'Start Powered Cube',exact:true}).getAttribute('href'),'/?game=draft-run&set=powered-cube');
  assert.equal(await page.getByRole('link',{name:'Choose your sets',exact:true}).getAttribute('href'),'/?game=draft-run&custom=1');
  await noOverflow(page,'Elite Practice hub');
  await page.screenshot({path:'artifacts/practice-hub-elite-mobile.png',fullPage:true});
  await context.close();

  console.log('Dedicated Practice hub guest, free, Elite, nav, and responsive states passed.');
} finally {
  await browser.close();
}
