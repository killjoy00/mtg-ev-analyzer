import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {handlePatreon} from '../worker/patreon.mjs';
import {nativePatreonIdentity} from '../worker/patreon-mobile.mjs';
import {nativePatreonAction,patreonReturnUrl} from '../worker/patreon-mobile-policy.mjs';
import {gateway} from '../edge/gateway.mjs';

const ACCOUNT='11111111-1111-4111-8111-111111111111';
const PLAYER='22222222-2222-4222-8222-222222222222';
const TOKEN=`p1_${PLAYER}.${'A'.repeat(43)}`;
const ACCOUNT_TOKEN='B'.repeat(43);
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=(value,status=200)=>Response.json(value,{status});
const request=(action,method='GET',extra={})=>new Request('https://packone.pro/v1/patreon/mobile/'+action,{
  method,headers:{authorization:'Bearer '+TOKEN,'x-pack1-mobile-account':ACCOUNT_TOKEN,'content-type':'application/json',...extra},
  ...(method==='POST'?{body:JSON.stringify({confirm:true})}:{}),
});
function deps(overrides={}) {
  return {
    json,
    playerSession:async()=>PLAYER,
    authSession:async(_request,options)=>{
      assert.deepEqual(options,{required:true,allowLegacy:false,csrf:false});
      return {source:'mobile',user_id:ACCOUNT};
    },
    query:async(sql)=>{
      if(sql.includes('FROM account_links'))return {rows:[{auth_user_id:ACCOUNT,player_id:PLAYER}]};
      if(sql.includes('FROM provider_accounts'))return {rows:[]};
      if(sql.includes('SELECT DISTINCT capability'))return {rows:[{capability:'custom_corpus'},{capability:'unlimited_cube_practice'}]};
      if(sql.includes('SELECT capability'))return {rows:[]};
      throw Error('Unexpected query: '+sql.slice(0,100));
    },
    ...overrides,
  };
}

for(const action of ['status','connect','refresh','disconnect'])test(`native Patreon ${action} has one exact route/method`,()=>{
  const method=action==='status'?'GET':'POST';
  assert.equal(nativePatreonAction('/v1/patreon/mobile/'+action,method),action);
  assert.equal(nativePatreonAction('/v1/patreon/mobile/'+action,method==='GET'?'POST':'GET'),null);
  assert.equal(nativePatreonAction('/v1/patreon/mobile/'+action+'/extra',method),null);
});

test('provider-independent grants do not become Free when Patreon is unconnected',async()=>{
  const response=await handlePatreon(request('status'),deps());
  const data=await response.json();
  assert.equal(data.connected,false);
  assert.deepEqual(data.capabilities,[]);
  assert.deepEqual(data.account_capabilities,['account','unlimited_regular_practice','custom_corpus','unlimited_cube_practice']);
  assert.equal(data.account_user_id,ACCOUNT);
  assert.equal(data.player_id,PLAYER);
  assert.equal(Object.hasOwn(data,'support_url'),false);
});

test('an active Apple subscription is ad-free and is not reported as Patreon provenance',async()=>{
  const response=await handlePatreon(request('status'),deps({query:async(sql,params)=>{
    if(sql.includes('FROM account_links'))return {rows:[{auth_user_id:ACCOUNT,player_id:PLAYER}]};
    if(sql.includes('FROM provider_accounts'))return {rows:[]};
    if(sql.includes('SELECT DISTINCT capability'))return {rows:[{capability:'custom_corpus'},{capability:'unlimited_cube_practice'}]};
    if(sql.includes('SELECT capability')) {
      assert.deepEqual(params,[ACCOUNT,'patreon','apple-app-store']);
      return {rows:[{capability:'custom_corpus',provider:'apple-app-store'},{capability:'unlimited_cube_practice',provider:'apple-app-store'}]};
    }
    throw Error('Unexpected query: '+sql.slice(0,100));
  }}));
  const data=await response.json();
  assert.equal(data.apple_subscription_active,true);
  assert.equal(data.ad_free,true);
  assert.equal(data.ads_allowed,false);
  assert.equal(data.patreon_ad_free,false);
  assert.equal(data.connected,false);
  assert.deepEqual(data.capabilities,[]);
  assert.deepEqual(data.account_capabilities,['account','unlimited_regular_practice','custom_corpus','unlimited_cube_practice']);
});

test('without an Apple subscription an unconnected account keeps the promotion',async()=>{
  const data=await (await handlePatreon(request('status'),deps())).json();
  assert.equal(data.apple_subscription_active,false);
  assert.equal(data.ads_allowed,true);
});

for(const headers of [{cookie:'__Host-pack1_account=other'},{'x-pack1-auth-session':'legacy'},{'x-pack1-mobile-account':''}]) {
  test('native identity rejects cookie, legacy or missing native authentication '+Object.keys(headers)[0],async()=>{
    await assert.rejects(nativePatreonIdentity(request('status','GET',headers),deps()),{status:401});
  });
}

test('native identity requires exact linked player and native auth source',async()=>{
  await assert.rejects(nativePatreonIdentity(request('status'),deps({playerSession:async()=>ACCOUNT})),{status:401});
  await assert.rejects(nativePatreonIdentity(request('status'),deps({authSession:async()=>({source:'cookie',user_id:ACCOUNT})})),{status:401});
});

test('refresh requests reconciliation, never manufactures a grant or reports completed sync',async()=>{
  const statements=[];
  const base=deps();
  const response=await handlePatreon(request('refresh','POST'),deps({query:async(sql,params)=>{
    statements.push(sql);
    if(sql.startsWith('UPDATE provider_accounts'))return {rows:[{auth_user_id:ACCOUNT}]};
    return base.query(sql,params);
  }}));
  assert.deepEqual(await response.json(),{ok:true,requested:true});
  assert.ok(statements.some(sql=>sql.includes('sync_requested_at=now()')));
  assert.ok(statements.every(sql=>!sql.includes('entitlement_grants')));
});

test('disconnect is explicit and restricted to Patreon grants and OAuth states',async()=>{
  let mutation='';
  const base=deps();
  const response=await handlePatreon(request('disconnect','POST'),deps({query:async(sql,params)=>{
    if(sql.startsWith('WITH states')){mutation=sql;assert.deepEqual(params,[ACCOUNT]);return {rows:[]};}
    return base.query(sql,params);
  }}));
  assert.equal(response.status,200);
  assert.equal((mutation.match(/provider='patreon'/g)||[]).length,3);
  const noConfirm=new Request(request('disconnect','POST'),{body:'{}'});
  await assert.rejects(handlePatreon(noConfirm,deps()),{status:400});
});

async function configured(fn) {
  const keys=['PATREON_CLIENT_ID','PATREON_CLIENT_SECRET','PATREON_WEBHOOK_SECRET'];
  const saved=keys.map(key=>process.env[key]);
  for(const key of keys)process.env[key]='fixture-only';
  try{return await fn();}finally{keys.forEach((key,index)=>{if(saved[index]===undefined)delete process.env[key];else process.env[key]=saved[index];});}
}

test('native connect binds a domain-separated random state to the initiating account',async()=>configured(async()=>{
  let storedHash='';
  const base=deps();
  const response=await handlePatreon(request('connect','POST'),deps({query:async(sql,params)=>{
    if(sql.startsWith('DELETE FROM provider_oauth_states'))return {rows:[]};
    if(sql.includes('INSERT INTO provider_oauth_states')){storedHash=params[0];assert.equal(params[1],ACCOUNT);return {rows:[{state_hash:storedHash}]};}
    return base.query(sql,params);
  }}));
  const target=new URL((await response.json()).url);
  assert.match(target.searchParams.get('state'),/^m_[a-f0-9]{64}$/);
  assert.equal(storedHash,hash(target.searchParams.get('state')));
  assert.notEqual(storedHash,hash(target.searchParams.get('state').slice(2)));
  assert.equal(target.searchParams.get('scope'),'identity');
}));

for(const cookie of ['', '__Host-pack1_account=someone-else'])test('native callback ignores browser account '+(cookie?'wrong-account':'signed-out'),async()=>configured(async()=>{
  const previousFetch=globalThis.fetch;
  const nativeState='m_'+'a'.repeat(64);
  let appliedTo=null;
  globalThis.fetch=async url=>String(url).includes('/api/oauth2/token')
    ? Response.json({access_token:'never-return-this-token'})
    : Response.json({data:{id:'patreon-user',relationships:{memberships:{data:[]}}},included:[]});
  try {
    const response=await handlePatreon(new Request('https://packone.pro/v1/patreon/callback?state='+nativeState+'&code=private-code',{headers:cookie?{cookie}:{}}),{
      json,authSession:async()=>{throw Error('Browser identity must not be used by callback');},
      query:async(sql,params)=>{
        if(sql.startsWith('UPDATE provider_oauth_states')){assert.equal(params[0],hash(nativeState));return {rows:[{auth_user_id:ACCOUNT}]};}
        if(sql.startsWith('SELECT provider_user_id'))return {rows:[]};
        if(sql.startsWith('WITH identity_allowed')){appliedTo=params[0];return {rows:[{applied:1}]};}
        if(sql.startsWith('DELETE FROM provider_oauth_states'))return {rows:[]};
        throw Error('Unexpected query');
      },
    });
    assert.equal(appliedTo,ACCOUNT);
    assert.equal(response.headers.get('location'),'https://packone.pro/mobile-membership-complete/?result=connected');
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    assert.doesNotMatch(response.headers.get('location'),/private-code|never-return|m_aaa|11111111/);
  } finally {globalThis.fetch=previousFetch;}
}));

test('expired, replayed and cancelled native callbacks never call the provider',async()=>configured(async()=>{
  const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('must not contact provider');};
  try {
    for(const [rows,code,result] of [[[], 'x','expired'],[[{auth_user_id:ACCOUNT}], '', 'cancelled']]) {
      const response=await handlePatreon(new Request('https://packone.pro/v1/patreon/callback?state=m_'+ 'c'.repeat(64)+'&code='+code),{
        json,authSession:async()=>{throw Error('must not authenticate browser');},query:async()=>({rows}),
      });
      assert.equal(new URL(response.headers.get('location')).searchParams.get('result'),result);
    }
  } finally {globalThis.fetch=old;}
}));

test('legacy web completion remains distinct and native completion has no purchase funnel',()=>{
  assert.equal(patreonReturnUrl('connected'),'https://packone.pro/?patreon=connected');
  assert.equal(patreonReturnUrl('untrusted',{mobile:true}),'https://packone.pro/mobile-membership-complete/?result=error');
  const html=fs.readFileSync('mobile-membership-complete/index.html','utf8');
  assert.doesNotMatch(html,/<a\b|<form\b|activation|support_url|patreon\.com/);
  assert.match(html,/no-referrer/);
});

const env=()=>({MODE:'production',NEON_BRANCH_ID:'br-orange-feather-ayps8kep',QUOTA_KEY:'a'.repeat(64),
  NETWORK_QUOTA:{idFromName:x=>x,get:()=>({fetch:async()=>new Response(null,{status:204})})}});
for(const action of ['status','connect','refresh','disconnect'])test(`gateway ${action} forwards only the native identity even with browser cookies`,async()=>{
  const method=action==='status'?'GET':'POST';let forwarded=null;
  const response=await gateway(new Request('https://api.packone.pro/growth/v1/patreon/mobile/'+action,{
    method,headers:{'cf-connecting-ip':'192.0.2.1','content-type':'application/json','x-pack1-mobile-session':TOKEN,
      'x-pack1-mobile-account':ACCOUNT_TOKEN,cookie:'__Host-pack1_player=p1_other; __Host-pack1_account=other'},
    ...(method==='POST'?{body:'{"confirm":true}'}:{}),
  }),env(),async(url,options)=>{forwarded={url,headers:new Headers(options.headers)};return Response.json({ok:true});});
  assert.equal(response.status,200);
  assert.equal(forwarded.headers.get('authorization'),'Bearer '+TOKEN);
  assert.equal(forwarded.headers.get('x-pack1-mobile-account'),ACCOUNT_TOKEN);
  assert.equal(forwarded.headers.has('cookie'),false);
});

test('gateway rejects incomplete native identities and native headers on legacy provider routes',async()=>{
  for(const [path,headers,status] of [
    ['/growth/v1/patreon/mobile/status',{},401],
    ['/growth/v1/patreon/mobile/status',{'x-pack1-mobile-session':TOKEN},401],
    ['/growth/v1/patreon/mobile/status',{'x-pack1-mobile-account':ACCOUNT_TOKEN},401],
    ['/growth/v1/patreon/status',{'x-pack1-mobile-session':TOKEN,'x-pack1-mobile-account':ACCOUNT_TOKEN},403],
    ['/growth/v1/patreon/mobile/status/anything',{},404],
  ]) {
    const response=await gateway(new Request('https://api.packone.pro'+path,{headers:{'cf-connecting-ip':'192.0.2.1',...headers}}),env(),async()=>{throw Error('must not forward');});
    assert.equal(response.status,status);
  }
});
