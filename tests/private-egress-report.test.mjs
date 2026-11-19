import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runPrivateEgress} from '../scripts/private-egress-report.mjs';
import {PROJECT} from '../scripts/neon-egress-evidence.mjs';
test('scheduled evidence keeps counter comparisons privately without public artifacts or credential capture',async()=>{
 const objects=new Map(),calls=[];let transferred=1000;
 const fetcher=async(url,options={})=>{
   const u=new URL(url);calls.push({url,method:options.method??'GET'});
   if(u.hostname==='api.cloudflare.com'){
     if(u.pathname.endsWith('/domains/managed'))return Response.json({success:true,result:{enabled:false}});
     if(u.pathname.endsWith('/domains/custom'))return Response.json({success:true,result:{domains:[]}});
     if(options.method==='PUT'){objects.set(u.pathname,options.body);return Response.json({success:true});}
     return objects.has(u.pathname)?new Response(objects.get(u.pathname)):new Response('',{status:404});
   }
   assert.equal(options.method,undefined);assert.equal(options.body,undefined);
   return Response.json(u.pathname.endsWith('/projects/'+PROJECT)?{project:{id:PROJECT,org_id:'fixture-org',data_transfer_bytes:transferred,
     consumption_period_start:'2026-10-01T00:00:00Z',consumption_period_end:'2026-11-01T00:00:00Z'}}:{[u.pathname.split('/').at(-1)]:[]});
 };
 const context={neonKey:'private-neon',cloudflareToken:'private-cloudflare',runId:'123',attempt:'1',sha:'a'.repeat(40),fetcher};
 await runPrivateEgress({...context,now:Date.parse('2026-10-23T18:00:00Z')});
 transferred=1500;
 await runPrivateEgress({...context,attempt:'2',now:Date.parse('2026-10-23T19:00:00Z')});
 assert.equal(objects.size,3);
 const current=JSON.parse([...objects.entries()].find(([key])=>key.endsWith('/latest.json'))[1]);
 assert.equal(current.comparison.delta_bytes,500);assert.equal(current.comparison.actual_usage_verified,false);
 assert.doesNotMatch([...objects.values()].join(''),/private-neon|private-cloudflare/);
 assert.ok(calls.filter(c=>c.url.includes('neon.tech')).every(c=>c.method==='GET'));
});
test('scheduled output moves private while its schedule and alert routing remain unchanged',()=>{
 const workflow=fs.readFileSync(new URL('../.github/workflows/egress-recovery.yml',import.meta.url),'utf8');
 assert.match(workflow,/cron: '43 15 \* \* \*'/);
 assert.match(workflow,/github.ref == 'refs\/heads\/main' && github.event_name != 'pull_request'/);
 assert.match(workflow,/environment: pack-one-mobile-release/);
 assert.match(workflow,/secrets\.CLOUDFLARE_PRIVATE_REPORT_TOKEN/);
 assert.doesNotMatch(workflow,/CLOUDFLARE_EDGE_TOKEN|CLOUDFLARE_AUDIT_TOKEN|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY/);
 assert.match(workflow,/node scripts\/private-egress-report.mjs/);
 assert.doesNotMatch(workflow,/uses: actions\/(?:upload|download)-artifact|GITHUB_STEP_SUMMARY/);
 const legacy=fs.readFileSync(new URL('../scripts/neon-egress-evidence.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(legacy,/console\.log\(JSON\.stringify\(report/);
 assert.match(legacy,/mode:0o600,flag:'wx'/);
});
