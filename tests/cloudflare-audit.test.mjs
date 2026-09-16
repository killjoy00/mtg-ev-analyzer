import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditCloudflare} from '../scripts/audit-cloudflare.mjs';
const token='fake-cloudflare-audit-token',zoneId='a'.repeat(32);
const zone={id:zoneId,name:'packone.pro',status:'active',type:'full',paused:false,account:{id:'private-account'},owner:{email:'private@example.test'}};
const ok=(result,extra={})=>Response.json({success:true,result,...extra});

test('Cloudflare audit is read-only, paginated and excludes credentials and raw DNS details',async()=>{
  const calls=[];
  const report=await auditCloudflare({token,fetcher:async(url,options)=>{
    calls.push(String(url));assert.equal(url.origin,'https://api.cloudflare.com');
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    assert.equal(options.headers.authorization,`Bearer ${token}`);assert.equal(options.body,undefined);
    if(url.pathname.endsWith('/zones'))return ok([zone]);
    if(url.pathname.endsWith('/workers/routes'))return ok([{pattern:'packone.pro/api/*',script:'private-script',id:'private-route'}]);
    assert.equal(url.pathname,`/client/v4/zones/${zoneId}/dns_records`);
    const type=url.searchParams.get('type'),page=Number(url.searchParams.get('page'));
    assert.ok(['A','AAAA','CNAME'].includes(type));
    if(type==='CNAME')return ok([{name:page===1?'www.packone.pro':'api.packone.pro',type,content:page===1?'killjoy00.github.io':'example.neon.tech',proxied:true,proxiable:true}],{result_info:{total_pages:2}});
    if(type==='A')return ok([{name:'packone.pro',type,content:'192.0.2.1',proxied:false,proxiable:true,comment:token},{name:'internal.packone.pro',type,content:'192.0.2.2'}],{result_info:{total_pages:1}});
    return ok([],{result_info:{total_pages:0}});
  }});
  assert.equal(calls.length,6);
  assert.deepEqual(report.dns.map(r=>r.name),['api.packone.pro','packone.pro','www.packone.pro']);
  assert.equal(report.dns[0].target_kind,'neon');
  assert.equal(report.dns[2].target_kind,'github-pages');
  assert.deepEqual(report.worker_routes,[{pattern:'packone.pro/api/*',worker_attached:true}]);
  for(const hidden of [token,zoneId,'192.0.2.','internal.packone.pro','private-account','private-script','private-route','private@example.test'])assert.ok(!JSON.stringify(report).includes(hidden),hidden);
});

test('Cloudflare audit fails closed without echoing token-bearing API errors',async()=>{
  await assert.rejects(auditCloudflare({fetcher:()=>{throw Error('must not call');}}),/repository Actions secret/);
  for(const fetcher of [async()=>new Response(token,{status:403}),async()=>Response.json({success:false,errors:[{message:token}]}),async()=>{throw Error(token);}]) {
    await assert.rejects(auditCloudflare({token,fetcher}),error=>!error.message.includes(token)&&/Cloudflare read/.test(error.message));
  }
  await assert.rejects(auditCloudflare({token,fetcher:async()=>ok([])}),/exactly one/);
  await assert.rejects(auditCloudflare({token,fetcher:async()=>ok([{...zone,id:'../../other'}])}),/exactly one/);
  await assert.rejects(auditCloudflare({token,fetcher:async url=>url.pathname.endsWith('/zones')?ok([zone]):ok([],{result_info:{total_pages:21}})}),/pagination/);
});

test('the Cloudflare reader accepts manual runs or a narrowly scoped main-branch request',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/cloudflare-audit.yml',import.meta.url),'utf8');
  assert.equal(workflow.match(/^on:\n([\s\S]*?)\npermissions:/m)?.[1],
    "  workflow_dispatch:\n  push:\n    branches: [main]\n    paths:\n      - '.github/cloudflare-audit-request.txt'\n");
  assert.match(workflow,/github.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/contents: read/);
  assert.doesNotMatch(workflow,/pull_request|schedule:|contents: write|NEON_API_KEY|CLOUDFLARE_API_KEY/);
  assert.equal((workflow.match(/secrets\.CLOUDFLARE_AUDIT_TOKEN/g)||[]).length,1);
});
