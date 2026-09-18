import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
let complete=false,fail=false,starts=0,held=null,holdNext=false;
const profile=()=>({player:{display_name:'QA Today',claimed:false},summary:{games:2,current_streak:1},achievements:[],daily_history:complete?[{date:'2026-09-14',mode:'draft_run',set_id:'mixed',score:90,rank:1,total:4}]:[]});
await page.addInitScript(()=>{
 const OriginalDate=Date;window.__todayNow=OriginalDate.parse('2026-09-14T16:00:00Z');
 window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[window.__todayNow]));}static now(){return window.__todayNow;}};
});
await page.route('**/*.neon.tech/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/v1/runs')starts++;
 let body={ok:true};
 if(path==='/v1/session')body={token:'today-test'};
 if(path==='/v1/profile/me'){
   body=profile();
   if(holdNext){holdNext=false;await new Promise(resolve=>held=resolve);}
   if(fail)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Unavailable'})});
 }
 await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
});
async function progress(expected){await page.waitForFunction(text=>document.querySelector('[data-daily-home]')?.dataset.completed===text,expected);}
try{
 await page.goto(process.env.PACK1_E2E_URL||'http://127.0.0.1:4173');await progress('0');
 complete=true;await page.evaluate(()=>document.dispatchEvent(new CustomEvent('pack1:result-completed')));await progress('1');
 // A slow older profile response must not undo a newer completed-result refresh.
 complete=false;holdNext=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 for(let tries=0;!held&&tries<500;tries++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.ok(held,'The older profile request should be held');
 complete=true;await page.evaluate(()=>document.dispatchEvent(new CustomEvent('pack1:result-completed')));await progress('1');
 held();await page.waitForTimeout(100);await progress('1');
 await page.evaluate(()=>{window.__todayNow=Date.parse('2026-09-15T04:00:00Z');window.dispatchEvent(new Event('focus'));});await progress('0');
 assert.equal(await page.locator('.daily-home time').getAttribute('datetime'),'2026-09-15');
 fail=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('Daily progress is unavailable.',{exact:false}).waitFor();
 assert.equal(starts,0,'Reading Today must never reserve a ranked Daily');
 console.log('Daily home refresh passed: completion, stale response, Eastern rollover, unavailable status and no Daily reservation.');
}finally{await browser.close();}
