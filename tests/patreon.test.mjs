import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import fs from 'node:fs';
import {premiumPatreonMembership,validPatreonPolicy,PATREON_POLICY} from '../patreon-policy.mjs';
import {parsePatreonMembership,rawMembershipFromIdentity,effectivePatreonMembership,verifyPatreonSignature,handlePatreon,patreonAccountAllowed,applyPatreonMembership} from '../worker/patreon.mjs';
import {reconcilePatreon} from '../scripts/patreon-reconcile.mjs';
const policy={enabled:true,campaignId:'100',premiumTierIds:['200']};
const member=(tier='200',attrs={})=>({type:'member',id:'m1',attributes:{patron_status:'active_patron',last_charge_status:'Paid',currently_entitled_amount_cents:500,...attrs},relationships:{user:{data:{id:'u1'}},campaign:{data:{id:'100'}},currently_entitled_tiers:{data:[{id:tier}]}}});

test('only the exact premium campaign and tier unlock tools, never the supporter amount',()=>{
  assert.equal(PATREON_POLICY.enabled,true);
  assert.equal(validPatreonPolicy(PATREON_POLICY),true);
  assert.equal(premiumPatreonMembership(parsePatreonMembership(member()),policy),true);
  assert.equal(premiumPatreonMembership(parsePatreonMembership(member('201',{currently_entitled_amount_cents:100000})),policy),false);
  assert.equal(premiumPatreonMembership({...parsePatreonMembership(member()),campaignId:'999'},policy),false);
  assert.equal(premiumPatreonMembership(parsePatreonMembership(member())),false);
  for(const attrs of [{patron_status:'declined_patron'},{last_charge_status:'Declined'},{last_charge_status:'Refunded'},{last_charge_status:'Fraud'},{last_charge_status:'Deleted'}])assert.equal(premiumPatreonMembership(parsePatreonMembership(member('200',attrs)),policy),false);
  for(const attrs of [{is_free_trial:true,currently_entitled_amount_cents:0,patron_status:null},{is_gifted:true,currently_entitled_amount_cents:0,patron_status:null},{patron_status:'former_patron'}])assert.equal(premiumPatreonMembership(parsePatreonMembership(member('200',attrs)),policy),true);
  assert.equal(premiumPatreonMembership({...parsePatreonMembership(member()),tierIds:[]},policy),false);
});

test('identity never falls back to another creator or unlinked included member',()=>{
  const data={data:{type:'user',id:'u1',relationships:{memberships:{data:[{id:'m1'}]}}},included:[member()]};
  assert.equal(rawMembershipFromIdentity(data,policy).member.memberId,'m1');
  assert.equal(rawMembershipFromIdentity(data,{...policy,campaignId:'999'}).member,null);
  data.data.relationships.memberships.data=[];assert.equal(rawMembershipFromIdentity(data,policy).member,null);
});

test('server-derived effective membership state follows the entitlement policy',()=>{
  const row={provider_campaign_id:'100',membership_status:'active_patron',last_charge_status:'Paid',tier_ids:['200'],is_free_trial:false,is_gifted:false,last_synced_at:'2026-09-22T00:00:00Z'};
  assert.equal(effectivePatreonMembership(row,policy),'elite_entitled');
  assert.equal(effectivePatreonMembership({...row,tier_ids:['201']},policy),'active_non_elite');
  assert.equal(effectivePatreonMembership({...row,membership_status:'declined_patron'},policy),'not_entitled');
  assert.equal(effectivePatreonMembership({...row,last_charge_status:'Refunded'},policy),'not_entitled');
  assert.equal(effectivePatreonMembership({...row,membership_status:'former_patron'},policy),'elite_entitled');
  assert.equal(effectivePatreonMembership({...row,provider_campaign_id:'999'},policy),'not_entitled');
  assert.equal(effectivePatreonMembership({...row,last_synced_at:null},policy),'unknown');
});

test('Patreon connect keeps the Phase 0 approved identity scope',async()=>{
  const prior=Object.fromEntries(['PATREON_CLIENT_ID','PATREON_CLIENT_SECRET','PATREON_WEBHOOK_SECRET'].map(k=>[k,process.env[k]]));
  Object.assign(process.env,{PATREON_CLIENT_ID:'fixture-client',PATREON_CLIENT_SECRET:'fixture-secret',PATREON_WEBHOOK_SECRET:'fixture-webhook'});
  try {
    const response=await handlePatreon(new Request('https://packone.pro/v1/patreon/connect',{method:'POST'}),{
      query:async sql=>sql.includes('INSERT INTO provider_oauth_states')?{rows:[{state_hash:'fixture'}]}:{rows:[]},
      authSession:async()=>({user_id:'11111111-1111-4111-8111-111111111111'}),
      json:(d,s)=>Response.json(d,{status:s||200}),
    });
    assert.equal(response.status,200);
    const target=new URL((await response.json()).url);
    assert.equal(target.searchParams.get('scope'),'identity');
  } finally {
    for(const [key,value] of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});

test('native Patreon aliases use the exact mobile account identity',async()=>{
  const prior=Object.fromEntries(['PATREON_CLIENT_ID','PATREON_CLIENT_SECRET','PATREON_WEBHOOK_SECRET'].map(k=>[k,process.env[k]]));
  Object.assign(process.env,{PATREON_CLIENT_ID:'fixture-client',PATREON_CLIENT_SECRET:'fixture-secret',PATREON_WEBHOOK_SECRET:'fixture-webhook'});
  const authUserId='11111111-1111-4111-8111-111111111111';
  let browserAuthCalls=0,mobileAuthCalls=0;
  const query=async sql=>{
    if(sql.includes('INSERT INTO provider_oauth_states'))return {rows:[{state_hash:'fixture'}]};
    if(sql.includes('FROM provider_accounts WHERE auth_user_id'))return {rows:[]};
    if(sql.includes('FROM entitlement_grants WHERE auth_user_id'))return {rows:[]};
    return {rows:[]};
  };
  const deps={
    query,
    authSession:async()=>{browserAuthCalls++;throw Error('browser auth must not run');},
    mobileAccountIdentity:async()=>{mobileAuthCalls++;return {owner:'22222222-2222-4222-8222-222222222222',auth:{user_id:authUserId}};},
    json:(d,s)=>Response.json(d,{status:s||200}),
  };
  try {
    const status=await handlePatreon(new Request('https://packone.pro/v1/mobile/patreon/status'),deps);
    assert.equal(status.status,200);
    assert.equal((await status.json()).connected,false);

    const connect=await handlePatreon(new Request('https://packone.pro/v1/mobile/patreon/connect',{method:'POST'}),deps);
    assert.equal(connect.status,200);
    const target=new URL((await connect.json()).url);
    assert.equal(target.hostname,'www.patreon.com');
    assert.equal(target.searchParams.get('scope'),'identity');

    const disconnect=await handlePatreon(new Request('https://packone.pro/v1/mobile/patreon/disconnect',{method:'POST'}),deps);
    assert.equal(disconnect.status,200);
    assert.equal((await disconnect.json()).ok,true);

    assert.equal(browserAuthCalls,0);
    assert.equal(mobileAuthCalls,3);
  } finally {
    for(const [key,value] of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});

test('Patreon callback refuses to silently replace an existing linked Patreon identity',async()=>{
  const priorEnv=Object.fromEntries(['PATREON_CLIENT_ID','PATREON_CLIENT_SECRET','PATREON_WEBHOOK_SECRET'].map(k=>[k,process.env[k]]));
  const priorFetch=globalThis.fetch;
  Object.assign(process.env,{PATREON_CLIENT_ID:'fixture-client',PATREON_CLIENT_SECRET:'fixture-secret',PATREON_WEBHOOK_SECRET:'fixture-webhook'});
  globalThis.fetch=async url=>{
    if(String(url).includes('/api/oauth2/token'))return Response.json({access_token:'fixture-token'});
    return Response.json({data:{type:'user',id:'new-patreon',relationships:{memberships:{data:[]}}},included:[]});
  };
  try {
    const query=async(sql)=>{
      if(sql.startsWith('UPDATE provider_oauth_states SET consumed_at'))return {rows:[{auth_user_id:'11111111-1111-4111-8111-111111111111'}]};
      if(sql.startsWith('SELECT provider_user_id'))return {rows:[{provider_user_id:'original-patreon'}]};
      if(sql.startsWith('DELETE FROM provider_oauth_states'))return {rows:[]};
      throw Error('Unexpected query: '+sql.slice(0,60));
    };
    const response=await handlePatreon(new Request('https://packone.pro/v1/patreon/callback?state='+('a'.repeat(64))+'&code=fixture'),{query,authSession:async()=>null,json:(d,s)=>Response.json(d,{status:s||200})});
    assert.equal(response.status,302);
    assert.equal(new URL(response.headers.get('location')).searchParams.get('patreon'),'identity-mismatch');
  } finally {
    globalThis.fetch=priorFetch;
    for(const [key,value] of Object.entries(priorEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});

test('Patreon callback maps provider identity uniqueness to a safe conflict result',async()=>{
  const priorEnv=Object.fromEntries(['PATREON_CLIENT_ID','PATREON_CLIENT_SECRET','PATREON_WEBHOOK_SECRET'].map(k=>[k,process.env[k]]));
  const priorFetch=globalThis.fetch;
  Object.assign(process.env,{PATREON_CLIENT_ID:'fixture-client',PATREON_CLIENT_SECRET:'fixture-secret',PATREON_WEBHOOK_SECRET:'fixture-webhook'});
  globalThis.fetch=async url=>{
    if(String(url).includes('/api/oauth2/token'))return Response.json({access_token:'fixture-token'});
    return Response.json({data:{type:'user',id:'provider-owned-elsewhere',relationships:{memberships:{data:[]}}},included:[]});
  };
  try {
    const query=async(sql)=>{
      if(sql.startsWith('UPDATE provider_oauth_states SET consumed_at'))return {rows:[{auth_user_id:'11111111-1111-4111-8111-111111111111'}]};
      if(sql.startsWith('SELECT provider_user_id'))return {rows:[]};
      if(sql.startsWith('WITH identity_allowed')){const error=Error('duplicate');error.pgCode='23505';throw error;}
      if(sql.startsWith('DELETE FROM provider_oauth_states'))return {rows:[]};
      throw Error('Unexpected query: '+sql.slice(0,60));
    };
    const response=await handlePatreon(new Request('https://packone.pro/v1/patreon/callback?state='+('b'.repeat(64))+'&code=fixture'),{query,authSession:async()=>null,json:(d,s)=>Response.json(d,{status:s||200})});
    assert.equal(response.status,302);
    const location=new URL(response.headers.get('location'));
    assert.equal(location.searchParams.get('patreon'),'conflict');
    assert.equal(location.searchParams.size,1,'conflict redirect must not disclose another Pack One account');
  } finally {
    globalThis.fetch=priorFetch;
    for(const [key,value] of Object.entries(priorEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
test('raw webhook bytes must match the HMAC signature',()=>{
  const raw=Buffer.from('{"data":{}}'),secret='test';
  const signature=createHmac('md5',secret).update(raw).digest('hex');
  assert.equal(verifyPatreonSignature(raw,signature,secret),true);
  assert.equal(verifyPatreonSignature(Buffer.concat([raw,Buffer.from(' ')]),signature,secret),false);
});

test('unconfigured linking does not touch provider API or create OAuth state',async()=>{
  const response=await handlePatreon(new Request('https://packone.pro/v1/patreon/connect',{method:'POST'}),{
    query:()=>{throw Error('Unexpected write');},authSession:async()=>({user_id:'fixture'}),json:(d,s)=>Response.json(d,{status:s||200}),
  });assert.equal(response.status,503);
});

test('failed pagination never applies a partial membership snapshot',async()=>{
  let calls=0,writes=0;
  const query=async(sql)=>{if(!sql.startsWith('SELECT'))writes++;return {rows:[{auth_user_id:'a',provider_user_id:'u1',sync_revision:0}]};};
  await assert.rejects(reconcilePatreon(query,{policy,getPage:async()=>{if(++calls===1)return{data:[member()],links:{next:'page2'}};throw Error('provider unavailable');}}),/provider unavailable/);
  assert.equal(writes,0);
});

test('reconciliation follows all pages and includes missing members for revocation',async()=>{
  const writes=[];let page=0;
  const query=async(sql,params)=>{
    if(sql.startsWith('SELECT'))return {rows:[{auth_user_id:'a',provider_user_id:'u1',sync_revision:0},{auth_user_id:'b',provider_user_id:'u2',sync_revision:4}]};
    if(sql.startsWith('WITH saved')){writes.push(params);return {rows:[{applied:1}]};}
    return {rows:[]};
  };
  const result=await reconcilePatreon(query,{policy,getPage:async()=>++page===1?{data:[member()],links:{next:'page2'}}:{data:[]}});
  assert.equal(result.applied,2);assert.equal(result.pages,2);
  assert.equal(writes[0][12],true);assert.equal(writes[1][12],false);assert.equal(writes[1][11],4);
});

test('premium grants tolerate delayed hourly reconciliation without becoming indefinite',async()=>{
  let sql='';
  const query=async(statement)=>{sql=statement;return {rows:[{applied:1}]};};
  await applyPatreonMembership(query,'11111111-1111-4111-8111-111111111111','u1',{
    memberId:'m1',campaignId:'100',status:'active_patron',lastChargeStatus:'Paid',
    entitledAmountCents:500,isFreeTrial:false,isGifted:false,tierIds:['200'],
  },{policy,revision:0,observedAt:'2026-09-22T00:00:00.000Z'});
  assert.match(sql,/interval '12 hours'/);
  assert.doesNotMatch(sql,/interval '3 hours'/);
});

test('controlled linking accepts only the authorized account, never an email or player claim',()=>{
 const canary={...policy,enabled:false,canaryAccountHashes:[createHash('sha256').update('allowed-account').digest('hex')]};
 assert.equal(patreonAccountAllowed('allowed-account',canary),true);
 assert.equal(patreonAccountAllowed('other-account',canary),false);
 assert.equal(patreonAccountAllowed(null,canary),false);
 assert.equal(patreonAccountAllowed('any-account',policy),true);
});

test('public activation permits account linking but grants only the real Elite tier',()=>{
 assert.equal(patreonAccountAllowed('new-account'),true);
 const active={campaignId:PATREON_POLICY.campaignId,tierIds:['29631843'],status:'active_patron'};
 assert.equal(premiumPatreonMembership(active),true);
 assert.equal(premiumPatreonMembership({...active,tierIds:['29631835'],entitledAmountCents:100000}),false);
 assert.equal(premiumPatreonMembership({...active,tierIds:[]}),false);
});

test('Elite grant, prior-state probe and activation gate derive from one capability list',()=>{
  // Regression: the transition gate hardcoded =2 against a literal capability
  // list, so adding a third Elite capability would keep granting it while
  // silently preventing elite_activated from ever firing again.
  const source=fs.readFileSync(new URL('../worker/patreon.mjs',import.meta.url),'utf8');
  const listed=source.match(/const ELITE_CAPABILITIES=\[([^\]]+)\]/);
  assert.ok(listed,'the Elite capability list must be a single named constant');
  const names=listed[1].split(',').map(part=>part.trim().replace(/^'|'$/g,''));
  assert.deepEqual(names,['custom_corpus','unlimited_cube_practice']);
  assert.match(source,/count\(DISTINCT eg\.capability\)=\$\{ELITE_CAPABILITY_COUNT\}/);
  assert.match(source,/eg\.capability IN \(\$\{ELITE_CAPABILITY_LIST\}\)/);
  assert.match(source,/VALUES \$\{ELITE_CAPABILITY_VALUES\}/);
  assert.match(source,/g\.n=\$\{ELITE_CAPABILITY_COUNT\}/);
  assert.doesNotMatch(source,/g\.n=\d/,'the transition gate must not hardcode a capability count');
});

