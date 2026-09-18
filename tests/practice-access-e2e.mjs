import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {publicDraftRunPuzzle,interestingDraftRunPuzzle} from '../draft-run.mjs';
const fixture=JSON.parse(gunzipSync(fs.readFileSync('corpus/draft-run/hob.json.gz'))).find(p=>p.pick_number===1&&interestingDraftRunPuzzle(p));
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
let selected=null;
await page.route('**/*.neon.tech/**',async route=>{
 const path=new URL(route.request().url()).pathname;let body={ok:true},status=200;
 if(path==='/v1/session')body={token:'practice-browser'};
 if(path==='/v1/practice-sets')body={sets:[{set_id:'hob',set_name:'The Hobbit'},{set_id:'msh',set_name:'Marvel Super Heroes'},{set_id:'sos',set_name:'Secrets of Strixhaven'}]};
 if(path==='/v1/runs'){
   const request=route.request().postDataJSON();selected=request.setIds;
   if(!selected){status=403;body={error:'A free account is required for regular practice.',capability:'unlimited_regular_practice'};}
   else body={id:'11111111-1111-4111-8111-111111111111',environment:'mixed',run_length:8,round:1,revision:0,answers:[],rerolls:{set:0,pack:2},custom_set_ids:selected,current:publicDraftRunPuzzle(fixture)};
 }
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
});
try{
 const base=process.env.PACK1_E2E_URL||'http://127.0.0.1:4173';
 await page.goto(base+'/?game=draft-run');
 await page.getByRole('heading',{name:'Keep drafting with a free account'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Sign in or create an account'}).count(),1);
 assert.equal(await page.getByRole('link',{name:'Back to Dailies'}).count(),1);
 await page.goto(base+'/?game=draft-run&custom=1');
 await page.getByRole('heading',{name:'Choose your sets'}).waitFor();
 assert.equal(await page.locator('input:checked').count(),1);
 await page.getByLabel('Marvel Super Heroes').check();
 await page.screenshot({path:'artifacts/custom-sets-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Start Draft Run',exact:true}).click();
 await page.locator('.run-cards').waitFor();assert.deepEqual(selected,['hob','msh']);
 assert.equal(await page.locator('[data-reroll="set"]').count(),0);
 assert.ok(await page.locator('[data-reroll="pack"]').isVisible());
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
 console.log('Practice access and custom corpus mobile flow passed.');
}finally{await browser.close();}
