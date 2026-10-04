import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
fs.mkdirSync('artifacts',{recursive:true});
for(const [name,engine] of Object.entries({chromium,webkit})) {
 const browser=await engine.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/admin/');
  await page.evaluate(async()=>{
   const {renderCorpus}=await import('/admin/corpus.mjs');
   const a='a'.repeat(64),b='b'.repeat(64);
   window.readiness={operation_id:'1',current_operation_id:'1',revision:'1',current_revision:'1',state:'ready',ready:true,current:true,attempts:1,cache_snapshot_id:'1'};
   window.calls=[];
   window.corpusFixture={corpus_version:'fixture',serving_revision:'1',gate_version:'fixture',history:[],components:[],blocked_sources:[],
    transitions:{Live:['Paused'],Paused:['Live']},
    sets:[{set_id:'qa',set_name:'Readiness fixture',status:'Live',active_snapshot_id:a,health_current:true,ready:true,serving_count:500,serving_parent_count:500,serving_component_count:0,staged_count:512,under_floor_count:0,manifest:{},report:{gates:[]}}],
    snapshots:[{set_id:'qa',source_snapshot_id:a,active:true,environment_status:'Live',lifecycle_status:'Approved',ready:true,health_current:true},
     {set_id:'qa',source_snapshot_id:b,active:false,environment_status:'Live',lifecycle_status:'Candidate',ready:true,health_current:true,created_at:'2026-09-26T12:00:00Z'}]};
   window.originalFixture=structuredClone(window.corpusFixture);
   window.fixtureRequest=async(path,body)=>{
    window.calls.push({path,body});
    if(path==='/v1/admin/corpus/readiness')return structuredClone(window.readiness);
    if(path==='/v1/admin/corpus'){
     const overview=structuredClone({...window.corpusFixture,readiness:window.readiness});
     delete overview.snapshots;
     return overview;
    }
    if(path==='/v1/admin/corpus/qa/detail')return structuredClone({...window.corpusFixture,readiness:window.readiness});
    if(path==='/v1/admin/corpus/qa/snapshot') {
     const next=String(Number(window.readiness.current_revision)+1);
     window.readiness={...window.readiness,operation_id:next,current_operation_id:next,revision:next,current_revision:next,state:'warming',ready:false,cache_snapshot_id:null};
     window.corpusFixture.serving_revision=next;window.corpusFixture.sets[0].active_snapshot_id=b;
     return new Promise((resolve,reject)=>{
      window.loseActivation=()=>reject(new DOMException('Fixture response lost after commit','TimeoutError'));
      window.finishActivation=()=>{
       window.readiness={...window.readiness,state:'failed',last_error:{code:'verification_failed',message:'Fixture source verification failed'}};
       resolve({ok:false,activation_committed:true,activation_event_id:next,readiness:structuredClone(window.readiness)});
      };
     });
    }
    if(path==='/v1/admin/corpus/readiness/2/retry') {
     window.readiness={...window.readiness,state:'verifying',ready:false,last_error:null};
     return {ok:false,publication_unchanged:true,readiness:structuredClone(window.readiness)};
    }
    throw Error('Unexpected fixture request: '+path);
   };
   document.body.innerHTML='<main id="fixture"></main>';
   await renderCorpus(document.querySelector('#fixture'),window.fixtureRequest);
  });
  const panel=page.locator('#corpus-readiness');
  await page.locator('[data-open-set="qa"]').click();
  await page.locator('select[name="sourceSnapshotId"]').selectOption('b'.repeat(64));
  assert.ok(await page.evaluate(()=>window.calls.some(c=>c.path==='/v1/admin/corpus/qa/detail')),'Snapshot controls must come from the deferred exact-detail request');
  await page.getByRole('button',{name:'Activate snapshot',exact:true}).click();
  assert.doesNotMatch(await panel.innerText(),/Ready: revision/,'Old readiness is not a success for a new pending activation');
  await page.waitForFunction(()=>document.querySelector('#corpus-readiness')?.textContent.includes('cache is warming'));
  assert.doesNotMatch(await panel.innerText(),/Ready: revision/);
  assert.match(await page.locator('.corpus-action-error').innerText(),/cache is warming/);
  const posts=await page.evaluate(()=>window.calls.filter(c=>c.body));
  assert.equal(posts.length,1);assert.equal(posts[0].body.expectedActiveSnapshotId,'a'.repeat(64));
  await page.screenshot({path:`artifacts/ui-readiness-${name}-warming.png`,fullPage:true});

  await page.evaluate(()=>window.finishActivation());
  await page.getByRole('button',{name:'Retry readiness without changing publication'}).waitFor();
  assert.match(await panel.innerText(),/readiness failed/);
  assert.match(await page.locator('#corpus-status').innerText(),/do not repeat activation/);
  await page.screenshot({path:`artifacts/ui-readiness-${name}-failed.png`,fullPage:true});
  await page.getByRole('button',{name:'Retry readiness without changing publication'}).click();
  await page.waitForFunction(()=>document.querySelector('#corpus-readiness')?.textContent.includes('verification are still running'));
  assert.doesNotMatch(await panel.innerText(),/Ready: revision/);
  await page.evaluate(()=>{window.readiness={...window.readiness,state:'ready',ready:true,current:true,cache_snapshot_id:'2'};});
  await page.waitForFunction(()=>document.querySelector('#corpus-readiness')?.textContent.includes('Ready: revision 2'));
  assert.equal((await page.evaluate(()=>window.calls.filter(c=>c.body&&c.path.endsWith('/snapshot')))).length,1,'Readiness retry must not replay activation');
  assert.equal((await page.evaluate(()=>window.calls.filter(c=>c.body&&c.path.endsWith('/retry')))).length,1);
  await page.screenshot({path:`artifacts/ui-readiness-${name}-ready.png`,fullPage:true});

  await page.evaluate(async()=>{
   window.readiness={...window.readiness,state:'superseded',ready:false,current:false,current_revision:'3',current_operation_id:'3'};
   const {observeReadiness}=await import('/admin/corpus-readiness.mjs');
   observeReadiness(document.querySelector('#fixture'),window.fixtureRequest);
  });
  await page.waitForFunction(()=>document.querySelector('#corpus-readiness')?.textContent.includes('newer serving revision'));
  assert.doesNotMatch(await panel.innerText(),/Ready: revision/);
  assert.equal(await panel.locator('[data-readiness-retry]').count(),0);

  // The HTTP client may stop waiting before the durable operation finishes.
  // Losing that response must neither stop status recovery nor replay activation.
  await page.evaluate(async()=>{
   window.corpusFixture=structuredClone(window.originalFixture);window.corpusFixture.serving_revision='3';
   window.readiness={operation_id:'3',current_operation_id:'3',revision:'3',current_revision:'3',state:'ready',ready:true,current:true,attempts:1,cache_snapshot_id:'3'};
   window.calls=[];
   const {renderCorpus}=await import('/admin/corpus.mjs');
   await renderCorpus(document.querySelector('#fixture'),window.fixtureRequest);
  });
  await page.locator('[data-open-set="qa"]').click();
  await page.locator('select[name="sourceSnapshotId"]').selectOption('b'.repeat(64));
  await page.getByRole('button',{name:'Activate snapshot',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#corpus-readiness')?.textContent.includes('cache is warming'));
  await page.evaluate(()=>window.loseActivation());
  await page.getByRole('button',{name:'Refresh committed status',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Activate snapshot',exact:true}).isDisabled(),true);
  await page.evaluate(()=>{window.readiness={...window.readiness,state:'ready',ready:true,current:true,cache_snapshot_id:'4'};});
  await page.waitForFunction(()=>document.querySelector('.corpus-action-error')?.textContent.includes('Ready: revision 4'));
  assert.match(await panel.innerText(),/Ready: revision 4/);
  assert.equal((await page.evaluate(()=>window.calls.filter(c=>c.body&&c.path.endsWith('/snapshot')))).length,1,'Lost response recovery never repeats publication');
  await page.screenshot({path:`artifacts/ui-readiness-${name}-lost-response.png`,fullPage:true});
  await page.getByRole('button',{name:'Refresh committed status',exact:true}).click();
  assert.match(await panel.innerText(),/Ready: revision 4/);

  for(const width of [320,390,1440]) {
   await page.setViewportSize({width,height:844});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Readiness must not introduce horizontal page overflow');
  }
  assert.deepEqual(errors,[]);
  console.log(`${name}: actual Corpus UI proves pending, failure, retry, ready, supersession and lost-response recovery without replaying activation.`);
 } finally {await browser.close();}
}
