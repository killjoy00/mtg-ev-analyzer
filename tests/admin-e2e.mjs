// Browser contract runs in CI against the local static site and synthetic data.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/admin/');
  await page.getByRole('heading',{name:'Pack One administration'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Export CSV'}).count(),0);
  const sample={exposures:40,players:35,answers:32,trophy_match_pct:37.5,average_partial_credit:65,median_seconds:12,p90_seconds:28,timed_answers:29,rerolls:5,likely_abandoned:2,mature_exposures:30,pending:1,partial_0_24:1,partial_25_49:4,partial_50_74:8,partial_75_95:7,runs:9,completed_runs:6};
  const fixture={generated_at:'2026-09-12T12:00:00Z',filters:{start:'2026-09-01',end:'2026-09-12',environment:'all',type:'all',set:'all',version:'all',band:'all',pick:'all'},coverage:{qa_excluded:8,repeats_excluded:3,unobserved_excluded:2},summary:sample,share_funnel:{arrivals:20,visitors:17,starts:12,completions:9,start_pct:60,completion_pct:75},habit_metrics:{cohorts:[{source:'reddit',campaign:'creator_one',cohort_people:10,next_day_mature:8,next_day_returned:3,next_day_immature:2,next_day_rate:37.5,seven_day_mature:5,seven_day_returned:2,seven_day_immature:5,seven_day_rate:40,three_in_seven_mature:6,three_in_seven_reached:2,three_in_seven_immature:4,three_in_seven_rate:33.3,ever_three_in_seven_people:4,ever_three_in_seven_rate:40}],daily_health:[{day:'2026-09-12',people:4}]},groups:['difficulty','pick','round','set','model_disagreement','version'].map((dimension,i)=>({...sample,dimension,label:['hard','9','8','blb','true','first-pack-v2 / trophy-consensus-v2 / support-ratio-v1'][i]})),sets:['blb','powered-cube'],reviews:[{...sample,puzzle_id:'a'.repeat(32),set_id:'blb',pick_number:9,model_disagreement:true}]};
  await page.addInitScript(()=>localStorage.setItem('pack1-auth-session-v1','synthetic-admin-session'));
  const requests=[];
  const userId='11111111-1111-4111-8111-111111111111';
  await page.route('**/v1/admin/**',async route=>{
    requests.push(route.request().url());
    const path=new URL(route.request().url()).pathname;
    if(path===`/v1/admin/users/${userId}`)return route.fulfill({json:{user:{id:userId,name:'Test Member',email:'member@example.com',email_verified:true,created_at:'2026-09-01T12:00:00Z',last_active:'2026-09-18T18:00:00Z',linked:true,profile_name:'Test Member',profile_public:false,is_admin:false,banned:false},stats:{runs:12,completed_runs:10,dailies:4,practice_runs:8,cube_runs:2,custom_runs:1,average_score:84.5,best_score:100},providers:[{provider:'patreon',membership_status:'active_patron',currently_entitled_amount_cents:500,is_free_trial:false,is_gifted:false,last_synced_at:'2026-09-18T18:00:00Z'}],entitlements:[{capability:'custom_corpus',provider:'patreon',granted_at:'2026-09-10T00:00:00Z',expires_at:null,revoked_at:null,active:true}],recent_runs:[{environment:'mixed',run_type:'Practice',answered:8,total:8,score:86,updated_at:'2026-09-18T18:00:00Z'}],recent_events:[{event_name:'game_started',event_props:{mode:'draft_run',set_id:'mixed'},created_at:'2026-09-18T17:58:00Z'}]}});
    if(path==='/v1/admin/users')return route.fulfill({json:{generated_at:'2026-09-18T19:00:00Z',filters:{search:'',status:'all'},summary:{total:2,new_30d:2,active_30d:1,patreon:1,paid:1,admins:1},total_matching:2,truncated:false,users:[{id:userId,name:'Test Member',email:'member@example.com',email_verified:true,created_at:'2026-09-01T12:00:00Z',last_active:'2026-09-18T18:00:00Z',linked:true,is_admin:false,patreon_connected:true,banned:false,active_entitlements:1,capabilities:['custom_corpus'],runs:12,completed_runs:10,average_score:84.5,best_score:100},{id:'22222222-2222-4222-8222-222222222222',name:'Pack One Admin',email:'admin@example.com',email_verified:true,created_at:'2026-09-02T12:00:00Z',last_active:'2026-09-18T19:00:00Z',linked:false,is_admin:true,banned:false,active_entitlements:0,capabilities:[],runs:0,completed_runs:0,average_score:null,best_score:null}]}});
    if(route.request().url().includes('/corpus'))return route.fulfill({json:{corpus_version:'fixture-version',gate_version:'corpus-gates-v1',thresholds:{healthMaxAgeDays:7},transitions:{Candidate:['Live','Retired']},history:[],sets:[...['Bloomburrow','Aetherdrift','Final Fantasy','Powered Cube','The Hobbit','Kamigawa: Neon Dynasty'].map((set_name,i)=>({set_id:['blb','dft','fin','powered-cube','hob','neo'][i],set_name,status:i===4?'Paused':'Live',release_date:'2026-08-01',serving_count:10000-i*456,under_floor_count:200+i*19,import_status:'complete',health_current:true,ready:i!==4,manifest:{}})),{set_id:'test',set_name:'Candidate test set',status:'Candidate',source_event_type:'PremierDraft',release_date:'2026-09-01',manifest:{},report:{gates:[{id:'images',pass:false,requirement:'100% HTTPS image references',actual:.9}]},health_current:true,ready:false}]}});
    if(route.request().url().includes('/decisions/'))return route.fulfill({json:{puzzle:{prior_picks:[],historical_pick_id:'trophy',candidates:[{id:'trophy',name:'Trophy card',model_probability:.1},{id:'alternative',name:'Alternative card',model_probability:.5}]},choices:[{selected_id:'alternative',answers:20,average_score:95}]}});
    return route.fulfill({json:fixture});
  });
  await page.reload();
  await page.getByRole('heading',{name:'How the decisions play'}).waitFor();
  await page.getByRole('heading',{name:'Daily result-share funnel'}).waitFor();
  await page.getByRole('heading',{name:'Daily habit cohorts'}).waitFor();
  assert.match(await page.getByText('creator_one',{exact:true}).locator('xpath=ancestor::tr').innerText(),/reddit[\s\S]*10[\s\S]*37\.5%[\s\S]*3 \/ 8 mature[\s\S]*2 immature/);
  assert.match(await page.getByRole('heading',{name:'3-in-7 daily health'}).locator('xpath=following-sibling::div[1]').innerText(),/2026-09-12[\s\S]*4/);
  assert.match(await page.locator('.share-funnel').innerText(),/20[\s\S]*17[\s\S]*12[\s\S]*9/);
  assert.match(await page.getByText('Start conversion:',{exact:false}).innerText(),/60%[\s\S]*75%/);
  await page.getByLabel('Difficulty',{exact:true}).selectOption('hard');
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByRole('heading',{name:'How the decisions play'}).waitFor();
  assert.ok(requests.some(x=>x.includes('difficulty=hard')));
  await page.locator('summary').click();
  await page.getByText('Alternative card',{exact:true}).waitFor();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV'}).click();assert.ok((await download).suggestedFilename().endsWith('.csv'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile page must not overflow horizontally');
  fs.mkdirSync('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/ui-admin-mobile.png',fullPage:true});
  await page.getByRole('link',{name:'Corpus',exact:true}).click();
  await page.getByRole('heading',{name:'Corpus operations'}).waitFor();
  assert.equal(await page.locator('.corpus-table tbody tr').count(),7);
  await page.getByLabel('Find a set').fill('missing');assert.ok((await page.locator('#corpus-rows').innerText()).includes('No sets match'));
  await page.getByLabel('Find a set').fill('test');
  await page.getByRole('button',{name:'Candidate test set TEST'}).click();
  await page.getByRole('heading',{name:'Quality & coverage'}).waitFor();
  assert.ok((await page.locator('.corpus-gates').innerText()).includes('images'));
  assert.equal(await page.locator('option[value=Live]').evaluate(option=>option.disabled),true);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`artifacts/ui-corpus-details-${width}.png`,fullPage:true});}
  await page.getByRole('button',{name:'Close set details'}).click();
  await page.getByLabel('Find a set').fill('');
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`artifacts/ui-corpus-${width}.png`,fullPage:true});}
  await page.getByRole('link',{name:'Users',exact:true}).click();
  await page.getByRole('heading',{name:'Users',exact:true}).waitFor();
  assert.ok((await page.getByText('Authenticated Pack One accounts only.',{exact:false}).innerText()).includes('Anonymous and guest gameplay identities'));
  assert.equal(await page.locator('#user-rows tr').count(),2);
  await page.getByLabel('Find a user').fill('member@example.com');
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  assert.ok(requests.some(url=>url.includes('/v1/admin/users?search=member%40example.com')));
  await page.getByRole('button',{name:/Test Member/}).click();
  await page.locator('#user-detail').getByRole('heading',{name:'Test Member'}).waitFor();
  assert.ok((await page.locator('#user-detail').innerText()).includes('Custom sets'));
  assert.ok((await page.locator('#user-detail').innerText()).includes('active_patron'));
  assert.ok((await page.locator('#user-detail').innerText()).includes('game_started'));
  assert.equal((await page.locator('#user-detail').innerText()).includes('player_id'),false);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`artifacts/ui-users-${width}.png`,fullPage:true});}
  await page.getByRole('button',{name:'Close'}).click();
  assert.deepEqual(errors,[]);
  console.log('Admin mobile layout, locked state, filters, review details and CSV export passed.');
} finally {await browser.close();}
