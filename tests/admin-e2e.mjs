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
  const fixture={generated_at:'2026-09-12T12:00:00Z',filters:{start:'2026-09-01',end:'2026-09-12',environment:'all',type:'all',set:'all',version:'all',band:'all',pick:'all'},coverage:{qa_excluded:8,repeats_excluded:3,unobserved_excluded:2},summary:sample,groups:['difficulty','pick','round','set','model_disagreement','version'].map((dimension,i)=>({...sample,dimension,label:['hard','9','8','blb','true','first-pack-v2 / trophy-consensus-v2 / support-ratio-v1'][i]})),sets:['blb','powered-cube'],reviews:[{...sample,puzzle_id:'a'.repeat(32),set_id:'blb',pick_number:9,model_disagreement:true}]};
  await page.addInitScript(()=>localStorage.setItem('pack1-auth-session-v1','synthetic-admin-session'));
  const requests=[];
  await page.route('**/v1/admin/**',async route=>{
    requests.push(route.request().url());
    if(route.request().url().includes('/corpus'))return route.fulfill({json:{corpus_version:'fixture-version',gate_version:'corpus-gates-v1',thresholds:{healthMaxAgeDays:7},transitions:{Candidate:['Live','Retired']},history:[],sets:[{set_id:'test',set_name:'Candidate test set',status:'Candidate',source_event_type:'PremierDraft',release_date:'2026-09-01',manifest:{},report:{gates:[{id:'images',pass:false,requirement:'100% HTTPS image references',actual:.9}]},health_current:true,ready:false}]}});
    if(route.request().url().includes('/decisions/'))return route.fulfill({json:{puzzle:{prior_picks:[],historical_pick_id:'trophy',candidates:[{id:'trophy',name:'Trophy card',model_probability:.1},{id:'alternative',name:'Alternative card',model_probability:.5}]},choices:[{selected_id:'alternative',answers:20,average_score:95}]}});
    return route.fulfill({json:fixture});
  });
  await page.reload();
  await page.getByRole('heading',{name:'How the decisions play'}).waitFor();
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
  await page.getByText('Quality gates',{exact:false}).click();
  await page.getByText('Blocked: images',{exact:true}).waitFor();
  assert.equal(await page.locator('option[value=Live]').isDisabled(),true);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`artifacts/ui-corpus-${width}.png`,fullPage:true});}
  assert.deepEqual(errors,[]);
  console.log('Admin mobile layout, locked state, filters, review details and CSV export passed.');
} finally {await browser.close();}
