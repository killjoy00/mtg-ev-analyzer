// Browser fixture for the launch status panel; never contacts a production API.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const root=process.cwd();
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture.invalid');
 if(url.pathname==='/fixture'){
  res.setHeader('content-type','text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
   <body><main id="target"></main><script type="module">
   import {renderSetLaunchStatus} from '/admin/set-launch-status.mjs';
   window.calls=[];
   const corpus={sets:[{set_id:'trk',set_name:'Star Trek',status:'Live',ready:true,health_current:true,
     archive_available:true,serving_count:480,manifest:{full_import:{}}}],
     serving_cache_current:true,readiness:{ready:true,current:true}};
   window.request=async url=>{
    window.calls.push(url);
    const selected=new URL(url,'http://fixture.invalid').searchParams.get('set');
    return {day:'2026-11-23',setId:selected,
     schedules:[{environment:'latest',picks:8,resolved:8,setPicks:selected==='trk'?8:0},
       {environment:'mixed',picks:8,resolved:8,setPicks:selected==='trk'?2:0},
       {environment:'powered-cube',picks:8,resolved:8,setPicks:0}]};
   };
   await renderSetLaunchStatus(document.querySelector('#target'),window.request,corpus);
   window.ready=true;
   </script></body></html>`);
  return;
 }
 try{
  const file=path.resolve(root,'.'+url.pathname);
  if(!file.startsWith(root+path.sep))throw Error();
  res.setHeader('content-type',file.endsWith('.json')?'application/json':'text/javascript');
  res.end(await fs.readFile(file));
 }catch{res.statusCode=404;res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');
 await page.waitForFunction(()=>window.ready);
 await page.locator('#launch-set-status').getByText('All eight pinned picks use this set').waitFor();
 assert.equal(await page.locator('#launch-set-choice').inputValue(),'trk','newest registered set is selected without owner intervention');
 assert.match(await page.locator('#launch-set-status').innerText(),/First public Daily[\s\S]*Ready/);
 assert.match(await page.locator('#launch-set-status').innerText(),/Powered Cube Daily/);
 await page.getByRole('button',{name:'Refresh'}).click();
 await page.locator('#launch-set-status').getByText('All eight pinned picks use this set').waitFor();
 await page.locator('#launch-set-choice').selectOption('fra');
 await page.locator('#launch-set-status').getByText('Other set pinned').waitFor();
 const calls=await page.evaluate(()=>window.calls);
 assert.ok(calls.every(url=>new URL(url,'http://fixture.invalid').pathname==='/v1/admin/corpus/launch-dailies'));
 assert.deepEqual(errors,[]);
 console.log('PASS Chromium: newest set detected, pinned Daily readiness, independent Cube, set switch and read-only requests.');
}finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
