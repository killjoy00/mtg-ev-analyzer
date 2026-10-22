// Admin rendering contract, synthetic report and pack only.
import {chromium} from 'playwright';import assert from 'node:assert/strict';
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.PACK1_E2E_URL||'http://127.0.0.1:4173')+'/admin/');
 await page.evaluate(async()=>{
  const {renderPlayerReports}=await import('/admin/player-reports.mjs');
  window.actions=[];window.removal={removed:false,revision:0,copies:0,history:[]};
  const report={id:'11111111-1111-4111-8111-111111111111',status:'open',reason:'uninteresting',set_id:'fra',pick_number:5,puzzle_id:'synthetic-pick',comment:'<img src=x onerror=alert(1)>',selected_card_name:'Test card',reports_on_decision:2,independent_reporters:2};
  const root=document.getElementById('admin');
  await renderPlayerReports(root,async(path,body,method)=>{
   if(path==='/v1/admin/player-reports/serving/warmup')return {readiness:{ready:false,state:'warming'}};
   if(path.endsWith('/pick')) {
    if(method==='POST') {
     window.actions.push(body);
     if(window.forceConflict)throw Error('Pick inventory or moderation changed. Refresh the pick and retry.');
     window.removal={removed:body.action==='remove',revision:body.expected_revision+1,copies:2,reason:body.reason,updated_at:'2026-10-22T18:00:00Z',history:[{removed:body.action==='remove',revision:body.expected_revision+1,reason:body.reason,created_at:'2026-10-22T18:00:00Z',actor_id:'synthetic-admin',report_id:report.id}]};
     return {moderation_committed:true,readiness:{ready:false,state:'queued'}};
    }
    return {available:true,puzzle:{prior_picks:[{id:'prior',name:'Prior card'}],historical_pick_id:'test'},ranking:[{id:'test',name:'Test card',score:100,model_probability:.7},{id:'other',name:'Other card',score:80,model_probability:.3}],selected_card_id:'other',moderation:window.removal,readiness:{ready:false,state:'queued'}};
   }
   return {rows:[report],total:1,page_size:25,summary:{decisions:{open:1},profiles:{open:0}}};
  });
 });
 await page.getByText('<img src=x onerror=alert(1)>',{exact:true}).waitFor();
 assert.equal(await page.locator('.player-report-comment img').count(),0,'Reported text is not HTML');
 await page.getByRole('button',{name:'Review pick / removal'}).click();
 await page.getByRole('heading',{name:'Pack · model scores for this report'}).waitFor();
 await page.getByText('Prior card',{exact:true}).waitFor();
 await page.getByText('Trophy pick',{exact:true}).waitFor();
 await page.getByText('Player pick',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Remove from future games',exact:true}).click();
 assert.equal((await page.evaluate(()=>window.actions)).length,0,'Reason is required');
 await page.getByLabel('Reason required for removal').fill('Forced decision');
 page.once('dialog',d=>d.dismiss());
 await page.getByRole('button',{name:'Remove from future games',exact:true}).click();
 assert.equal((await page.evaluate(()=>window.actions)).length,0,'Canceled removal does not mutate');
 page.once('dialog',d=>d.accept());
 await page.getByRole('button',{name:'Remove from future games',exact:true}).click();
 await page.getByRole('heading',{name:'Removed from future games',exact:true}).waitFor();
 await page.getByRole('button',{name:'Restore pick',exact:true}).waitFor();
 assert.equal((await page.evaluate(()=>window.actions))[0].expected_revision,0);
 await page.getByText('Inspect or retry serving readiness',{exact:true}).waitFor();
 await page.getByLabel('Reason required for restoration').fill('Question is useful after review');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Restore pick',exact:true}).click();
 await page.getByRole('heading',{name:'Available under normal eligibility rules'}).waitFor();
 assert.equal((await page.evaluate(()=>window.actions))[1].expected_revision,1);
 await page.evaluate(()=>{window.forceConflict=true;});
 await page.getByLabel('Reason required for removal').fill('Concurrent test');page.once('dialog',d=>d.accept());
 await page.getByRole('button',{name:'Remove from future games',exact:true}).click();
 await page.getByText(/Refresh the pick to confirm its state/).waitFor();
 await page.getByRole('button',{name:'Refresh pick',exact:true}).click();
 await page.getByRole('heading',{name:'Available under normal eligibility rules'}).waitFor();
 assert.equal((await page.evaluate(()=>window.actions)).length,3,'Refresh never repeats a mutation');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Mobile has no horizontal overflow');
 assert.deepEqual(errors,[]);console.log('Report-linked removal admin browser contract passed.');
} finally {await browser.close();}
