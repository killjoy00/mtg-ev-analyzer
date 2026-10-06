import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {buildCampaignTrackingUrl} from '../campaign-links.mjs';
import {creatorChallengeTrackedUrl,validateCreatorPageEntries} from '../creator-challenge-pages.mjs';

const kind=String(process.env.PUBLICATION_KIND||'');
const slug=String(process.env.PUBLICATION_SLUG||'');
const action=String(process.env.PUBLICATION_ACTION||'');
assert.ok(['campaign','creator'].includes(kind),'PUBLICATION_KIND must be campaign or creator');
assert.match(slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
assert.ok(['publish','retire'].includes(action),'PUBLICATION_ACTION must be publish or retire');

const routePath=kind==='creator'?'/creator/'+slug+'/':'/go/'+slug+'/';
const routeFile=(kind==='creator'?'creator/':'go/')+slug+'/index.html';
const routeUrl='https://packone.pro'+routePath;
const exists=async file=>access(file).then(()=>true,()=>false);
const html=await readFile(routeFile,'utf8').catch(error=>error?.code==='ENOENT'?null:Promise.reject(error));

const browser=await chromium.launch({headless:true});
try {
  if(kind==='campaign'&&action==='retire') {
    assert.equal(html,null,'retired ordinary campaign route must be removed');
    const page=await browser.newPage();
    await page.route('https://packone.pro/**',route=>route.fulfill({status:404,contentType:'text/html',body:'not found'}));
    const response=await page.goto(routeUrl,{waitUntil:'domcontentloaded'});
    assert.equal(response?.status(),404);
    console.log('Campaign retirement browser smoke passed:',routeUrl);
    process.exit(0);
  }

  assert.ok(html,'generated publication route must exist');
  const inspectContext=await browser.newContext({javaScriptEnabled:false});
  const inspect=await inspectContext.newPage();
  await inspect.route('https://packone.pro/**',route=>{
    const url=new URL(route.request().url());
    if(url.pathname===routePath)return route.fulfill({status:200,contentType:'text/html',body:html});
    return route.fulfill({status:404,contentType:'text/plain',body:'not found'});
  });
  const response=await inspect.goto(routeUrl,{waitUntil:'domcontentloaded'});
  assert.equal(response?.status(),200);
  assert.equal(await inspect.locator('meta[name="robots"]').getAttribute('content'),'noindex,nofollow');

  if(kind==='creator') {
    const registry=validateCreatorPageEntries(JSON.parse(await readFile('creator-challenges.json','utf8')));
    const entry=registry.find(candidate=>candidate.slug===slug);
    assert.ok(entry,'creator registry entry must exist');
    assert.equal(entry.status,action==='retire'?'retired':'published');
    assert.equal(await inspect.locator('body').getAttribute('data-creator-challenge-id'),entry.id);
    assert.equal(await inspect.locator('body').getAttribute('data-creator-challenge-status'),entry.status);
    assert.equal(await inspect.locator('link[rel="canonical"]').getAttribute('href'),routeUrl);
    if(action==='retire') {
      assert.equal(await exists('creator/'+slug+'/creator-card.png'),false,'retirement must remove the personalized social card');
      assert.equal(await inspect.getByText('This creator challenge is no longer available.').count(),1);
      assert.equal(html.includes('location.replace'),false,'retired route must not redirect');
      await inspectContext.close();
      console.log('Creator retirement browser smoke passed:',routeUrl);
      process.exit(0);
    }
    assert.equal(await exists('creator/'+slug+'/creator-card.png'),true,'published creator route needs a social card');
    assert.equal(await inspect.locator('meta[property="og:title"]').getAttribute('content'),entry.headline);
    assert.equal(await inspect.locator('meta[property="og:image"]').getAttribute('content'),routeUrl+'creator-card.png');
    await inspectContext.close();

    const expected=creatorChallengeTrackedUrl(entry);
    const play=await browser.newPage();
    let arrived='';
    await play.route('https://packone.pro/**',route=>{
      const url=route.request().url();
      if(url===routeUrl)return route.fulfill({status:200,contentType:'text/html',body:html});
      arrived=url;
      return route.fulfill({status:200,contentType:'text/html',body:'<main id="publication-arrived">ok</main>'});
    });
    await play.goto(routeUrl,{waitUntil:'domcontentloaded'});
    await play.locator('#publication-arrived').waitFor();
    assert.equal(arrived,expected);
    assert.equal(play.url(),expected);
    console.log('Creator publication browser smoke passed:',routeUrl,'->',expected);
    process.exit(0);
  }

  const campaigns=JSON.parse(await readFile('campaign-links.json','utf8'));
  const entry=campaigns.find(candidate=>candidate.slug===slug);
  assert.ok(entry,'campaign registry entry must exist');
  const expected=buildCampaignTrackingUrl(entry);
  assert.equal(await inspect.locator('a').getAttribute('href'),expected);
  await inspectContext.close();

  const redirect=await browser.newPage();
  let arrived='';
  await redirect.route('https://packone.pro/**',route=>{
    const url=route.request().url();
    if(url===routeUrl)return route.fulfill({status:200,contentType:'text/html',body:html});
    arrived=url;
    return route.fulfill({status:200,contentType:'text/html',body:'<main id="publication-arrived">ok</main>'});
  });
  await redirect.goto(routeUrl,{waitUntil:'domcontentloaded'});
  await redirect.locator('#publication-arrived').waitFor();
  assert.equal(arrived,expected);
  assert.equal(redirect.url(),expected);
  console.log('Campaign publication browser smoke passed:',routeUrl,'->',expected);
} finally {
  await browser.close();
}
