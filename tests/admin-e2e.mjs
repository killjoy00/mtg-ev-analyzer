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
  await page.addInitScript(()=>{localStorage.setItem('pack1-auth-session-v1','synthetic-admin-session');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedText=value;}}});});
  const requests=[],publishBodies=[],usernameBodies=[],deleteBodies=[],adminControlRequests=[];
  const userId='11111111-1111-4111-8111-111111111111';
  let renamedPublicUsername='Test Member',deletionFixture=null,deletionStatusFailure=false;
  let holdDeletionStatus=false,releaseDeletionStatus=null,failDeleteAfterCommit=false;
  await page.route(/\/health\?quick=1$/,route=>route.fulfill({json:{ok:true,campaign_link_publish_configured:true}}));
  await page.route('**/v1/admin/**',async route=>{
    requests.push(route.request().url());
    const requestUrl=new URL(route.request().url()),path=requestUrl.pathname,method=route.request().method();
    if(path.startsWith(`/v1/admin/users/${userId}`))adminControlRequests.push({url:route.request().url(),path,method});
    if(path==='/v1/admin/campaign-links/publish') {
      publishBodies.push(route.request().postDataJSON());
      return route.fulfill({status:202,json:{ok:true,status:'queued',slug:'new-launch',tracked_url:'https://packone.pro/?utm_source=reddit&utm_campaign=launch-week&utm_medium=social',vanity_url:'https://packone.pro/go/new-launch/'}});
    }
    if(path===`/v1/admin/users/${userId}/username`&&route.request().method()==='PATCH') {
      usernameBodies.push(route.request().postDataJSON());
      renamedPublicUsername=String(usernameBodies.at(-1).displayName);
      return route.fulfill({json:{ok:true}});
    }
    if(path===`/v1/admin/users/${userId}/deletion`&&method==='GET') {
      if(holdDeletionStatus)await new Promise(resolve=>{releaseDeletionStatus=resolve;});
      if(deletionStatusFailure)return route.fulfill({status:503,json:{error:'Synthetic deletion status outage'}});
      return route.fulfill({json:{ok:true,deletion:deletionFixture}});
    }
    if(path===`/v1/admin/users/${userId}/delete`&&method==='POST') {
      deleteBodies.push(route.request().postDataJSON());
      deletionFixture={operation_id:'44444444-4444-4444-8444-444444444444',state:'pending',initiation_source:'admin',initiated_by_admin_auth_user_id:'22222222-2222-4222-8222-222222222222',target_was_admin:false,attempts:0,error_code:null,message:'Deletion has started and is continuing.'};
      if(failDeleteAfterCommit)return route.fulfill({status:500,json:{
        error:'Request failed. Please try again.',
        deletionCommitted:true,
        operationId:deletionFixture.operation_id,
        deletion:deletionFixture,
      }});
      return route.fulfill({status:202,json:{ok:true,deletion:'accepted',operationId:deletionFixture.operation_id,operation:deletionFixture}});
    }
    if(path===`/v1/admin/users/${userId}`)return route.fulfill({json:{user:{id:userId,name:'Test Member',email:'member@example.com',email_verified:true,created_at:'2026-09-01T12:00:00Z',last_active:'2026-09-18T18:00:00Z',linked:true,profile_name:renamedPublicUsername,username_owned:true,profile_public:false,is_admin:false,is_self:false,banned:false},stats:{runs:12,completed_runs:10,dailies:4,practice_runs:8,cube_runs:2,custom_runs:1,average_score:84.5,best_score:100},providers:[{provider:'patreon',membership_status:'active_patron',currently_entitled_amount_cents:500,is_free_trial:false,is_gifted:false,last_synced_at:'2026-09-18T18:00:00Z'}],entitlements:[{capability:'custom_corpus',provider:'patreon',granted_at:'2026-09-10T00:00:00Z',expires_at:null,revoked_at:null,active:true}],recent_runs:[{environment:'mixed',run_type:'Practice',answered:8,total:8,score:86,updated_at:'2026-09-18T18:00:00Z'}],recent_events:[{event_name:'game_started',event_props:{mode:'draft_run',set_id:'mixed'},created_at:'2026-09-18T17:58:00Z'}],moderation_actions:[]}});
    if(path==='/v1/admin/users')return route.fulfill({json:{generated_at:'2026-09-18T19:00:00Z',filters:{search:'',status:'all'},summary:{total:2,new_30d:2,active_30d:1,patreon:1,paid:1,admins:1},total_matching:2,truncated:false,users:[{id:userId,name:'Test Member',email:'member@example.com',profile_name:renamedPublicUsername,username_owned:true,email_verified:true,created_at:'2026-09-01T12:00:00Z',last_active:'2026-09-18T18:00:00Z',linked:true,is_admin:false,patreon_connected:true,banned:false,active_entitlements:1,capabilities:['custom_corpus'],runs:12,completed_runs:10,average_score:84.5,best_score:100},{id:'22222222-2222-4222-8222-222222222222',name:'Pack One Admin',email:'admin@example.com',email_verified:true,created_at:'2026-09-02T12:00:00Z',last_active:'2026-09-18T19:00:00Z',linked:false,is_admin:true,banned:false,active_entitlements:0,capabilities:[],runs:0,completed_runs:0,average_score:null,best_score:null}]}});
    if(route.request().url().includes('/corpus'))return route.fulfill({json:{corpus_version:'fixture-version',gate_version:'corpus-gates-v1',thresholds:{healthMaxAgeDays:7},transitions:{Candidate:['Live','Retired']},history:[],sets:[...['Bloomburrow','Aetherdrift','Final Fantasy','Powered Cube','The Hobbit','Kamigawa: Neon Dynasty'].map((set_name,i)=>({set_id:['blb','dft','fin','powered-cube','hob','neo'][i],set_name,status:i===4?'Paused':'Live',release_date:'2026-08-01',serving_count:10000-i*456,under_floor_count:200+i*19,import_status:'complete',health_current:true,ready:i!==4,manifest:{}})),{set_id:'test',set_name:'Candidate test set',status:'Candidate',source_event_type:'PremierDraft',release_date:'2026-09-01',manifest:{},report:{gates:[{id:'images',pass:false,requirement:'100% HTTPS image references',actual:.9}]},health_current:true,ready:false}]}});
    if(path.includes('/decisions/')){
      if(requestUrl.searchParams.get('difficulty')==='hard')await new Promise(resolve=>setTimeout(resolve,100));
      return route.fulfill({json:{puzzle:{prior_picks:[],historical_pick_id:'trophy',candidates:[{id:'trophy',name:'Trophy card',model_probability:.1},{id:'alternative',name:'Alternative card',model_probability:.5}]},choices:[{selected_id:'alternative',answers:20,average_score:95}]}});
    }
    if(path==='/v1/admin/measurements'&&requestUrl.searchParams.get('difficulty')==='hard')await new Promise(resolve=>setTimeout(resolve,25));
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
  const previousReviews=await page.locator('#reviews').elementHandle();
  assert.ok(previousReviews);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  // Refresh replaces #admin asynchronously; wait for the old report DOM to detach before opening review details.
  await page.waitForFunction(node=>!node.isConnected,previousReviews);
  await page.getByRole('heading',{name:'How the decisions play'}).waitFor();
  assert.ok(requests.some(x=>x.includes('difficulty=hard')));
  const review=page.locator('#reviews details.review').first();
  await review.locator('summary').click();
  await review.getByText('Alternative card',{exact:true}).waitFor();
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
  // The click resolves before the search request is sent, so wait for it instead of checking the log.
  const search=page.waitForRequest(request=>request.url().includes('/v1/admin/users?search=member%40example.com'));
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await search;
  await page.getByRole('button',{name:/Test Member/}).click();
  await page.locator('#user-detail').getByRole('heading',{name:'Test Member'}).waitFor();
  assert.ok((await page.locator('#user-detail').innerText()).includes('Custom sets'));
  assert.ok((await page.locator('#user-detail').innerText()).includes('active_patron'));
  assert.ok((await page.locator('#user-detail').innerText()).includes('game_started'));
  assert.equal((await page.locator('#user-detail').innerText()).includes('player_id'),false);

  const growthBase=await page.evaluate(()=>window.PACK1_API.growthUrl);

  // A slow/hanging Growth status lookup must not block Draft Run user detail.
  await page.getByRole('button',{name:'Close'}).click();
  holdDeletionStatus=true;
  await page.getByRole('button',{name:/Test Member/}).click();
  await page.locator('#user-detail').getByRole('heading',{name:'Test Member'}).waitFor({timeout:3000});
  await page.getByText('Checking deletion status…',{exact:false}).waitFor({timeout:3000});
  assert.equal(await page.getByRole('button',{name:'Save username'}).isDisabled(),false);
  assert.equal(typeof releaseDeletionStatus,'function','the intended deletion-status mock must hold the actual Growth request');
  const heldStatusRequest=adminControlRequests.find(item=>item.path===`/v1/admin/users/${userId}/deletion`&&item.method==='GET');
  assert.ok(heldStatusRequest,'captured the actual deletion-status request');
  assert.ok(heldStatusRequest.url.startsWith(growthBase),heldStatusRequest.url);
  releaseDeletionStatus();releaseDeletionStatus=null;holdDeletionStatus=false;
  await page.getByText('Type DELETE to confirm',{exact:true}).waitFor();

  // An immediate Growth failure also leaves the rest of the detail usable.
  await page.getByRole('button',{name:'Close'}).click();
  deletionStatusFailure=true;
  await page.getByRole('button',{name:/Test Member/}).click();
  await page.locator('#user-detail').getByRole('heading',{name:'Test Member'}).waitFor({timeout:3000});
  await page.getByText('Deletion status is temporarily unavailable.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Save username'}).isDisabled(),false);
  deletionStatusFailure=false;
  await page.getByRole('button',{name:'Retry deletion status'}).click();
  await page.getByText('Type DELETE to confirm',{exact:true}).waitFor();

  const renameForm=page.locator('#change-username-form');
  await renameForm.getByLabel('Public username').fill('Renamed Member');
  await renameForm.getByLabel('Reason (optional)').fill('support request');
  const oldDetailBody=await page.locator('#user-detail-body').elementHandle();
  const renameRequest=page.waitForRequest(request=>new URL(request.url()).pathname===`/v1/admin/users/${userId}/username`&&request.method()==='PATCH');
  await renameForm.getByRole('button',{name:'Save username'}).click();
  const actualRenameRequest=await renameRequest;
  assert.ok(actualRenameRequest.url().includes('/v1/admin/users/'));
  await page.waitForFunction(node=>!node.isConnected,oldDetailBody);
  await page.locator('#change-username-form input[name="displayName"]').waitFor();
  assert.equal(await page.locator('#change-username-form input[name="displayName"]').inputValue(),'Renamed Member');
  assert.deepEqual(usernameBodies,[{displayName:'Renamed Member',reason:'support request'}]);
  assert.ok(adminControlRequests.some(item=>item.path===`/v1/admin/users/${userId}/username`&&item.method==='PATCH'));

  // Simulate an interrupted initiating request after the durable deletion tombstone committed.
  // Even with status lookup unavailable, the response's bounded operation state must keep deletion locked.
  failDeleteAfterCommit=true;deletionStatusFailure=true;
  const deleteForm=page.locator('#delete-account-form');
  await deleteForm.getByLabel('Type DELETE to confirm').fill('DELETE');
  await deleteForm.getByLabel('Reason (optional)').fill('requested by account owner');
  const deleteRequest=page.waitForRequest(request=>new URL(request.url()).pathname===`/v1/admin/users/${userId}/delete`&&request.method()==='POST');
  await deleteForm.getByRole('button',{name:'Delete account'}).click();
  const actualDeleteRequest=await deleteRequest;
  assert.ok(actualDeleteRequest.url().startsWith(growthBase),actualDeleteRequest.url());
  await page.locator('#deletion-status').getByText('Deletion has started and is continuing.',{exact:false}).waitFor();
  await page.getByText('interrupted after permanent deletion committed',{exact:false}).waitFor();
  assert.deepEqual(deleteBodies,[{confirm:'DELETE',reason:'requested by account owner',acknowledgeAdmin:false}]);
  assert.equal(await page.locator('#delete-account-form').count(),0,'committed deletion must never re-enable delete controls');
  assert.equal(await page.getByRole('button',{name:'Save username'}).isDisabled(),true);
  assert.ok(adminControlRequests.some(item=>item.path===`/v1/admin/users/${userId}/delete`&&item.method==='POST'));

  // A failed follow-up status lookup must preserve the known committed state.
  await page.getByRole('button',{name:'Refresh deletion status'}).click();
  await page.getByText('Synthetic deletion status outage',{exact:false}).waitFor();
  assert.equal(await page.locator('#delete-account-form').count(),0);
  assert.equal(await page.getByRole('button',{name:'Save username'}).isDisabled(),true);

  // Status recovery remains available once Growth responds again.
  failDeleteAfterCommit=false;deletionStatusFailure=false;
  await page.getByRole('button',{name:'Refresh deletion status'}).click();
  await page.locator('#deletion-status').getByText('Deletion has started and is continuing.',{exact:false}).waitFor();

  for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`artifacts/ui-users-${width}.png`,fullPage:true});}
  await page.getByRole('button',{name:'Close'}).click();
  await page.getByRole('link',{name:'Campaign Links',exact:true}).click();
  await page.getByRole('heading',{name:'Campaign Links / Link Builder'}).waitFor();
  await page.getByText('1 published campaign link(s).',{exact:true}).waitFor();
  await page.locator('input[name="source"]').fill(' Reddit ');
  await page.locator('input[name="campaign"]').fill(' Launch-Week ');
  await page.locator('input[name="medium"]').fill(' SOCIAL ');
  assert.equal(await page.locator('#canonical-slug').innerText(),'—');
  assert.equal(await page.locator('#canonical-source').innerText(),'reddit');
  assert.equal(await page.locator('#canonical-campaign').innerText(),'launch-week');
  assert.equal(await page.locator('#canonical-medium').innerText(),'social');
  const tracked='https://packone.pro/?utm_source=reddit&utm_campaign=launch-week&utm_medium=social';
  assert.equal(await page.getByLabel('Tracked UTM URL').inputValue(),tracked);
  assert.equal(await page.getByLabel('Intended vanity URL').inputValue(),'');
  assert.equal(await page.getByLabel('campaign-links.json entry').inputValue(),'');
  assert.equal(await page.getByRole('button',{name:'Copy tracked URL'}).isDisabled(),false);
  assert.equal(await page.getByRole('button',{name:'Copy vanity URL'}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Copy JSON entry'}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:/Publish/}).isDisabled(),true);
  await page.getByRole('button',{name:'Copy tracked URL'}).click();
  assert.equal(await page.evaluate(()=>window.__copiedText),tracked);
  await page.locator('input[name="slug"]').fill('New-Launch');
  assert.equal(await page.locator('#canonical-slug').innerText(),'new-launch');
  assert.equal(await page.getByLabel('Intended vanity URL').inputValue(),'https://packone.pro/go/new-launch/');
  assert.deepEqual(JSON.parse(await page.getByLabel('campaign-links.json entry').inputValue()),{slug:'new-launch',destination:'/',source:'reddit',campaign:'launch-week',medium:'social'});
  assert.equal(await page.getByRole('button',{name:'Publish vanity link'}).isDisabled(),false);
  await page.getByRole('button',{name:'Publish vanity link'}).click();
  await page.getByText('Publishing https://packone.pro/go/new-launch/. Required checks and the Pages deploy are running automatically.',{exact:true}).waitFor();
  assert.deepEqual(publishBodies,[{slug:'new-launch',destination:'/',source:'reddit',campaign:'launch-week',medium:'social'}]);
  await page.locator('input[name="source"]').fill('launch week');
  assert.ok(await page.locator('[data-error="source"]').isVisible());
  assert.equal(await page.getByRole('button',{name:'Copy tracked URL'}).isDisabled(),true);
  await page.locator('input[name="source"]').fill('reddit');
  await page.locator('input[name="slug"]').fill('REDDIT-LAUNCH');
  assert.match(await page.locator('#slug-warning').innerText(),/already exists in campaign-links\.json/);
  assert.equal(await page.getByRole('button',{name:'Copy JSON entry'}).isDisabled(),true);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Campaign link builder must not overflow horizontally');
  await page.screenshot({path:'artifacts/ui-campaign-links-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Admin mobile layout, locked state, filters, review details and CSV export passed.');
} finally {await browser.close();}
