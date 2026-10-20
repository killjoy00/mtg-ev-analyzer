// Capture publicly shared draft decisions using the real Pack One UI.
// Creates one disposable QA-marked guest replay of the user-authorized public share.
// Never exports a player token, response header, cookie, player id, run UUID, or account data.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const shareId=process.env.PACKONE_REVIEW_SHARE_ID;
assert.match(shareId||'',/^[a-f0-9]{24}$/);
const DEST='docs/marketing/launch-video/_rfa_capture';
const URL='https://packone.pro/open/shared/?id='+shareId;
const apiOrigin='https://api.packone.pro';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await mkdir(DEST,{recursive:true});

const previewResponse=await fetch(apiOrigin+'/draft/v1/shared-runs/'+shareId,{
  headers:{origin:'https://packone.pro',accept:'application/json'},
  signal:AbortSignal.timeout(25000)
});
assert.equal(previewResponse.status,200,'Shared run preview no longer available');
const preview=await previewResponse.json();
assert.equal(preview.id,shareId);
assert.equal(preview.run_length,8);
const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
let context;
try {
  context=await browser.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:1,
    locale:'en-US',timezoneId:'America/Los_Angeles',colorScheme:'light'});
  await context.addInitScript(()=>{
    try {localStorage.setItem('pack1-player-name-v1','QA Launch Video');} catch {}
  });
  const page=await context.newPage();
  let run=null;
  const failures=[];
  page.on('pageerror',e=>failures.push(e.message.slice(0,160)));
  page.on('response',response=>{
    if(response.request().method()!=='POST'&&response.request().method()!=='GET')return;
    try {
      const pathname=new URL(response.url()).pathname;
      if(pathname.includes('/v1/runs'))console.log('RUN_HTTP',response.request().method(),pathname.replace(/[a-f0-9-]{36}/g,'<run-id>'),response.status());
      if(/^\/draft\/v1\/runs(?:\/[a-f0-9-]+(?:\/pick)?)?$/.test(pathname)&&response.ok()) {
        void response.json().then(data=>{
          if(data?.current||data?.answers){
            run=data;
            console.log('CAPTURED_STATE',JSON.stringify({round:data.round,candidates:data.current?.candidates?.length,answers:data.answers?.length}));
          }
        }).catch(()=>{});
      }
    }catch{}
  });
  // Mark only the new guest replay as QA. This does not alter the shared run.
  await page.route('**/draft/v1/runs',async route=>{
    const request=route.request();
    if(request.method()==='POST'){
      const body=request.postDataJSON()||{};
      if(body.challenge===shareId)
        return route.continue({postData:JSON.stringify({...body,qa:true})});
    }
    return route.continue();
  });
  await page.goto(URL,{waitUntil:'domcontentloaded',timeout:55000});
  await page.locator('#accept-run-challenge').waitFor({timeout:55000});
  console.log('Share invitation loaded; score',preview.score,'eight decisions');
  await page.locator('#accept-run-challenge').click();
  await page.locator('.run-cards .run-card-select').first().waitFor({timeout:55000});
  let records=[];
  for(let round=0;round<8;round++){
    await page.waitForFunction(n=>{
      const heading=document.querySelector('.run-heading')?.textContent||'';
      return heading.includes('Round '+n+'/8')&&document.querySelectorAll('.run-card-select img').length>=10;
    },round+1,{timeout:50000});
    await page.waitForFunction(()=>{
      const imgs=[...document.querySelectorAll('.run-cards .run-card-select img')];
      for(const el of imgs)el.loading='eager';
      return imgs.length>=10&&imgs.every(el=>el.complete&&el.naturalWidth>100);
    },null,{timeout:45000});
    await page.evaluate(async()=>{
      await Promise.all([...document.querySelectorAll('.run-cards .run-card-select img')].map(x=>x.decode()));
    });
    // Wait for the matching server state before reading it.
    for(let wait=0;wait<25&&(!run?.current||run?.round!==round+1);wait++)await sleep(200);
    const puzzle=run?.current;
    console.log('ROUND_STATE',JSON.stringify({round:round+1,server_round:run?.round,
      captured:!!run,candidates:puzzle?.candidates?.length,dom_cards:await page.locator('.run-card-select img').count()}));
    assert.ok(puzzle?.candidates?.length>=10,'No authoritative puzzle for round '+(round+1));
    const all=puzzle.candidates.map(c=>({
      id:c.id,name:c.name,image_url:c.image_url,rarity:c.rarity,
      model_probability:Number(c.model_probability||0)
    }));
    const historical=puzzle.historical_pick_id;
    const sorted=all.slice().sort((a,b)=>b.model_probability-a.model_probability);
    // This is an *automated QA preview pick*, not the share creator's pick.
    // Alternate the top two displayed probability choices to create genuine differences.
    const chosen=sorted[Math.min(round%2,sorted.length-1)]||all[0];
    assert.ok(chosen?.id&&all.some(c=>c.id===chosen.id));
    const prior=(puzzle.prior_picks||[]).map(c=>({name:c.name,image_url:c.image_url}));
    // Exact live site screenshot, before selection. No username in the screenshots.
    await page.locator('.run-cards').screenshot({path:path.join(DEST,'r'+(round+1)+'-pack.png')});
    await page.locator('[data-pick="'+chosen.id+'"]').click();
    await page.locator('#run-lock').click();
    await page.locator('#run-next').waitFor({timeout:40000});
    for(let wait=0;wait<40&&!run?.answers?.[round];wait++)await sleep(175);
    const answer=run?.answers?.[round];
    assert.ok(answer,'Missing genuine trophy reveal for round '+(round+1));
    assert.equal(answer.selectedId,chosen.id);
    const trophyId=answer.historicalId;
    const trophy=all.find(c=>c.id===trophyId);
    assert.ok(trophy,'Trophy choice not in source pack');
    await page.locator('.run-feedback').screenshot({path:path.join(DEST,'r'+(round+1)+'-reveal.png')});
    records.push({
      round:round+1,set_id:puzzle.set_id,pick_number:puzzle.pick_number,
      candidates:all,prior_picks:prior,automated_preview_pick:chosen.name,
      actual_trophy_pick:trophy.name,
      preview_pick_score:answer.score,
      historical_match:answer.historicalMatch===true,
      pack_image:'r'+(round+1)+'-pack.png',
      reveal_image:'r'+(round+1)+'-reveal.png',
    });
    console.log('Round',round+1,'set',puzzle.set_id,'cards',all.length,'trophy',trophy.name);
    await page.locator('#run-next').click();
    if(round<7)await page.locator('.run-cards').waitFor({timeout:45000});
  }
  const rfa=records.filter(p=>p.set_id==='fra');
  const result={
    source:'User-authorized public shared-run invitation',
    preview_score:preview.score,
    preview_run_length:preview.run_length,
    source_format:preview.environment,
    real_gameplay:true,
    notes:'Selections in capture are QA preview selections, never presented as original sharer choices.',
    decisions:records,
  };
  await writeFile(path.join(DEST,'sanitized-picks.json'),JSON.stringify(result,null,2)+'\n');
  assert.ok(rfa.length>=2,'The shared run contains fewer than two actual Reality Fracture decisions');
  console.log(JSON.stringify({real_picks:records.length,rfa_picks:rfa.length,available_rfa_rounds:rfa.map(x=>x.round),
    revealed_rfa_trophy_picks:rfa.map(x=>({round:x.round,pick:x.actual_trophy_pick})),
    share_score:preview.score,page_errors:failures.slice(0,3)}));
} finally {
  if(context)await context.close().catch(()=>{});
  await browser.close();
}
