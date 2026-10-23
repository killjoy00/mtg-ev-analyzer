import assert from 'node:assert/strict';
import {brotliDecompressSync} from 'node:zlib';
import {chromium} from 'playwright';
import {encoded} from '../corpus/trophy-decks/fra.mjs';
import {trophyDeckForRound} from '../worker/trophy-decks.mjs';
const catalog=JSON.parse(brotliDecompressSync(Buffer.from(encoded,'base64')));
const deck=await trophyDeckForRound(async()=>({rows:[{set_id:'fra',source_draft_hash:Object.keys(catalog.sources)[0]}]}),{answers:[{puzzle:{puzzle_id:'test'}}],puzzle_ids:['test']},'0');
const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(base+'/__deck-test',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/visual-c.css"><link rel="stylesheet" href="/draft-run.css"></head><body><button id="open">Click here to see the drafter’s deck.</button><script type="module">import{openTrophyDeck}from'/trophy-deck-dialog.mjs';window.loads=0;document.querySelector('#open').onclick=()=>openTrophyDeck(async()=>{window.loads++;if(window.fail)throw Error('retry');return ${JSON.stringify(deck)}},{trophyName:${JSON.stringify(deck.deck[0].name)},priorNames:[${JSON.stringify(deck.deck[1].name)}],record:'7–1'});</script></body></html>`}));
 await page.goto(base+'/__deck-test');
 assert.equal(await page.locator('.run-deck-dialog').count(),0);
 await page.waitForFunction(()=>typeof window.loads==='number');assert.equal(await page.evaluate(()=>window.loads),0);
 await page.locator('#open').click();
 await page.getByRole('heading',{name:'Trophy Drafter’s Decklist',exact:true}).waitFor();
 await page.locator('.run-deck-group').first().waitFor();
 assert.equal(await page.evaluate(()=>window.loads),1);
 assert.equal(await page.locator('.run-deck-row.is-trophy').count(),1);
 assert.equal(await page.locator('.run-deck-row i').count(),1);
 assert.match(await page.locator('.run-deck-meta').innerText(),/7-1/);
 assert.equal(await page.locator('.run-deck-group .run-deck-row>span:first-child').evaluateAll(nodes=>nodes.reduce((sum,n)=>sum+Number(n.textContent),0)),deck.size);
 for(const width of [390,320,1440]) {
  await page.setViewportSize({width,height:844});
  assert.equal(await page.locator('.run-deck-dialog').evaluate(d=>d.scrollWidth>d.clientWidth),false);
 }
 await page.keyboard.press('Escape');assert.equal(await page.locator('#open').evaluate(n=>n===document.activeElement),true);
 await page.evaluate(()=>window.fail=true);await page.locator('#open').click();
 await page.getByRole('alert').waitFor();await page.evaluate(()=>window.fail=false);
 await page.getByRole('button',{name:'Try again',exact:true}).click();
 await page.locator('.run-deck-group').first().waitFor();
 assert.equal(await page.evaluate(()=>window.loads),3);
 await page.locator('.run-deck-row [data-deck-card]').first().click();
 await page.locator('.card-face-dialog').waitFor();await page.keyboard.press('Escape');
 assert.equal(await page.locator('.run-deck-dialog').count(),1,'card zoom returns to the deck');
 await page.getByRole('button',{name:'Close decklist'}).click();
 assert.deepEqual(errors,[]);
 console.log('Trophy deck UI verified: lazy loading, exact list, mobile widths, retry, card zoom and focus restoration.');
} finally {await browser.close();}
