// Actual web preference modules in Chromium, with local synthetic API fixtures.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const root=process.cwd(),a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
let account=a,active=true,presentation='prompt',state='unanswered',exclude=false,held=null,holdNext=false;
const edits=[];
const server=http.createServer(async(req,res)=>{
 if(req.url==='/fixture'){
  res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><script>window.PACK1_API={firstParty:true,growthUrl:"https://api.results.invalid/growth"};</script></head><body><main><button id="play">Play now</button><aside data-results-ui data-results-invitation hidden></aside><section data-results-ui id="results-settings" hidden></section></main><script type="module">import {bindResultsInvitation,bindResultsSettings} from "/results-settings.mjs";window.bindInvitation=bindResultsInvitation;window.bindSettings=bindResultsSettings;window.ready=true;</script></body></html>');return;
 }
 try{const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep))throw Error();const bytes=await fs.readFile(file);res.setHeader('content-type',file.endsWith('.json')?'application/json':'text/javascript');res.end(bytes);}catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('**/growth/**',async route=>{
  const request=route.request(),url=new URL(request.url());let value={};
  if(url.pathname.endsWith('/account/session'))value={user:{id:account}};
  if(url.pathname.endsWith('/account/results')){
   const snapshot=()=>({active,emailState:state,excludePublications:exclude});
   if(request.method()==='PATCH'){
    const payload=request.postDataJSON();edits.push(payload);
    if(payload.action==='present'){value={presentation:active?presentation:null};presentation=null;}
    else{
     if(payload.action.endsWith(':on')&&!payload.action.startsWith('exclude:'))state='on';
     if(payload.action.endsWith(':off')||payload.action==='notice:dismiss')state='off';
     if(payload.action.startsWith('exclude:'))exclude=payload.action.endsWith(':on');
     value=snapshot();
     if(holdNext){holdNext=false;await new Promise(resolve=>{held=resolve;});}
    }
   }else value=snapshot();
  }
  await route.fulfill({json:value,headers:{'access-control-allow-origin':base,'access-control-allow-credentials':'true','access-control-allow-headers':'content-type,x-pack1-csrf','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'}});
 });
 const open=async()=>{await page.goto(base+'/fixture');await page.waitForFunction(()=>window.ready);};
 await open();await page.evaluate(()=>window.bindInvitation());
 assert.equal(await page.getByRole('heading',{name:'Get your results by email?'}).count(),1);
 const yes=page.getByRole('button',{name:'Yes, email me'}),no=page.getByRole('button',{name:'No thanks'});
 assert.equal(await yes.getAttribute('class'),await no.getAttribute('class'));assert.equal(await yes.getAttribute('aria-pressed'),null);
 assert.equal(await page.evaluate(()=>document.activeElement.tagName),'BODY');assert.equal(await page.locator('#play').isEnabled(),true);
 await no.click();await page.waitForFunction(()=>!document.querySelector('[data-results-invitation]').textContent);assert.equal(state,'off');
 await open();await page.evaluate(()=>window.bindInvitation());assert.equal(await page.getByRole('heading',{name:'Get your results by email?'}).count(),0);
 await page.evaluate(()=>window.bindSettings());await page.getByRole('button',{name:'On',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-results-action="settings:on"]').getAttribute('aria-pressed')==='true');assert.equal(state,'on');
 await page.getByRole('checkbox').check();await page.waitForFunction(()=>document.querySelector('#results-exclude').checked);assert.equal(exclude,true);
 // Existing players get only the notice, and the action stays on the page.
 presentation='notice';state='unanswered';await open();await page.evaluate(()=>window.bindInvitation());
 const url=page.url();await page.getByRole('button',{name:'Turn on emails'}).click();await page.waitForFunction(()=>!document.querySelector('[data-results-invitation]').textContent);assert.equal(state,'on');assert.equal(page.url(),url);
 presentation='notice';state='unanswered';await open();await page.evaluate(()=>window.bindInvitation());await page.getByRole('button',{name:'Dismiss',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-results-invitation]').textContent);assert.equal(state,'off');
 // A response belonging to the previous account cannot repaint the new account.
 await page.evaluate(()=>window.bindSettings());holdNext=true;await page.getByRole('button',{name:'On',exact:true}).click();
 await new Promise(resolve=>{const poll=()=>held?resolve():setTimeout(poll,10);poll();});
 account=b;await page.evaluate(()=>window.dispatchEvent(new Event('packone-account-changed')));held();held=null;
 await page.waitForTimeout(50);assert.equal(await page.locator('#results-settings').textContent(),'');
 active=false;await open();await page.evaluate(()=>Promise.all([window.bindInvitation(),window.bindSettings()]));assert.equal(await page.locator('#results-settings').isVisible(),false);assert.equal(await page.locator('[data-results-invitation]').isVisible(),false);
 assert.ok(edits.filter(e=>e.action!=='present').every(e=>e.expectedAccountId===a));
 console.log('PASS Chromium: exact prompt/notice copy, equal choices, saved settings, dismissal, one ask, account isolation and launch gate.');
}finally{if(held)held();await browser.close();await new Promise(resolve=>server.close(resolve));}
