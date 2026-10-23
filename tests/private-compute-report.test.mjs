import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {privateStore,reportWindows,branchInventory,runPrivateReport,publicFailureCode} from '../scripts/private-compute-report.mjs';
import {PROJECT} from '../scripts/neon-compute-history.mjs';
const now=Date.parse('2026-10-23T19:40:00Z'),sha='a'.repeat(40);
function fixture({publicBucket=false,customDomains=[],hangUpload=false,corrupt=false,denied=false}={}) {
 const calls=[],objects=new Map();
 const fetcher=async(url,options={})=>{
   const u=new URL(url);calls.push({url:u,method:options.method,body:options.body,authorization:options.headers?.authorization});
   if(u.hostname==='api.cloudflare.com') {
     assert.equal(options.headers.authorization,'Bearer private-storage-key');
     if(u.pathname.endsWith('/domains/managed'))return Response.json({success:true,result:{enabled:publicBucket}});
     if(u.pathname.endsWith('/domains/custom'))return Response.json({success:true,result:{domains:customDomains}});
     if(options.method==='PUT'){objects.set(u.pathname,options.body);if(hangUpload)throw Error('lost acknowledgement');return Response.json({success:true});}
     return objects.has(u.pathname)?new Response(corrupt?'corrupt':objects.get(u.pathname)):new Response('',{status:404});
   }
   assert.equal(u.hostname,'console.neon.tech');assert.equal(options.method,'GET');assert.equal(options.headers.authorization,'Bearer private-neon-key');
   if(u.pathname.endsWith('/projects/'+PROJECT))return Response.json({project:{id:PROJECT,org_id:'fixture-org'}});
   if(u.pathname.endsWith('/projects/'+PROJECT+'/branches'))return Response.json({branches:[],pagination:{}});
   if(denied)return Response.json({}, {status:403});
   const kind=u.pathname.split('/').at(-1);
   const row={project_id:PROJECT,...(kind==='branches'?{branch_id:'br-orange-feather-ayps8kep'}:{}),periods:[{
     period_id:'fixture-period',period_plan:'launch',period_start:'2026-10-01T00:00:00Z',
     consumption:[{timeframe_start:u.searchParams.get('from'),timeframe_end:u.searchParams.get('to'),metrics:[{metric_name:'compute_unit_seconds',value:1234}]}]}]};
   return Response.json({[kind]:[row],pagination:{}});
 };
 return {fetcher,calls,objects};
}
test('collection bounds preserve completed UTC hours, retention and month boundaries',()=>{
 const windows=reportWindows(now);assert.equal(windows[0].from,'2026-10-01T00:00:00.000Z');assert.equal(windows[0].to,'2026-10-23T00:00:00.000Z');
 assert.equal(windows[1].to,'2026-10-23T19:00:00.000Z');assert.ok(Date.parse(windows[1].from)>now-168*3600000);
 assert.equal(reportWindows(Date.parse('2026-11-01T05:00:00Z')).length,1);
});
test('a public or custom-domain destination fails before any usage read or write',async()=>{
 for(const options of [{publicBucket:true},{customDomains:[{enabled:false,domain:'fixture'}]}]) {
   const f=fixture(options);
   await assert.rejects(runPrivateReport({neonKey:'private-neon-key',cloudflareToken:'private-storage-key',runId:'123',attempt:'1',sha,now,fetcher:f.fetcher}),/verification/);
   assert.ok(f.calls.every(c=>c.url.hostname==='api.cloudflare.com'&&c.method==='GET'));
 }
});
test('storage capability failures reveal only allowlisted HTTP categories',async()=>{
 try {await privateStore({token:'fixture',fetcher:async()=>new Response('private error',{status:403})}).verify();assert.fail('Expected rejection');}
 catch(error){assert.equal(publicFailureCode(error),'storage_read_http_403');}
 assert.equal(publicFailureCode({privateCode:'secret',message:'private'}),'collection_unavailable');
});
test('private report uses only Neon reads, one private write and verified readback, without credentials in output',async()=>{
 const f=fixture();const result=await runPrivateReport({neonKey:'private-neon-key',cloudflareToken:'private-storage-key',runId:'123',attempt:'1',sha,now,fetcher:f.fetcher});
 assert.equal(result.available,true);assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);
 const text=[...f.objects.values()][0];assert.doesNotMatch(text,/private-storage-key|private-neon-key|authorization/i);
 const report=JSON.parse(text);assert.equal(report.reports.length,2);assert.equal(report.raw_history_pages.length,4);
 assert.equal(report.reports[0].reconciliation.branches[0].owner,'production');
 assert.equal(f.calls.filter(c=>c.url.pathname.endsWith('/domains/managed')).length,2);
});
test('committed upload with lost acknowledgement is read back without a second PUT; corruption fails',async()=>{
 const f=fixture({hangUpload:true}),storage=privateStore({token:'private-storage-key',fetcher:f.fetcher});
 await storage.save('compute-history/123-1/report.json',{fixture:true});assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);
 const bad=fixture({corrupt:true});await assert.rejects(privateStore({token:'private-storage-key',fetcher:bad.fetcher}).save('compute-history/123-1/report.json',{}),/mismatch/);
 await assert.rejects(storage.save('../public.json',{}),/Unreviewed/);
});
test('history access denial saves private capability evidence and never becomes zero usage',async()=>{
 const f=fixture({denied:true});const result=await runPrivateReport({neonKey:'private-neon-key',cloudflareToken:'private-storage-key',runId:'123',attempt:'1',sha,now,fetcher:f.fetcher});
 assert.equal(result.available,false);const report=JSON.parse([...f.objects.values()][0]);
 assert.equal(report.reports[0].project.problems[0].http_status,403);assert.equal(report.reports[0].reconciliation.project_reported_cu_hours,null);
});
test('branch inventory follows every cursor and rejects repetition or conflicting identities',async()=>{
 let page=0;const row={id:'br-fixture',project_id:PROJECT,name:'fixture',created_at:'2026-10-01T00:00:00Z'};
 const fetcher=async()=>Response.json({branches:[row],pagination:++page===1?{next:'cursor'}:{}});
 assert.equal((await branchInventory({key:'fixture',fetcher})).length,1);assert.equal(page,2);
 await assert.rejects(branchInventory({key:'fixture',fetcher:async()=>Response.json({branches:[],pagination:{next:'loop'}})}),/Repeated/);
});
test('live collection has no PR secrets, schedule changes or public artifact upload',()=>{
 const workflow=fs.readFileSync(new URL('../.github/workflows/private-compute-history.yml',import.meta.url),'utf8');
 assert.doesNotMatch(workflow,/^\s+(?:pull_request|schedule):/m);assert.match(workflow,/github.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/environment: pack-one-mobile-release/);assert.doesNotMatch(workflow,/uses: actions\/upload-artifact|GITHUB_STEP_SUMMARY/);
 assert.match(workflow,/secrets\.CLOUDFLARE_PRIVATE_REPORT_TOKEN/);
 assert.doesNotMatch(workflow,/CLOUDFLARE_EDGE_TOKEN|CLOUDFLARE_AUDIT_TOKEN|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY/);
});
