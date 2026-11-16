// Actual admin campaign module; synthetic API state, no production requests.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const root=process.cwd();
const server=http.createServer(async(req,res)=>{
 if(req.url==='/fixture'){
  res.setHeader('content-type','text/html');res.end(`<!doctype html><html lang="en"><body><main id="root"></main><script type="module">
   import {renderResultsEmailCampaigns} from '/admin/results-email-campaigns.mjs';
   window.calls=[];window.state={ready:true,active:false,verified:false,campaigns:[]};
   const request=async(path,payload,method)=>{window.calls.push({path,payload,method});
    if(payload?.action==='draft')window.state.campaigns.unshift({id:'11111111-1111-4111-8111-111111111111',kind:'news',state:'draft',subject:payload.subject,body:payload.body,previewHash:'fixture-preview'});
    if(payload?.action==='check'){window.state.active=true;window.state.verified=true;}
    if(payload?.action==='approve')window.state.campaigns[0].state='approved';
    if(payload?.action==='cancel')window.state.campaigns[0].state='cancelled';
    return structuredClone(window.state);};
   window.render=owner=>renderResultsEmailCampaigns(document.querySelector('#root'),{owner,growthRequest:request});
   await window.render(true);window.ready=true;
  </script></body></html>`);return;
 }
 try{const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('content-type','text/javascript');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');await page.waitForFunction(()=>window.ready);
 await page.locator('input[name="subject"]').fill('Synthetic update');await page.locator('textarea[name="body"]').fill('<img src=x onerror="window.exploited=true">\n\nA synthetic message.');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 const approve=page.getByRole('button',{name:'Send this campaign to opted-in accounts',exact:true});await approve.waitFor();assert.equal(await approve.isDisabled(),true);
 assert.equal(await page.evaluate(()=>window.exploited),undefined);assert.equal(await page.locator('article img').count(),0);
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.payload?.action==='approve').length),0,'saving a draft never sends it');
 await page.getByRole('button',{name:'Send me a test email',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-approve]').disabled);
 await approve.click();await page.waitForFunction(()=>window.state.campaigns[0].state==='approved');await page.getByRole('button',{name:'Cancel campaign',exact:true}).click();await page.waitForFunction(()=>window.state.campaigns[0].state==='cancelled');
 const calls=await page.evaluate(()=>window.calls);assert.ok(calls.every(c=>c.path==='/v1/admin/results-campaigns'));
 assert.deepEqual(calls.find(c=>c.payload?.action==='approve').payload,{action:'approve',id:'11111111-1111-4111-8111-111111111111',previewHash:'fixture-preview'});
 await page.evaluate(async()=>{document.querySelector('#root').replaceChildren();await window.render(false);});assert.equal(await page.locator('form').count(),0);assert.deepEqual(errors,[]);
 console.log('PASS Chromium: owner-only campaign drafts, escaped preview, verified send gate, exact approval, cancellation, and independent email controls.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
