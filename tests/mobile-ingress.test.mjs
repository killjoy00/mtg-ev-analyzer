import test from 'node:test';
import assert from 'node:assert/strict';
import {gateway} from '../edge/gateway.mjs';

const token='p1_123e4567-e89b-12d3-a456-426614174000.'+'A'.repeat(43);
const account='B'.repeat(43);
const env=()=>({
  MODE:'production',
  NEON_BRANCH_ID:'br-orange-feather-ayps8kep',
  QUOTA_KEY:'e'.repeat(64),
  NETWORK_QUOTA:{idFromName:name=>name,get:()=>({fetch:async()=>new Response(null,{status:204})})},
});
const headers=extra=>({'cf-connecting-ip':'192.0.2.44',...extra});

test('native guest bridge rejects malformed tokens before upstream',async()=>{
  const request=new Request('https://api.packone.pro/draft/v1/runs',{method:'POST',headers:headers({'content-type':'application/json','x-pack1-mobile-session':'bad'}),body:'{}'});
  const response=await gateway(request,env(),async()=>{throw Error('must not reach upstream')});
  assert.equal(response.status,401);
});

test('native guest bridge cannot reach account routes',async()=>{
  const request=new Request('https://api.packone.pro/growth/v1/account/session',{headers:headers({'x-pack1-mobile-session':token})});
  const response=await gateway(request,env(),async()=>{throw Error('must not reach upstream')});
  assert.equal(response.status,403);
});

test('native guest bridge maps signed player token only on Draft Run player routes',async()=>{
  let authorization=null;
  const request=new Request('https://api.packone.pro/draft/v1/runs',{method:'POST',headers:headers({'content-type':'application/json','x-pack1-mobile-session':token}),body:'{}'});
  const response=await gateway(request,env(),async(_url,options)=>{
    authorization=new Headers(options.headers).get('authorization');
    return Response.json({ok:true});
  });
  assert.equal(response.status,200);
  assert.equal(authorization,'Bearer '+token);
});


test('native account bridge requires shaped account tokens and exact mobile routes',async()=>{
  const noFetch=async()=>{throw Error('must not reach upstream')};
  const malformed=new Request('https://api.packone.pro/draft/v1/runs',{
    method:'POST',
    headers:headers({'content-type':'application/json','x-pack1-mobile-session':token,'x-pack1-mobile-account':'bad'}),
    body:'{}',
  });
  assert.equal((await gateway(malformed,env(),noFetch)).status,401);

  const browserRoute=new Request('https://api.packone.pro/growth/v1/account/session',{
    headers:headers({'x-pack1-mobile-session':token,'x-pack1-mobile-account':account}),
  });
  assert.equal((await gateway(browserRoute,env(),noFetch)).status,403);

  let forwarded=null;
  const mobileRoute=new Request('https://api.packone.pro/growth/v1/mobile/account/session',{
    headers:headers({'x-pack1-mobile-session':token,'x-pack1-mobile-account':account}),
  });
  const response=await gateway(mobileRoute,env(),async(url,options)=>{
    forwarded={url,authorization:new Headers(options.headers).get('authorization'),account:new Headers(options.headers).get('x-pack1-mobile-account')};
    return Response.json({ok:true});
  });
  assert.equal(response.status,200);
  assert.match(forwarded.url,/pack1growth.*\/v1\/mobile\/account\/session$/);
  assert.equal(forwarded.authorization,'Bearer '+token);
  assert.equal(forwarded.account,account);
});

test('native player surfaces are limited to linked mobile profile aliases',async()=>{
  let forwarded=null;
  const mobileProfile=new Request('https://api.packone.pro/growth/v1/mobile/profile/me',{
    headers:headers({'x-pack1-mobile-session':token,'x-pack1-mobile-account':account}),
  });
  const response=await gateway(mobileProfile,env(),async(url,options)=>{
    forwarded={
      url,
      authorization:new Headers(options.headers).get('authorization'),
      account:new Headers(options.headers).get('x-pack1-mobile-account'),
    };
    return Response.json({ok:true});
  });
  assert.equal(response.status,200);
  assert.match(forwarded.url,/pack1growth.*\/v1\/mobile\/profile\/me$/);
  assert.equal(forwarded.authorization,'Bearer '+token);
  assert.equal(forwarded.account,account);

  const browserProfile=new Request('https://api.packone.pro/growth/v1/profile/me',{
    headers:headers({'x-pack1-mobile-session':token,'x-pack1-mobile-account':account}),
  });
  const blocked=await gateway(browserProfile,env(),async()=>{throw Error('must not reach upstream')});
  assert.equal(blocked.status,403);
});

test('native Google callback only permits the Pack One account deep link',async()=>{
  const callback=new Request('https://api.packone.pro/growth/v1/mobile/account/google/callback?flow='+'f'.repeat(43),{
    headers:headers({}),
  });
  const accepted=await gateway(callback,env(),async()=>new Response(null,{
    status:302,
    headers:{location:'packone://account?googleHandoff='+'h'.repeat(43)},
  }));
  assert.equal(accepted.status,302);
  assert.equal(accepted.headers.get('location'),'packone://account?googleHandoff='+'h'.repeat(43));

  const rejected=await gateway(callback,env(),async()=>new Response(null,{
    status:302,
    headers:{location:'packone://evil?googleHandoff='+'h'.repeat(43)},
  }));
  assert.equal(rejected.status,502);
  assert.equal(rejected.headers.get('location'),null);
});
