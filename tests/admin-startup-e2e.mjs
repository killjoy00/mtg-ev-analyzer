// Validate the production-style, cookie-based admin boot path without live credentials.
// The synthetic player-session route intentionally never answers: Insights must not await it.
import assert from 'node:assert/strict';
import {ADMIN_API_VERSION} from '../admin-api-contract.mjs';

const ORIGIN='http://127.0.0.1:4173';
const session={user:{id:'11111111-1111-4111-8111-111111111111',email:'owner@example.invalid'}};
const report={
  generated_at:'2026-10-24T00:00:00Z',corpus_version:'fixture-corpus',
  filters:{start:'2026-10-01',end:'2026-10-24',environment:'all',type:'all',set:'all',version:'all',band:'all',pick:'all'},
  coverage:{qa_excluded:0,repeats_excluded:0,unobserved_excluded:0},
  summary:{exposures:0,players:0,answers:0,runs:0,completed_runs:0,rerolls:0,pending:0},
  share_funnel:{arrivals:0,visitors:0,starts:0,completions:0},
  groups:[],sets:[],
};

async function firstPartyPage(browser) {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('**/leaderboard-config.js',route=>route.fulfill({
    contentType:'application/javascript',
    body:"window.PACK1_API={firstParty:true,growthUrl:'"+ORIGIN+"',draftRunUrl:'"+ORIGIN+"'};",
  }));
  return page;
}

export async function runAdminStartupChecks(browser) {
  const page=await firstPartyPage(browser);
  const events=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/v1/player/session',route=>{events.push('guest-session');return new Promise(()=>{});});
  await page.route('**/v1/account/session',route=>{
    events.push('account-session');
    return route.fulfill({json:session});
  });
  await page.route(url=>String(url).endsWith('/health?quick=1'),route=>route.fulfill({
    headers:{'x-pack1-admin-api-version':String(ADMIN_API_VERSION)},
    json:{ok:true,admin_api_version:ADMIN_API_VERSION},
  }));
  let releaseReport;
  const holdReport=new Promise(resolve=>{releaseReport=resolve;});
  await page.route('**/v1/admin/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/v1/admin/access')return route.fulfill({json:{ok:true,role:'owner'}});
    if(path==='/v1/admin/measurements'){
      events.push('measurements');
      await holdReport;
      return route.fulfill({json:report});
    }
    if(path==='/v1/admin/measurements/habits')return route.fulfill({json:{habit_metrics:{cohorts:[],daily_health:[]}}});
    if(path==='/v1/admin/measurements/reviews')return route.fulfill({json:{reviews:[]}});
    return route.fulfill({status:404,json:{error:'Unexpected synthetic admin request'}});
  });
  try {
    await page.goto(ORIGIN+'/admin/?area=insights',{waitUntil:'commit'});
    await page.getByRole('heading',{name:'Loading Insights…'}).waitFor({timeout:10000});
    assert.ok(events.includes('account-session'),'Admin must directly verify its account cookie');
    assert.ok(events.includes('measurements'),'Insights should start even if guest migration cannot finish');
    assert.equal(await page.getByText('Checking administrator access…',{exact:true}).count(),0);
    assert.equal(await page.getByRole('link',{name:'Overview',exact:true}).isVisible(),true);
    releaseReport();
    await page.getByRole('heading',{name:'How the decisions play'}).waitFor({timeout:10000});
    assert.deepEqual(errors,[]);
  } finally {
    releaseReport?.();
    await page.close();
  }

  // An account-service failure is actionable, not an indefinite access spinner.
  const failed=await firstPartyPage(browser);
  await failed.route('**/v1/account/session',route=>route.fulfill({
    status:503,json:{error:'Synthetic account service outage'},
  }));
  try {
    await failed.goto(ORIGIN+'/admin/?area=insights',{waitUntil:'commit'});
    await failed.getByRole('heading',{name:'Administration unavailable'}).waitFor({timeout:10000});
    assert.equal(await failed.getByText('Synthetic account service outage').isVisible(),true);
    assert.equal(await failed.getByRole('button',{name:'Retry'}).isVisible(),true);
  } finally {await failed.close();}

  // Shorten only the session deadline inside this test to cover the real abort path.
  const timeoutPage=await firstPartyPage(browser);
  await timeoutPage.addInitScript(()=>{
    const original=AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout=ms=>original(ms===12000?200:ms);
  });
  await timeoutPage.route('**/v1/account/session',route=>new Promise(()=>{}));
  try {
    await timeoutPage.goto(ORIGIN+'/admin/?area=insights',{waitUntil:'commit'});
    await timeoutPage.getByRole('heading',{name:'Administration unavailable'}).waitFor({timeout:10000});
    assert.equal(await timeoutPage.getByText('The account check took too long. Please retry.').isVisible(),true);
    assert.equal(await timeoutPage.getByRole('button',{name:'Retry'}).isVisible(),true);
  } finally {await timeoutPage.close();}
}
