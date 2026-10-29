import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {publicDraftRunPuzzle,publicDraftRunAnswer,gradeDraftRunPick} from '../draft-run.mjs';

const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const rows=JSON.parse(gunzipSync(fs.readFileSync('corpus/draft-run/neo.json.gz')));
const puzzle=structuredClone(rows.find(p=>p.candidates.some(c=>c.name==='Fable of the Mirror-Breaker')));
const fable=puzzle.candidates.find(c=>c.name==='Fable of the Mirror-Breaker');
puzzle.prior_picks=[fable];puzzle.pick_number=2;
let picks=0,answers=[],failBack=false;
const id='11111111-1111-4111-8111-111111111111';
const snapshot=()=>({id,environment:'mixed',day:null,run_length:8,revision:answers.length,round:answers.length+1,
  answers:answers.map(publicDraftRunAnswer),complete:false,current:publicDraftRunPuzzle(puzzle),
  rerolls:{set:0,pack:0},set_reroll_allowed:false,custom_set_ids:[]});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/v1/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let body={};
  if(path.endsWith('/session'))body={token:'p1_'+id+'.'+'a'.repeat(43)};
  else if(path.endsWith('/daily-status'))body={day:'2026-10-21',player:{claimed:false},capabilities:[]};
  else if(path.endsWith('/pick')){
    picks++;
    const cardId=route.request().postDataJSON().cardId;
    // Saved snapshot has only the old single-image shape; production's answer
    // serializer enriches it without rewriting the recorded score/evidence.
    answers=[{...gradeDraftRunPick(puzzle,cardId),puzzle:structuredClone(puzzle)}];
    body=snapshot();
  }else if(path.includes('/runs'))body=snapshot();
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
});
await page.route('https://cards.scryfall.io/**',route=>{
  const back=route.request().url().includes('/back/');
  if(back&&failBack)return route.fulfill({status:503,body:'unavailable'});
  return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680"><rect width="488" height="680" rx="20" fill="${back?'#355348':'#b86b48'}"/><text x="244" y="340" text-anchor="middle" font-size="36" fill="white">${back?'Back':'Front'}</text></svg>`});
});
try {
  await page.goto(base+'/?game=draft-run');
  await page.locator('.run-cards').waitFor();
  const zoom=page.locator(`[data-zoom="${fable.id}"]`);
  assert.match(await zoom.locator('..').innerText(),/2 faces/);
  await page.locator(`[data-pick="${fable.id}"]`).click();
  for(const width of [320,390,1440]) {
    await page.setViewportSize({width,height:900});
    await zoom.click();
    const dialog=page.locator('.card-face-dialog');await dialog.waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('.card-face-dialog img')].every(img=>img.complete&&img.naturalWidth));
    assert.equal(await dialog.locator('[data-face]:visible').count(),width>=760?2:1);
    assert.equal(await dialog.locator('figcaption').count(),2,'two-faced cards label each face');
    if(width<760) {
      await dialog.getByRole('button',{name:'Show back: Reflection of Kiki-Jiki'}).focus();
      await page.keyboard.press('Enter');
      assert.equal(await dialog.locator('[data-face="1"]').isVisible(),true);
      await dialog.getByRole('button',{name:'Show front: Fable of the Mirror-Breaker'}).click();
    }else{
      const a=await dialog.locator('[data-face="0"]').boundingBox(),b=await dialog.locator('[data-face="1"]').boundingBox();
      assert.ok(b.x>=a.x+a.width,'desktop faces are side by side');
    }
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'viewer has no horizontal overflow');
    assert.equal(await dialog.isVisible(),true,'the face toggle keeps the viewer open');
    // Escape closes it, and so does a tap anywhere, including on the card itself.
    if(width===390)await dialog.locator('[data-face="0"] img').click();else await page.keyboard.press('Escape');
    await dialog.waitFor({state:'detached'});
    assert.ok(await zoom.evaluate(el=>document.activeElement===el),'focus returns to enlarge button');
    assert.equal(await page.locator(`[data-pick="${fable.id}"]`).getAttribute('aria-pressed'),'true');
    assert.equal(picks,0,'inspection never submits a pick');
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-zoom-prior="0"]').click();
  await page.getByRole('button',{name:'Show back: Reflection of Kiki-Jiki'}).click();
  await page.keyboard.press('Escape');
  failBack=true;
  const failureCard=publicDraftRunPuzzle(puzzle).candidates.find(c=>c.id===fable.id);
  failureCard.display_faces=failureCard.display_faces.map(face=>({...face,image_url:face.image_url+'&failure-check=1',large_image_url:face.large_image_url+'&failure-check=1'}));
  await page.evaluate(async card=>{const {openCardViewer}=await import('/card-viewer.mjs');openCardViewer(card);},failureCard);
  await page.getByRole('button',{name:'Show back: Reflection of Kiki-Jiki'}).click();
  await page.locator('.card-face-error:visible').waitFor();
  failBack=false;await page.locator('.card-face-error:visible').getByRole('button',{name:'Retry image'}).click();
  await page.waitForFunction(()=>{const img=document.querySelector('[data-face="1"] img');return !img.hidden&&img.complete&&img.naturalWidth>0;});
  await page.keyboard.press('Escape');
  await page.locator('#run-lock').click();await page.locator('.run-feedback').waitFor();
  await page.locator(`[data-zoom="${fable.id}"]:visible`).first().click();
  await page.getByRole('button',{name:'Show back: Reflection of Kiki-Jiki'}).click();
  assert.equal(picks,1);
  await page.keyboard.press('Escape');
  // Shared viewer also handles single-image cards and meld, with no gameplay callbacks.
  await page.evaluate(async()=>{const {openCardViewer}=await import('/card-viewer.mjs');openCardViewer({name:'Single',image_url:'https://cards.scryfall.io/normal/front/single.jpg'});});
  assert.equal(await page.locator('[data-face-toggle]').count(),0);
  assert.equal(await page.locator('.card-face-dialog figcaption').count(),0,'single-faced cards show their name once, in the header');
  await page.locator('.card-face-header strong').click();await page.locator('.card-face-dialog').waitFor({state:'detached'});
  assert.deepEqual(errors,[]);
  console.log('Card faces: pack, pool, saved feedback, 320/390/1440 widths, keyboard, retry and pick isolation passed.');
} finally {await browser.close();}
