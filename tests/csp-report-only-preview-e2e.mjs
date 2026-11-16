// Real browser validation against an allowlisted local site served with a
// Content-Security-Policy-Report-Only HTTP response header. Never calls
// production APIs, identity providers, or live advertising.
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

const base='http://127.0.0.1:4175';
const pagePaths=[
  '/', '/practice/', '/admin/', '/learn/', '/sets/fra/guide/',
  '/privacy/', '/terms/', '/mobile-membership-complete/'
];
const linkedPaths=[
  '/open/profile/','/open/daily/','/open/shared/','/share/daily/latest/',
  '/creator/lordsoflimited/','/go/reddit/'
];

for(const path of linkedPaths){
  const res=await fetch(base+path,{signal:AbortSignal.timeout(10000)});
  assert.equal(res.status,200,'CSP preview deep-link missing: '+path);
  assert.match(res.headers.get('content-security-policy-report-only')||'',/report-uri \/__csp-report/,
    'Deep-link must carry real HTTP Report-Only header: '+path);
  await res.body?.cancel();
}

const counts={};
for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch({headless:true});
  let pages=0,violationCount=0;
  try{
    const context=await browser.newContext({serviceWorkers:'block'});
    await context.route('**/*',route=>{
      if(route.request().url().startsWith(base+'/'))return route.continue();
      // Even if app JS tries external auth, ads or Neon, test never calls them.
      return route.abort('blockedbyclient');
    });
    await context.addInitScript(()=>{
      window.__cspPreviewEvents=[];
      window.addEventListener('securitypolicyviolation',event=>{
        window.__cspPreviewEvents.push({
          directive:event.effectiveDirective,
          // Do not store URLs from browser violations; the HTTP reporter
          // records only sanitized origins, not query strings or user IDs.
          blocked:event.blockedURI==='inline'?'inline':'other'
        });
      });
    });
    for(const path of pagePaths){
      const page=await context.newPage(),missing=[];
      page.on('response',response=>{
        if(response.url().startsWith(base+'/')&&response.status()>=400 &&
          ['script','stylesheet','image','font'].includes(response.request().resourceType())){
          missing.push(response.status()+' '+new URL(response.url()).pathname);
        }
      });
      const response=await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:25000});
      assert.equal(response?.status(),200,name+' failed navigation: '+path);
      const header=response.headers()['content-security-policy-report-only']||'';
      assert.match(header,/script-src 'self'/,'Real HTTP CSP Report-Only header absent: '+path);
      assert.match(header,/report-uri \/__csp-report/);
      assert.equal(response.headers()['content-security-policy'],undefined,
        'Preview must not set an enforced HTTP CSP header');
      await page.waitForTimeout(400);
      assert.equal(missing.length,0,name+' missing same-origin assets on '+path+': '+missing.join(', '));
      assert.ok((await page.title()).trim().length>0,name+' missing page title: '+path);
      const found=await page.evaluate(()=>window.__cspPreviewEvents||[]);
      violationCount+=found.length;
      pages++;
      await page.close();
    }
    await context.close();
  }finally{await browser.close();}
  counts[name]={pages,violationCount};
}
assert.ok(counts.chromium.violationCount>0,
  'A strict report-only script policy should report the inline homepage script');
const res=await fetch(base+'/__csp-summary');
assert.equal(res.status,200);
const summary=await res.json();
assert.ok(Array.isArray(summary.aggregate),'Report-only HTTP endpoint did not return aggregated telemetry');
assert.ok(summary.total>=1,'Browser did not send a report to the local HTTP-only collector');
const summaryText=JSON.stringify(summary);
assert.ok(!summaryText.includes('document-uri')&&!summaryText.includes('blocked-uri')&&
  !summaryText.includes('original-policy'),'Summary must never return raw CSP reports');
console.log('CSP Report-Only preview browser checks: '+JSON.stringify({counts,aggregate:summary.aggregate.slice(0,25),total:summary.total}));
