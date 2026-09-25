// Production frontend, isolated preview APIs. Every production API request is
// intercepted before it can leave the browser. No production identity is used.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {checkBranch} from './edge-control.mjs';
import {summarize} from './practice-performance.mjs';

async function main() {
  const fixture=JSON.parse(fs.readFileSync(process.env.LOAD_FIXTURE_FILE,'utf8'));
  checkBranch(fixture.branch);assert.equal(fixture.branch,process.env.PREVIEW_BRANCH);assert.equal(fixture.sha,process.env.GITHUB_SHA);
  assert.match(process.env.PREVIEW_ACCESS_KEY||'',/^[a-f0-9]{64}$/);
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const identify=async name=>{
    const user=fixture.users[900+['mixed','powered-cube','custom-single','custom-multi'].indexOf(name)];
    await context.addCookies([
    {name:'__Host-pack1_player',value:user.token,url:'https://api.packone.pro/',httpOnly:true,secure:true,sameSite:'Strict'},
    {name:'__Host-pack1_account',value:user.account,url:'https://api.packone.pro/',httpOnly:true,secure:true,sameSite:'Strict'},
    {name:'__Secure-pack1_csrf',value:user.csrf,domain:'.packone.pro',path:'/',secure:true,sameSite:'Strict'},
  ]);
  };
  let apiCalls=0;
  const page=await context.newPage(),errors=[],report={sha:fixture.sha,branch:fixture.branch,
    warm_samples_per_case:20,scope:'Reviewed practice-page HTML with production JS/assets in Chromium; all API traffic rerouted to private preview; mobile viewport',samples:[],budgets:{warm_api_p95_ms:2000,warm_click_p95_ms:3000,cold_click_ms:6000},passed:false};
  // Intercept only API/origin traffic and the reviewed HTML through CDP. Unlike
  // Playwright routing, this leaves ordinary static-resource HTTP caching on.
  const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
  await cdp.send('Fetch.enable',{patterns:[
    {urlPattern:'https://api.packone.pro/*',requestStage:'Request'},
    {urlPattern:'https://*.neon.tech/*',requestStage:'Request'},
    {urlPattern:'https://packone.pro/practice/',requestStage:'Request'},
  ]});
  cdp.on('Fetch.requestPaused',async event=>{
    const {requestId,request}=event,url=new URL(request.url);
    try {
      if(url.hostname.endsWith('.neon.tech')) {
        errors.push('direct_origin');await cdp.send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});return;
      }
      if(url.hostname==='packone.pro') {
        await cdp.send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'content-type',value:'text/html'}],body:fs.readFileSync('practice/index.html').toString('base64')});return;
      }
      apiCalls++;
      const cookies=await context.cookies('https://api.packone.pro/');
      const headers={...request.headers,cookie:cookies.map(c=>c.name+'='+c.value).join('; '),'x-pack1-preview-key':process.env.PREVIEW_ACCESS_KEY};
      delete headers.host;delete headers.Host;
      const response=await fetch('https://api-preview.packone.pro'+url.pathname+url.search,{method:request.method,headers,body:request.postData,redirect:'error',signal:AbortSignal.timeout(90000)});
      const responseHeaders=[...response.headers].filter(([k])=>!['content-encoding','content-length','transfer-encoding','set-cookie'].includes(k)).map(([name,value])=>({name,value}));
      for(const value of response.headers.getSetCookie())responseHeaders.push({name:'set-cookie',value});
      await cdp.send('Fetch.fulfillRequest',{requestId,responseCode:response.status,responseHeaders,body:Buffer.from(await response.arrayBuffer()).toString('base64')});
    } catch {
      errors.push('proxy_failure');await cdp.send('Fetch.failRequest',{requestId,errorReason:'Failed'}).catch(()=>{});
    }
  });
  let staticCacheHits=0;cdp.on('Network.requestServedFromCache',()=>staticCacheHits++);
  page.on('pageerror',()=>errors.push('browser_error'));
  const directory='artifacts/launch-load';fs.mkdirSync(directory,{recursive:true});
  const ready=async configuration=>{
    await identify(configuration.name);
    if(configuration.custom) {
      await page.goto('https://packone.pro/?game=draft-run&custom=1',{waitUntil:'domcontentloaded'});
      await page.locator('#practice-sets').waitFor();
      const choices=page.locator('#practice-sets input[type=checkbox]');
      for(let i=0;i<await choices.count();i++)await choices.nth(i).setChecked(i<configuration.custom);
      return page.getByRole('button',{name:'Start random run',exact:true});
    }
    await page.goto('https://packone.pro/practice/',{waitUntil:'domcontentloaded'});
    const link=page.getByRole('link',{name:configuration.name==='mixed'?'Start Draft Run':'Start Powered Cube',exact:true});
    await link.waitFor();return link;
  };
  const sample=async(configuration,click,phase,idle=null)=>{
    let apiStart,apiMs;
    const started=performance.now();
    const onRequest=request=>{if(new URL(request.url()).pathname==='/draft/v1/runs'&&request.method()==='POST')apiStart=performance.now();};
    page.on('request',onRequest);
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/draft/v1/runs'&&r.request().method()==='POST');
    await click.click();const r=await response;await r.finished();apiMs=performance.now()-apiStart;
    assert.equal(r.status(),200);assert.equal((await r.json()).run_length,8);
    await page.locator('.run-cards').waitFor({state:'visible'});
    // DOM-ready and fully decoded cards are separate measurements.
    const clickMs=performance.now()-started;
    await page.locator('.run-cards img').evaluateAll(images=>Promise.all(images.map(i=>i.decode().catch(()=>{}))));
    const imagesMs=performance.now()-started;
    report.samples.push({case:configuration.name,phase,idle,api_ms:Math.round(apiMs),click_to_cards_ms:Math.round(clickMs),click_to_images_ms:Math.round(imagesMs)});
    page.off('request',onRequest);
  };
  try {
    // Prepare the page/account first, then verify database idle through the
    // control plane without touching the data plane before the timed click.
    const cold=async configuration=>{
    const click=await ready(configuration),deadline=Date.now()+9*60000;
    let idle;
    while(Date.now()<deadline) {
      const r=await fetch('https://console.neon.tech/api/v2/projects/patient-shadow-91417882/branches/'+fixture.branch+'/endpoints',{
        headers:{authorization:'Bearer '+process.env.NEON_API_KEY},redirect:'error',signal:AbortSignal.timeout(30000),
      });
      assert.equal(r.status,200);
      const endpoints=(await r.json()).endpoints.filter(e=>e.branch_id===fixture.branch&&e.type==='read_write');
      assert.equal(endpoints.length,1);
      if(endpoints[0].current_state==='idle'){idle={state:'idle',checked_at:new Date().toISOString()};break;}
      await new Promise(resolve=>setTimeout(resolve,15000));
    }
    assert.ok(idle,'Isolated compute did not become idle; no cold claim is permitted.');
    await sample(configuration,click,'confirmed_idle',idle);
    };
    await cold({name:'mixed'});
    for(const configuration of [{name:'mixed'},{name:'powered-cube'},{name:'custom-single',custom:1},{name:'custom-multi',custom:3}])
      for(let i=0;i<20;i++)await sample(configuration,await ready(configuration),'warm');
    for(const configuration of [{name:'powered-cube'},{name:'custom-single',custom:1},{name:'custom-multi',custom:3}])await cold(configuration);
    report.summary=Object.fromEntries(['mixed','powered-cube','custom-single','custom-multi'].map(name=>{
      const rows=report.samples.filter(s=>s.case===name&&s.phase==='warm');
      return [name,{api:summarize(rows.map(s=>s.api_ms)),click:summarize(rows.map(s=>s.click_to_cards_ms)),images:summarize(rows.map(s=>s.click_to_images_ms))}];
    }));
    report.passed=!errors.length&&staticCacheHits>0&&report.samples.filter(s=>s.phase==='confirmed_idle').length===4&&report.samples.filter(s=>s.phase==='confirmed_idle').every(s=>s.click_to_cards_ms<=report.budgets.cold_click_ms)&&
      Object.values(report.summary).every(s=>s.api.p95_ms<=2000&&s.click.p95_ms<=3000);
    await page.screenshot({path:directory+'/practice-mobile.png',fullPage:true});
  } catch(error) {
    report.failure={code:error.code||error.name||'unknown',line:String(error.stack).match(/launch-practice-browser.mjs:(\d+)/)?.[1]||null};
    await page.screenshot({path:directory+'/practice-failure.png',fullPage:true});
    throw error;
  } finally {
    report.browser_errors=errors.length;report.api_calls=apiCalls;report.http_cache_hits=staticCacheHits;
    fs.writeFileSync(directory+'/practice-browser.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
    await browser.close();
  }
  console.log(JSON.stringify({operation:'isolated-practice-browser',passed:report.passed,http_cache_hits:staticCacheHits,samples:report.samples,summary:report.summary}));
  if(!report.passed)process.exitCode=1;
}
main().catch(()=>{console.error('Isolated browser acceptance failed; inspect sanitized artifacts.');process.exitCode=1;});
