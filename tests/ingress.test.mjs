import test from 'node:test';
import assert from 'node:assert/strict';
import {guardIngress} from '../worker/ingress-auth.mjs';
import legacy from '../worker/index.js';
import growth from '../worker/growth-function.js';
import draft from '../worker/draft-run-function.mjs';
import {gateway,ipNetwork} from '../edge/gateway.mjs';
import {parseRequest,checkBranch,inheritedFunctionSlugs,commandFailure} from '../scripts/edge-control.mjs';
import {closedOrigin} from '../edge/closed-origin.mjs';
import {freshDeployment,deployPreviewFunction} from '../scripts/edge-neon-deploy.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const key='a'.repeat(64);
const env={MODE:'preview',NEON_BRANCH_ID:'br-isolated-preview',ORIGIN_SECRET:key,PREVIEW_KEY:'b'.repeat(64),QUOTA_KEY:'c'.repeat(64),
  NETWORK_QUOTA:{idFromName(name){assert.match(name,/^[a-f0-9]{64}$/);return name;},get(){return {fetch:async()=>new Response(null,{status:204})};}}};
const req=(path='/growth/v1/session',options={})=>new Request('https://api-preview.packone.pro'+path,{method:'POST',body:'{}',...options,headers:{'content-type':'application/json','x-pack1-preview-key':env.PREVIEW_KEY,'cf-connecting-ip':'192.0.2.1',...options.headers}});

test('all three real handlers block direct URLs before health, preflight or database work',async()=>{
  const prior={required:process.env.PACK1_REQUIRE_INGRESS,secret:process.env.PACK1_INGRESS_SECRET};
  try {
    process.env.PACK1_REQUIRE_INGRESS='1';process.env.PACK1_INGRESS_SECRET=key;
    for(const service of [legacy,growth,draft]) {
      for(const path of ['/health?quick=1','/v1/trophy-import','/v1/admin/report','/v1/session']) {
        for(const method of ['GET','OPTIONS'])assert.equal((await service.fetch(new Request('https://origin.test'+path,{method,headers:{'cf-connecting-ip':'127.0.0.1','x-forwarded-for':'127.0.0.1','x-pack1-ingress-secret':'wrong'}}))).status,403);
      }
      assert.equal((await service.fetch(new Request('https://origin.test/health?quick=1',{headers:{'x-pack1-ingress-secret':key}}))).status,200);
    }
  } finally {
    for(const [name,value] of [['PACK1_REQUIRE_INGRESS',prior.required],['PACK1_INGRESS_SECRET',prior.secret]])if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
  assert.equal(guardIngress(req(),{}),null);
  for(const config of [{PACK1_REQUIRE_INGRESS:'0'},{PACK1_REQUIRE_INGRESS:'1'},{PACK1_INGRESS_SECRET:key}])assert.equal(guardIngress(req(),config).status,503);
});

test('gateway constructs a fixed upstream and strips caller-controlled infrastructure headers',async()=>{
  let calls=0;
  const result=await gateway(req('/growth/v1/session',{headers:{'x-pack1-ingress-secret':'forged','x-forwarded-for':'forged','cookie':'secret','authorization':'Bearer player','origin':'https://packone.pro'}}),env,async(url,options)=>{
    calls++;assert.equal(url,'https://br-isolated-preview-pack1growth.compute.c-5.us-east-2.aws.neon.tech/v1/session');
    assert.equal(options.redirect,'manual');assert.equal(options.headers.get('x-pack1-ingress-secret'),key);
    assert.equal(options.headers.get('authorization'),'Bearer player');
    for(const h of ['cookie','x-forwarded-for','cf-connecting-ip','x-pack1-preview-key'])assert.equal(options.headers.get(h),null);
    assert.equal(options.body,'{}');
    return Response.json({ok:true},{headers:{'set-cookie':'upstream=bad','x-pack1-ingress-secret':key}});
  });
  assert.equal(calls,1);assert.equal(result.status,200);assert.equal(result.headers.get('set-cookie'),null);
  assert.equal(result.headers.get('x-pack1-ingress-secret'),null);assert.equal(result.headers.get('cache-control'),'no-store');
  assert.equal(result.headers.get('access-control-allow-origin'),'https://packone.pro');
});

test('production gateway turns Pack One cookies into upstream identity and relays only Pack One cookies',async()=>{
  const prod={MODE:'production',NEON_BRANCH_ID:'br-orange-feather-ayps8kep',QUOTA_KEY:'d'.repeat(64),
    NETWORK_QUOTA:{idFromName:name=>name,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
  const player='p1_00000000-0000-4000-8000-000000000000.'+'x'.repeat(43);
  const account='a'.repeat(43),csrf='b'.repeat(43);
  const request=new Request('https://api.packone.pro/growth/v1/account/link-browser',{
    method:'POST',body:'{}',headers:{
      'content-type':'application/json','cf-connecting-ip':'192.0.2.2','origin':'https://packone.pro',
      cookie:`noise=drop; __Host-pack1_player=${player}; __Host-pack1_account=${account}; __Secure-pack1_csrf=${csrf}`,
      'x-pack1-csrf':csrf,'authorization':'Bearer caller-must-not-win',
    },
  });
  const result=await gateway(request,prod,async(url,options)=>{
    assert.equal(url,'https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech/v1/account/link-browser');
    assert.equal(options.headers.get('authorization'),'Bearer '+player);
    assert.equal(options.headers.get('x-pack1-csrf'),csrf);
    assert.doesNotMatch(options.headers.get('cookie'),/noise/);
    assert.match(options.headers.get('cookie'),/__Host-pack1_account=/);
    const headers=new Headers();
    headers.append('set-cookie','__Host-pack1_account='+'c'.repeat(43)+'; Path=/; Secure; HttpOnly; SameSite=Strict');
    headers.append('set-cookie','unrelated=bad; Path=/');
    headers.set('location','https://packone.pro/?auth=google');
    return new Response(null,{status:302,headers});
  });
  assert.equal(result.status,302);
  assert.equal(result.headers.get('location'),'https://packone.pro/?auth=google');
  assert.equal(result.headers.get('access-control-allow-credentials'),'true');
  const set=result.headers.getSetCookie?.()||[result.headers.get('set-cookie')].filter(Boolean);
  assert.ok(set.some(row=>row.startsWith('__Host-pack1_account=')));
  assert.ok(!set.some(row=>row.startsWith('unrelated=')));
  const badBranch=await gateway(new Request('https://api.packone.pro/growth/v1/account/session',{headers:{'cf-connecting-ip':'192.0.2.2'}}),{...prod,NEON_BRANCH_ID:'br-twilight-hill-ayffyd2b'},()=>{throw Error('no');});
  assert.equal(badBranch.status,503);
});


test('production gateway accepts a shaped mobile guest session only on Draft Run player routes',async()=>{
  const prod={MODE:'production',NEON_BRANCH_ID:'br-orange-feather-ayps8kep',QUOTA_KEY:'e'.repeat(64),
    NETWORK_QUOTA:{idFromName:name=>name,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
  const token='p1_00000000-0000-4000-8000-000000000000.'+'x'.repeat(43);
  let calls=0;
  const request=new Request('https://api.packone.pro/draft/v1/runs',{
    method:'POST',body:JSON.stringify({daily:true}),headers:{
      'content-type':'application/json','cf-connecting-ip':'192.0.2.44','x-pack1-mobile-session':token,
    },
  });
  const result=await gateway(request,prod,async(url,options)=>{
    calls++;
    assert.equal(url,'https://br-orange-feather-ayps8kep-draftrunapi.compute.c-5.us-east-2.aws.neon.tech/v1/runs');
    assert.equal(options.headers.get('authorization'),'Bearer '+token);
    assert.equal(options.headers.get('x-pack1-mobile-session'),null);
    return Response.json({ok:true});
  });
  assert.equal(result.status,200);assert.equal(calls,1);

  const noFetch=()=>{throw Error('Must not forward');};
  const invalid=new Request('https://api.packone.pro/draft/v1/runs',{method:'POST',body:'{}',headers:{
    'content-type':'application/json','cf-connecting-ip':'192.0.2.45','x-pack1-mobile-session':'not-a-session',
  }});
  assert.equal((await gateway(invalid,prod,noFetch)).status,401);
  const account=new Request('https://api.packone.pro/growth/v1/account/session',{headers:{
    'cf-connecting-ip':'192.0.2.46','x-pack1-mobile-session':token,
  }});
  assert.equal((await gateway(account,prod,noFetch)).status,403);
});

test('gateway rejects disallowed paths, origins, hosts, missing identity and partial config without forwarding',async()=>{
  const noFetch=()=>{throw Error('Must not forward');};
  for(const path of ['/draft/v1/trophy-import','/draft/v1/admin/report','/draft/health','/growth/https://other.test','/growth/v1/%73ession'])
    assert.equal((await gateway(req(path),env,noFetch)).status,404);
  assert.equal((await gateway(req('/growth/v1/session',{headers:{origin:'https://evil.test'}}),env,noFetch)).status,403);
  assert.equal((await gateway(req('/growth/v1/session',{headers:{'x-pack1-preview-key':'wrong'}}),env,noFetch)).status,403);
  assert.equal((await gateway(req('/growth/v1/session',{headers:{'cf-connecting-ip':'','x-forwarded-for':'192.0.2.1'}}),env,noFetch)).status,503);
  assert.equal((await gateway(req(),{...env,ORIGIN_SECRET:''},noFetch)).status,503);
  assert.equal((await gateway(req(),{...env,NEON_BRANCH_ID:'br-orange-feather-ayps8kep'},noFetch)).status,503);
  assert.equal((await gateway(new Request('https://other.test/growth/v1/session'),env,noFetch)).status,404);
  const redir=await gateway(req(),env,async()=>new Response(null,{status:302,headers:{location:'https://evil.test'}}));
  assert.equal(redir.status,502);assert.equal(redir.headers.get('location'),null);
});

test('quota failure, oversized bodies and invalid preflights fail before upstream',async()=>{
  const noFetch=()=>{throw Error('Must not forward');};
  const blocked={...env,NETWORK_QUOTA:{idFromName:x=>x,get:()=>({fetch:async()=>Response.json({error:'Too many requests.'},{status:429,headers:{'retry-after':'60'}})})}};
  const r=await gateway(req(),blocked,noFetch);assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');
  assert.equal((await gateway(req('/growth/v1/session',{body:'x'.repeat(131073)}),env,noFetch)).status,413);
  for(const [headers,status] of [[{'origin':'https://packone.pro','access-control-request-method':'POST','access-control-request-headers':'content-type,x-pack1-preview-key'},204],
    [{'origin':'https://packone.pro','access-control-request-method':'POST','access-control-request-headers':'content-type,x-pack1-mobile-session,x-pack1-preview-key'},204],
    [{'origin':'https://packone.pro','access-control-request-method':'POST','access-control-request-headers':'x-pack1-ingress-secret'},403]])
    assert.equal((await gateway(req('/growth/v1/session',{method:'OPTIONS',body:undefined,headers}),env,noFetch)).status,status);
});

test('IPv6 privacy addresses share a /64 quota without merging distinct networks',()=>{
  assert.equal(ipNetwork('2001:db8:1:2::1'),ipNetwork('2001:0db8:0001:0002:1234::9'));
  assert.notEqual(ipNetwork('2001:db8:1:2::1'),ipNetwork('2001:db8:1:3::1'));
  assert.equal(ipNetwork('192.0.2.1'),'192.0.2.1');assert.throws(()=>ipNetwork('forged,192.0.2.1'));
});

test('operations reject arbitrary commands and existing branch targets',()=>{
  for(const operation of ['check-access','deploy-preview','disable-preview'])assert.equal(parseRequest({operation,reason:'reviewed test'}),operation);
  for(const value of [{operation:'deploy-production',reason:'x'},{operation:'deploy-preview',reason:'x',command:'anything'},{operation:'deploy-preview',reason:''},null])assert.throws(()=>parseRequest(value));
  for(const branch of ['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b','main','../../production'])assert.throws(()=>checkBranch(branch));
  checkBranch('br-new-isolated-preview');
});

test('inherited function isolation requires a newly created isolated branch and valid complete inventory',()=>{
  const list=[{slug:'pack1api'},{slug:'historical-helper'}];
  assert.deepEqual(inheritedFunctionSlugs(list,'br-new-preview','true'),['pack1api','historical-helper']);
  assert.deepEqual(inheritedFunctionSlugs({functions:[]},'br-new-preview','true'),[]);
  for(const branch of ['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b'])assert.throws(()=>inheritedFunctionSlugs(list,branch,'true'));
  for(const created of ['false',undefined,true])assert.throws(()=>inheritedFunctionSlugs(list,'br-new-preview',created));
  for(const invalid of [null,{},[{slug:'--help'}],[{slug:'../other'}],[{slug:'same'},{slug:'same'}]])assert.throws(()=>inheritedFunctionSlugs(invalid,'br-new-preview','true'));
});

test('closed inherited endpoints deny every method and credential without running historical code',async()=>{
  const commit='a'.repeat(40),handler=closedOrigin(commit);
  assert.throws(()=>closedOrigin('invalid'));
  for(const method of ['GET','POST','OPTIONS','DELETE']) {
    const response=handler.fetch(new Request('https://example.test/admin',{method,headers:{authorization:'Bearer forged','x-pack1-ingress-secret':'a'.repeat(64)}}));
    assert.equal(response.status,403);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal((await response.json()).release_commit,commit);
  }
});

test('command diagnostics reveal only fixed stages, categories and numeric statuses',()=>{
  const secret='credential-that-must-never-be-logged';
  const message=commandFailure('neon',['functions','list'],{status:1,stderr:`Request failed with status code 403 Authorization: Bearer ${secret}\n::error::injected`});
  assert.match(message,/functions list; exit 1/);assert.match(message,/HTTP 403/);
  assert.ok(!message.includes(secret));assert.ok(!message.includes('::error::'));assert.ok(!message.includes('\n'));
  assert.match(commandFailure('wrangler',['secret','bulk'],{status:1,stderr:'Unknown argument '+secret}),/secret installation; exit 1; category unsupported argument/);
  assert.match(commandFailure('neon',['functions','deploy'],{stderr:secret}),/unclassified/);
});

test('deployment readiness accepts a fresh child version 1 and rejects inherited or failed versions',()=>{
  const now=Date.now();
  const fn=(id,time,status='completed')=>({current_deployment:{id,created_at:new Date(time).toISOString(),status},active_deployment:{id}});
  assert.equal(freshDeployment(fn(1,now),now),true);
  assert.equal(freshDeployment(fn(62,now-86400000),now),false);
  assert.equal(freshDeployment(fn(1,now,'building'),now),false);
  assert.throws(()=>freshDeployment(fn(1,now,'failed'),now));
  assert.equal(freshDeployment({current_deployment:{id:1,status:'completed',created_at:'invalid'}},now),false);
});

test('direct deployment uploads a source ZIP once and verifies fresh metadata without exposing errors',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'edge-deploy-'));
  try {
    fs.writeFileSync(path.join(directory,'index.mjs'),'export default {fetch(){return new Response("closed",{status:403})}};');
    const requests=[];
    await deployPreviewFunction({branch:'br-new-preview',slug:'closed',directory,apiKey:'test-credential',fetcher:async(url,options)=>{
      requests.push({url,method:options.method||'GET'});
      if(options.method==='POST') {
        assert.equal(options.headers.authorization,'Bearer test-credential');
        const bytes=new Uint8Array(await options.body.get('zip').arrayBuffer());assert.deepEqual([...bytes.slice(0,2)],[80,75]);
        assert.equal(options.body.get('runtime'),'nodejs24');return new Response('{}',{status:201});
      }
      return Response.json({function:{current_deployment:{id:1,created_at:new Date().toISOString(),status:'completed'},active_deployment:{id:1}}});
    }});
    assert.deepEqual(requests.map(r=>r.method),['POST','GET']);
    let attempts=0;
    await assert.rejects(deployPreviewFunction({branch:'br-new-preview',slug:'closed',directory,apiKey:'secret',fetcher:async()=>{attempts++;return new Response('secret provider body',{status:403});}}),/^Error: Neon control deployment HTTP 403\.$/);
    assert.equal(attempts,1);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
