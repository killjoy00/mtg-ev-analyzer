// Included by admin-e2e.mjs so the existing protected E2E workflow runs this.
// Only synthetic local fixtures; no live accounts or production requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ADMIN_API_VERSION} from '../admin-api-contract.mjs';
import {gameDateKey} from '../game-date.mjs';

export async function runOverviewChecks(browser) {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[],requests=[];
  let role='owner',failReports=0,holdActivity=false,held=null;
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('pack1-auth-session-v1','synthetic-overview-session'));
  await page.route('**/v1/account/session',route=>route.fulfill({json:{user:{id:'11111111-1111-4111-8111-111111111111',email:'overview@example.invalid'}}}));
  await page.route('**/v1/account/signout',route=>route.fulfill({json:{ok:true}}));
  await page.route(/\/health\?quick=1$/,route=>route.fulfill({headers:{'x-pack1-admin-api-version':String(ADMIN_API_VERSION)},json:{ok:true,admin_api_version:ADMIN_API_VERSION}}));
  await page.route('**/v1/admin/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    requests.push({path,method:request.method(),query:url.search});
    if(path==='/v1/admin/access')return route.fulfill({json:{ok:true,role}});
    if(path==='/v1/admin/overview/trends')return route.fulfill({json:{daily:[{label:'2026-10-23',completed_runs:8}],weekly:[{label:'current',observed_players:20,completed_runs:28,daily_players:14,daily_completions:20,new_accounts:7,answers:50,trophy_matches:25},{label:'previous',observed_players:10,completed_runs:14,daily_players:7,daily_completions:10,new_accounts:3,answers:40,trophy_matches:16}]}});
    if(path==='/v1/admin/overview/health')return route.fulfill({json:{day:'2026-10-24',dailies:['mixed','powered-cube','latest'].map(environment=>({environment,scheduled:true,picks:8})),serving:{cache_current:true,revision:'12'},attention:{failed_publications:1,urgent_reports:1}}}});

    if(path==='/v1/admin/player-reports/summary')return route.fulfill({status:failReports||200,json:failReports?{error:'Synthetic report outage'}:{summary:{decisions:{open:3,broken_open:1},profiles:{open:2}}}});
    if(path==='/v1/admin/measurements') {
      if(holdActivity)await new Promise(resolve=>{held=resolve;});
      return route.fulfill({json:{summary:{players:35,completed_runs:6,runs:9},share_funnel:{arrivals:20,starts:12,start_pct:60}}});
    }
    if(path==='/v1/admin/measurements/habits')return route.fulfill({json:{habit_metrics:{cohorts:[{next_day_returned:3,next_day_mature:8,seven_day_returned:2,seven_day_mature:5}]}}});
    if(path==='/v1/admin/users')return route.fulfill({json:{summary:{total:100,new_30d:12,active_30d:34,paid:5,username_attention:2},users:[],total_matching:0}});
    if(path==='/v1/admin/corpus')return route.fulfill({json:{sets:[{set_id:'sample',set_name:'Sample Set',status:'Live',regular_run:true,release_date:'2026-01-01'}],readiness:{ready:true,current:true}}});
    if(path==='/v1/admin/creator-challenges')return route.fulfill({json:{challenges:[{status:'published'},{status:'failed'}]}});
    if(path==='/v1/admin/team')return route.fulfill({json:{members:[],invitations:[],audit:[]}});
    return route.fulfill({status:404,json:{error:'Unexpected synthetic request'}});
  });
  try {
    await page.goto('http://127.0.0.1:4173/admin/');
    await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
    await page.getByText('5 open reports',{exact:true}).waitFor();
    await page.getByRole('heading',{name:'What changed?'}).waitFor();
    await page.getByText('+100.0%',{exact:false}).first().waitFor();
    await page.getByRole('heading',{name:'Site health'}).waitFor();
    await page.getByText('Serving verified',{exact:true}).waitFor();
    await page.getByText('1 publication operation needs attention',{exact:true}).waitFor();
    await page.locator('#overview-retention').getByText('37.5%',{exact:false}).waitFor();
    assert.equal(await page.locator('#admin-overview-link').isVisible(),false);
    assert.equal(await page.locator('#admin-area-nav a:visible').count(),0,'Home has no tab bar or redundant Overview link');
    assert.equal(await page.getByRole('link',{name:'Settings',exact:true}).isVisible(),true);
    assert.equal(requests.some(r=>r.path==='/v1/admin/team'),false,'Home never requests owner access records');
    assert.ok(requests.every(r=>r.method==='GET'),'Overview makes only read requests');
    const measured=requests.find(r=>r.path==='/v1/admin/measurements');
    assert.equal(new URLSearchParams(measured.query).get('from'),gameDateKey());
    assert.equal(new URLSearchParams(measured.query).get('to'),gameDateKey());

    fs.mkdirSync('artifacts',{recursive:true});
    for(const width of [320,390,1280]) {
      await page.setViewportSize({width,height:900});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overview fits ${width}px`);
      await page.screenshot({path:`artifacts/ui-admin-overview-${width}.png`,fullPage:true});
    }
    await page.getByRole('link',{name:'Users',exact:true}).click();
    await page.getByRole('heading',{name:'Users',exact:true}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Overview',exact:true}).getAttribute('href'),'./');
    await page.reload();
    await page.getByRole('heading',{name:'Users',exact:true}).waitFor();
    await page.getByRole('link',{name:'Overview',exact:true}).click();
    await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
    await page.goBack();
    await page.getByRole('heading',{name:'Users',exact:true}).waitFor();
    await page.goForward();
    await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
    await page.goto('http://127.0.0.1:4173/admin/?area=team');
    await page.getByRole('heading',{name:'Administrator access',exact:true}).waitFor();
    await page.getByRole('link',{name:'Overview',exact:true}).click();
    await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();

    role='admin';failReports=503;
    await page.reload();
    await page.locator('#overview-reports').getByText('Temporarily unavailable.',{exact:false}).waitFor();
    await page.getByText('Serving verified',{exact:true}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Settings',exact:true}).count(),0);
    assert.equal(await page.getByRole('link',{name:'Users',exact:true}).isVisible(),true);
    assert.doesNotMatch(await page.locator('#overview-reports').innerText(),/0 open/);
    failReports=0;
    await page.getByRole('button',{name:'Refresh overview',exact:true}).click();
    await page.getByText('5 open reports',{exact:true}).waitFor();

    failReports=401;
    await page.reload();
    await page.getByRole('heading',{name:'Pack One administration',exact:true}).waitFor();
    assert.equal(await page.locator('#admin-overview').count(),0,'Expired access clears private overview');
    assert.equal(await page.locator('#admin-area-nav').isVisible(),false);

    failReports=0;holdActivity=true;
    await page.reload();
    await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
    await page.getByText('5 open reports',{exact:true}).waitFor();
    assert.equal(typeof held,'function','Activity request is still pending');
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByRole('heading',{name:'Pack One administration',exact:true}).waitFor();
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/admin/measurements');
    held();await response;
    assert.equal(await page.locator('#admin-overview').count(),0,'Late summaries never restore a signed-out dashboard');
    assert.deepEqual(errors,[]);
    console.log('PASS: Overview home, owner cards, direct links, browser history, responsive widths, failure isolation, and stale-response privacy.');
  } finally {held?.();await page.close();}
}
