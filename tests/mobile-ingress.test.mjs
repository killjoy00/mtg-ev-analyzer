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

test('native public profile aliases are readable without exposing browser profile routes',async()=>{
  const profileKey='0123456789abcdef';
  for(const accountHeader of [null,account]) {
    let forwarded=null;
    const request=new Request('https://api.packone.pro/growth/v1/mobile/profile/'+profileKey,{
      headers:headers({
        'x-pack1-mobile-session':token,
        ...(accountHeader?{'x-pack1-mobile-account':accountHeader}:{}),
      }),
    });
    const response=await gateway(request,env(),async(url,options)=>{
      forwarded={url,authorization:new Headers(options.headers).get('authorization')};
      return Response.json({player:{profile_key:profileKey}});
    });
    assert.equal(response.status,200);
    assert.ok(forwarded.url.endsWith('/v1/mobile/profile/'+profileKey));
    assert.equal(forwarded.authorization,'Bearer '+token);
  }

  const blocked=new Request('https://api.packone.pro/growth/v1/profile/'+profileKey,{
    headers:headers({'x-pack1-mobile-session':token}),
  });
  assert.equal((await gateway(blocked,env(),async()=>{throw Error('must not reach upstream')})).status,403);
});

test('native account parity routes stay inside the mobile bridge',async()=>{
  for(const path of [
    '/growth/v1/mobile/account/request-password-reset',
    '/growth/v1/mobile/account/send-verification-email',
    '/growth/v1/mobile/account/reset-password',
  ]) {
    let forwarded=null;
    const request=new Request('https://api.packone.pro'+path,{
      method:'POST',
      headers:headers({'content-type':'application/json','x-pack1-mobile-session':token}),
      body:JSON.stringify(path.endsWith('/reset-password')
        ? {token:'r'.repeat(32),newPassword:'new-password'}
        : {email:'qa@example.invalid'}),
    });
    const response=await gateway(request,env(),async(url,options)=>{
      forwarded={url,player:new Headers(options.headers).get('authorization')};
      return Response.json({ok:true});
    });
    assert.equal(response.status,200,path);
    assert.ok(forwarded.url.includes('/v1/mobile/account/'));
    assert.equal(forwarded.player,'Bearer '+token);
  }

  for(const [path,method,body] of [
    ['/growth/v1/mobile/profile','PATCH',{displayName:'Native Player'}],
    ['/growth/v1/mobile/account/password-change','POST',{currentPassword:'old-password',newPassword:'new-password'}],
  ]) {
    let forwarded=null;
    const request=new Request('https://api.packone.pro'+path,{
      method,
      headers:headers({
        'content-type':'application/json',
        'x-pack1-mobile-session':token,
        'x-pack1-mobile-account':account,
      }),
      body:JSON.stringify(body),
    });
    const response=await gateway(request,env(),async(url,options)=>{
      forwarded={url,player:new Headers(options.headers).get('authorization'),account:new Headers(options.headers).get('x-pack1-mobile-account')};
      return Response.json({ok:true});
    });
    assert.equal(response.status,200,path);
    assert.equal(forwarded.player,'Bearer '+token);
    assert.equal(forwarded.account,account);
  }

  const browserProfile=new Request('https://api.packone.pro/growth/v1/profile',{
    method:'PATCH',
    headers:headers({
      'content-type':'application/json',
      'x-pack1-mobile-session':token,
      'x-pack1-mobile-account':account,
    }),
    body:JSON.stringify({displayName:'Nope'}),
  });
  assert.equal((await gateway(browserProfile,env(),async()=>{throw Error('must not reach upstream')})).status,403);
});

test('native stored friend-run reads use only exact 24-hex share ids',async()=>{
  const share='0123456789abcdef01234567';
  for(const accountHeader of [null,account]) {
    let forwarded=null;
    const request=new Request('https://api.packone.pro/draft/v1/shared-runs/'+share,{
      headers:headers({
        'x-pack1-mobile-session':token,
        ...(accountHeader?{'x-pack1-mobile-account':accountHeader}:{}),
      }),
    });
    const response=await gateway(request,env(),async(url,options)=>{
      forwarded={url,authorization:new Headers(options.headers).get('authorization')};
      return Response.json({id:share,run_length:8});
    });
    assert.equal(response.status,200);
    assert.ok(forwarded.url.endsWith('/v1/shared-runs/'+share));
    assert.equal(forwarded.authorization,'Bearer '+token);
  }

  const invalid=new Request('https://api.packone.pro/draft/v1/shared-runs/not-a-share',{
    headers:headers({'x-pack1-mobile-session':token}),
  });
  assert.equal((await gateway(invalid,env(),async()=>{throw Error('must not reach upstream')})).status,403);
});

test('native Patreon management requires both mobile identities and cannot open browser provider routes',async()=>{
  for(const [path,method] of [
    ['/growth/v1/mobile/patreon/status','GET'],
    ['/growth/v1/mobile/patreon/connect','POST'],
    ['/growth/v1/mobile/patreon/disconnect','POST'],
  ]) {
    let forwarded=null;
    const request=new Request('https://api.packone.pro'+path,{
      method,
      headers:headers({
        ...(method==='POST'?{'content-type':'application/json'}:{}),
        'x-pack1-mobile-session':token,
        'x-pack1-mobile-account':account,
      }),
      ...(method==='POST'?{body:'{}'}:{}),
    });
    const response=await gateway(request,env(),async(url,options)=>{
      const next=new Headers(options.headers);
      forwarded={url,player:next.get('authorization'),account:next.get('x-pack1-mobile-account')};
      return Response.json({connected:false,capabilities:[]});
    });
    assert.equal(response.status,200,path);
    assert.equal(forwarded.player,'Bearer '+token);
    assert.equal(forwarded.account,account);
    assert.ok(forwarded.url.includes('/v1/mobile/patreon/'));
  }

  const browserConnect=new Request('https://api.packone.pro/growth/v1/patreon/connect',{
    method:'POST',
    headers:headers({
      'content-type':'application/json',
      'x-pack1-mobile-session':token,
      'x-pack1-mobile-account':account,
    }),
    body:'{}',
  });
  assert.equal((await gateway(browserConnect,env(),async()=>{throw Error('must not reach upstream')})).status,403);
});

test('practice idempotency is only forwarded to Draft Run creation',async()=>{
  const key='practice_'+('k'.repeat(32));
  let forwarded=null;
  const start=new Request('https://api.packone.pro/draft/v1/runs',{
    method:'POST',
    headers:headers({
      'content-type':'application/json',
      'x-pack1-mobile-session':token,
      'x-pack1-mobile-account':account,
      'x-idempotency-key':key,
    }),
    body:'{}',
  });
  const response=await gateway(start,env(),async(_url,options)=>{
    forwarded=new Headers(options.headers).get('x-idempotency-key');
    return Response.json({ok:true});
  });
  assert.equal(response.status,200);
  assert.equal(forwarded,key);

  const invalid=new Request('https://api.packone.pro/draft/v1/runs',{
    method:'POST',
    headers:headers({
      'content-type':'application/json',
      'x-pack1-mobile-session':token,
      'x-pack1-mobile-account':account,
      'x-idempotency-key':'bad key',
    }),
    body:'{}',
  });
  assert.equal((await gateway(invalid,env(),async()=>{throw Error('must not reach upstream')})).status,400);

  const wrongRoute=new Request('https://api.packone.pro/draft/v1/capabilities',{
    headers:headers({
      'x-pack1-mobile-session':token,
      'x-pack1-mobile-account':account,
      'x-idempotency-key':key,
    }),
  });
  assert.equal((await gateway(wrongRoute,env(),async()=>{throw Error('must not reach upstream')})).status,403);
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


test('Apple form callback is forwarded without JSON coercion and may return the account deep link',async()=>{
  const payload=new URLSearchParams({
    state:'s'.repeat(43),
    code:'apple-code',
    id_token:'apple-id-token',
  }).toString();
  let seen=null;
  const callback=new Request('https://api.packone.pro/growth/v1/account/apple/callback',{
    method:'POST',
    headers:headers({'content-type':'application/x-www-form-urlencoded',origin:'https://appleid.apple.com'}),
    body:payload,
  });
  const accepted=await gateway(callback,env(),async(url,options)=>{
    seen={
      url,
      body:options.body,
      contentType:new Headers(options.headers).get('content-type'),
    };
    return new Response(null,{
      status:302,
      headers:{location:'packone://account?appleHandoff='+'h'.repeat(43)},
    });
  });
  assert.equal(accepted.status,302);
  assert.equal(accepted.headers.get('location'),'packone://account?appleHandoff='+'h'.repeat(43));
  assert.match(seen.url,/pack1growth.*\/v1\/account\/apple\/callback$/);
  assert.equal(seen.body,payload);
  assert.equal(seen.contentType,'application/x-www-form-urlencoded');
});


test('mobile Apple deletion re-auth routes require and forward both mobile identities',async()=>{
  for(const path of [
    '/growth/v1/mobile/account/delete/apple/start',
    '/growth/v1/mobile/account/delete/apple/finish',
  ]) {
    let forwarded=null;
    const request=new Request('https://api.packone.pro'+path,{
      method:'POST',
      headers:headers({
        'content-type':'application/json',
        'x-pack1-mobile-session':token,
        'x-pack1-mobile-account':account,
      }),
      body:JSON.stringify(path.endsWith('/start')
        ? {confirm:true}
        : {confirm:true,handoffToken:'h'.repeat(43)}),
    });
    const response=await gateway(request,env(),async(url,options)=>{
      forwarded={
        url,
        player:new Headers(options.headers).get('authorization'),
        account:new Headers(options.headers).get('x-pack1-mobile-account'),
      };
      return Response.json({ok:true});
    });
    assert.equal(response.status,200,path);
    assert.match(forwarded.url,/pack1growth.*\/v1\/mobile\/account\/delete\/apple\/(?:start|finish)$/);
    assert.equal(forwarded.player,'Bearer '+token);
    assert.equal(forwarded.account,account);
  }
});
