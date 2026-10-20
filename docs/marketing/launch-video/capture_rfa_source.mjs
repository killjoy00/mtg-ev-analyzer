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
    // Read the actual, rendered game cards. This also works if requests are
    // serviced by a first-party gateway or a service worker.
    const header=await page.locator('.run-heading h1').innerText();
    const setId=/reality fracture/i.test(header)?'fra':'other';
    const pickNumber=Number(header.match(/Pick\\s+(\\d+)/i)?.[1]||0);
    const all=await page.locator('.run-cards .run-card').evaluateAll(rows=>rows.map(row=>{
      const button=row.querySelector('[data-pick]');
      const img=row.querySelector('.run-card-select img');
      return {id:button?.getAttribute('data-pick')||'',name:row.querySelector('.run-card-name')?.textContent?.trim()||img?.alt||'',
              image_url:img?.currentSrc||img?.src||'',rarity:null,model_probability:0};
    }));
    const prior=await page.locator('.run-pool-cards button').evaluateAll(rows=>rows.map(button=>({
      name:button.querySelector('img')?.alt||'',
      image_url:button.querySelector('img')?.currentSrc||button.querySelector('img')?.src||''
    })));
    assert.ok(all.length>=10&&all.every(c=>c.id&&c.name&&c.image_url),'Live pack did not expose complete cards');
    const chosen=all[round%2];
    console.log('SOURCE_ROUND',round+1,'set',setId,'pack_cards',all.length,'pick',pickNumber);
    // Exact live site screenshot, before selection. No username in the screenshots.
    await page.locator('.run-cards').screenshot({path:path.join(DEST,'r'+(round+1)+'-pack.png')});
    await page.locator('[data-pick="'+chosen.id+'"]').click();
    await page.locator('#run-lock').click();
    await page.locator('#run-next').waitFor({timeout:40000});
    const scoreText=await page.locator('.run-feedback-score').innerText();
    const revealedTrophy=page.locator('.run-reveal-pick.is-trophy img');
    const samePick=await page.locator('.run-reveal-pick.is-shared img').count()>0;
    const trophyName=samePick?chosen.name:await revealedTrophy.first().getAttribute('alt');
    const trophy=all.find(c=>c.name===trophyName);
    assert.ok(trophy, 'Real trophy pick was not visible in the source pack');
    const demoScore=Number.parseInt(scoreText,10);
    assert.ok(Number.isInteger(demoScore)&&demoScore>=0&&demoScore<=100);
    await page.locator('.run-feedback').screenshot({path:path.join(DEST,'r'+(round+1)+'-reveal.png')});
    records.push({
      round:round+1,set_id:setId,pick_number:pickNumber,
      candidates:all,prior_picks:prior,automated_preview_pick:chosen.name,
      actual_trophy_pick:trophy.name,
      preview_pick_score:demoScore,
      historical_match:samePick,
      pack_image:'r'+(round+1)+'-pack.png',
      reveal_image:'r'+(round+1)+'-reveal.png',
    });
    console.log('Round',round+1,'set',setId,'cards',all.length,'trophy',trophy.name);
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
