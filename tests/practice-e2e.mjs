// Retired entry points must never launch a legacy mode or request replay data.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
try{
 const page=await browser.newPage();let legacyLoads=0;
 page.on('request',r=>{if(/\/(app\.js|social\.mjs|shards\/)/.test(r.url()))legacyLoads++;});
 await page.route('**/*.neon.tech/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"QA unavailable"}'}));
 for(const query of ['?modes=1','?set=neo&mode=top3&seed=old','?set=powered-cube&mode=full']){
  await page.goto((process.env.PACK1_E2E_URL||'http://127.0.0.1:4173')+'/'+query);
  await page.waitForFunction(()=>!new URLSearchParams(location.search).has('mode')&&!new URLSearchParams(location.search).has('modes'));
  assert.equal(await page.getByText('More modes',{exact:true}).count(),0);
 }
 assert.equal(legacyLoads,0);console.log('Retired launch redirects passed.');
}finally{await browser.close();}
