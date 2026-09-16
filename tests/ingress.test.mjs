import test from 'node:test';
import assert from 'node:assert/strict';
import {guardIngress} from '../worker/ingress-auth.mjs';
import legacy from '../worker/index.js';
import growth from '../worker/growth-function.js';
import draft from '../worker/draft-run-function.mjs';
import {gateway,ipNetwork} from '../edge/gateway.mjs';
import {parseRequest,checkBranch} from '../scripts/edge-control.mjs';
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
