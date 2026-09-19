import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {premiumPatreonMembership,validPatreonPolicy,PATREON_POLICY} from '../patreon-policy.mjs';
import {parsePatreonMembership,rawMembershipFromIdentity,verifyPatreonSignature,handlePatreon,patreonAccountAllowed} from '../worker/patreon.mjs';
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
  for(const attrs of [{patron_status:'declined_patron'},{last_charge_status:'Declined'},{last_charge_status:'Refunded'}])assert.equal(premiumPatreonMembership(parsePatreonMembership(member('200',attrs)),policy),false);
  for(const attrs of [{is_free_trial:true,currently_entitled_amount_cents:0,patron_status:null},{is_gifted:true,currently_entitled_amount_cents:0,patron_status:null},{patron_status:'former_patron'}])assert.equal(premiumPatreonMembership(parsePatreonMembership(member('200',attrs)),policy),true);
  assert.equal(premiumPatreonMembership({...parsePatreonMembership(member()),tierIds:[]},policy),false);
});

test('identity never falls back to another creator or unlinked included member',()=>{
  const data={data:{type:'user',id:'u1',relationships:{memberships:{data:[{id:'m1'}]}}},included:[member()]};
  assert.equal(rawMembershipFromIdentity(data,policy).member.memberId,'m1');
  assert.equal(rawMembershipFromIdentity(data,{...policy,campaignId:'999'}).member,null);
  data.data.relationships.memberships.data=[];assert.equal(rawMembershipFromIdentity(data,policy).member,null);
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
