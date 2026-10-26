// Included by admin-e2e.mjs. Synthetic admin session; the review set and key
// are the checked-in static files. Card images are stubbed so no external
// request is made.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ADMIN_API_VERSION} from '../admin-api-contract.mjs';

const PIXEL=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64');

export async function runPuzzleReviewChecks(browser) {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[],keyRequests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('puzzle-review-v1-key.json'))keyRequests.push(request.url());});
  await page.addInitScript(()=>localStorage.setItem('pack1-auth-session-v1','synthetic-review-session'));
  await page.route('https://cards.scryfall.io/**',route=>route.fulfill({contentType:'image/png',body:PIXEL}));
  await page.route('**/v1/account/session',route=>route.fulfill({json:{user:{id:'22222222-2222-4222-8222-222222222222',email:'review@example.invalid'}}}));
  await page.route(/\/health\?quick=1$/,route=>route.fulfill({headers:{'x-pack1-admin-api-version':String(ADMIN_API_VERSION)},json:{ok:true,admin_api_version:ADMIN_API_VERSION}}));
  await page.route('**/v1/admin/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/v1/admin/access')return route.fulfill({json:{ok:true,role:'owner'}});
    return route.fulfill({status:404,json:{error:'Unexpected synthetic request'}});
  });
  try {
    await page.goto('http://127.0.0.1:4173/admin/');
    await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
    await page.getByRole('link',{name:'Puzzle Review',exact:true}).click();
    await page.getByRole('heading',{name:'Puzzle review',exact:true}).waitFor();
    await page.getByRole('heading',{name:'0 of 24 rated'}).waitFor();
    assert.equal(await page.locator('[data-rating="interesting"]').isDisabled(),true,'Rating waits for the trophy reveal');
    assert.equal(await page.locator('.review-pack figure.trophy').count(),0,'Trophy pick hidden before reveal');

    await page.getByRole('button',{name:'Show trophy pick'}).click();
    await page.locator('.review-pack figure.trophy').waitFor();
    await page.getByText('Trophy pick · 100').waitFor();
    await page.locator('#review-note').fill('Synthetic note');
    await page.getByRole('button',{name:/^Interesting/}).click();
    await page.getByRole('heading',{name:'1 of 24 rated'}).waitFor();
    await page.getByRole('heading',{name:'Puzzle 2 of 24'}).waitFor();
    await page.reload();
    await page.getByRole('heading',{name:'1 of 24 rated'}).waitFor();

    fs.mkdirSync('artifacts',{recursive:true});
    for(const width of [320,390,1280]) {
      await page.setViewportSize({width,height:900});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Puzzle review fits ${width}px`);
      await page.screenshot({path:`artifacts/ui-admin-puzzle-review-${width}.png`,fullPage:true});
    }
    await page.setViewportSize({width:1280,height:900});

    const ratings=['fine','dull','broken','interesting'];
    for(let i=1;i<24;i++) {
      await page.getByRole('button',{name:'Show trophy pick'}).click();
      await page.locator(`[data-rating="${ratings[i%4]}"]`).click();
    }
    await page.getByRole('heading',{name:'24 of 24 rated'}).waitFor();
    assert.deepEqual(keyRequests,[],'The arm key is not requested before every puzzle is rated');
    await page.getByRole('button',{name:'See results'}).click();
    await page.getByRole('heading',{name:/^The proposed rule (passes|does not pass)$/}).waitFor();
    assert.equal(keyRequests.length,1);
    assert.equal(await page.locator('.review-pairs tbody tr').count(),12);
    await page.getByText('Note: Synthetic note').waitFor();
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download results'}).click();
    const saved=JSON.parse(fs.readFileSync(await (await download).path(),'utf8'));
    assert.equal(saved.version,'puzzle-review-v1');
    assert.equal(Object.keys(saved.ratings).length,24);
    assert.equal(saved.pairs.length,12);
    for(const width of [320,1280]) {
      await page.setViewportSize({width,height:900});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Review results fit ${width}px`);
      await page.screenshot({path:`artifacts/ui-admin-puzzle-review-results-${width}.png`,fullPage:true});
    }
    await page.reload();
    await page.getByRole('heading',{name:/^The proposed rule (passes|does not pass)$/}).waitFor();
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'Start a new review'}).click();
    await page.getByRole('heading',{name:'0 of 24 rated'}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS: Puzzle review blinding, reveal-before-rating, saved progress, results, export, reset, and responsive widths.');
  } finally {await page.close();}
}
