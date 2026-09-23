import test from 'node:test';
import assert from 'node:assert/strict';
import {advertisingAllowed,slotIdForPlacement} from '../ads.mjs';
import {adFreePatreonMembership,premiumPatreonMembership,PATREON_POLICY} from '../patreon-policy.mjs';
import {patreonAdvertisingStatus} from '../worker/patreon.mjs';
import {ACCOUNT_SIGNAL_KEY,signalAccountChange} from '../growth-api.mjs';

test('ad placement names map explicitly and never fall back',()=>{
  const cfg={slots:{home:'home-id',articleTop:'article-id',articleInline:'inline-id'}};
  assert.equal(slotIdForPlacement(cfg,'home'),'home-id');
  assert.equal(slotIdForPlacement(cfg,'article-top'),'article-id');
  assert.equal(slotIdForPlacement(cfg,'unknown'),'');
  assert.equal(slotIdForPlacement({slots:{home:'',articleTop:'article-id'}},'home'),'');
});

test('account signal contains only a fresh nonce on every write',()=>{
  const writes=[],events=[];
  const storage={setItem:(key,value)=>writes.push({key,value})};
  const target={dispatchEvent:event=>{events.push(event.type);return true;}};
  const first=signalAccountChange({storage,target});
  const second=signalAccountChange({storage,target});
  assert.equal(writes.length,2);
  assert.deepEqual(writes.map(row=>row.key),[ACCOUNT_SIGNAL_KEY,ACCOUNT_SIGNAL_KEY]);
  const payloads=writes.map(row=>JSON.parse(row.value));
  assert.deepEqual(Object.keys(payloads[0]),['nonce']);
  assert.deepEqual(Object.keys(payloads[1]),['nonce']);
  assert.notEqual(payloads[0].nonce,payloads[1].nonce);
  assert.notEqual(first,second);
  assert.deepEqual(events,['packone-account-changed','packone-account-changed']);
});

test('both paid tiers are ad-free; only Elite grants premium practice',()=>{
  for(const tier of ['29631835','29631843']){
    const member={campaignId:PATREON_POLICY.campaignId,tierIds:[tier],status:'active_patron'};
    assert.equal(adFreePatreonMembership(member),true);
    assert.equal(premiumPatreonMembership(member),tier==='29631843');
    assert.equal(adFreePatreonMembership({...member,campaignId:'999'}),false);
    assert.equal(adFreePatreonMembership({...member,status:'declined_patron'}),false);
    assert.equal(adFreePatreonMembership({...member,lastChargeStatus:'Refunded'}),false);
    assert.equal(adFreePatreonMembership({...member,status:'former_patron'}),true);
    assert.equal(adFreePatreonMembership({...member,status:null,isFreeTrial:true}),true);
    assert.equal(adFreePatreonMembership({...member,status:null,isGifted:true}),true);
  }
  assert.equal(adFreePatreonMembership({campaignId:PATREON_POLICY.campaignId,tierIds:['29623888'],status:'active_patron'}),false);
});

test('membership snapshots suppress ads for supporters, elites, and uncertain sync state',()=>{
  const now=Date.parse('2026-09-19T19:00:00Z');
  const row={provider_campaign_id:PATREON_POLICY.campaignId,tier_ids:['29631835'],membership_status:'active_patron',last_charge_status:'Paid',last_synced_at:new Date(now-1000).toISOString()};
  assert.deepEqual(patreonAdvertisingStatus(row,now),{ad_free:true,ads_allowed:false});
  assert.equal(patreonAdvertisingStatus({...row,tier_ids:'["29631843"]'},now).ads_allowed,false);
  assert.equal(patreonAdvertisingStatus({...row,membership_status:'former_patron'},now).ads_allowed,false);
  assert.equal(patreonAdvertisingStatus({...row,membership_status:null,is_free_trial:true},now).ads_allowed,false);
  assert.equal(patreonAdvertisingStatus({...row,membership_status:null,is_gifted:true},now).ads_allowed,false);
  assert.equal(patreonAdvertisingStatus({...row,membership_status:'declined_patron'},now).ads_allowed,true);
  assert.equal(patreonAdvertisingStatus({...row,last_charge_status:'Refunded'},now).ads_allowed,true);
  const free={...row,tier_ids:['29623888']};
  assert.deepEqual(patreonAdvertisingStatus(free,now),{ad_free:false,ads_allowed:true});
  for(const change of [{last_synced_at:'invalid'},{last_synced_at:new Date(now-10800000).toISOString()},{sync_requested_at:new Date(now).toISOString()}])assert.equal(patreonAdvertisingStatus({...free,...change},now).ads_allowed,false);
  assert.deepEqual(patreonAdvertisingStatus(null,now),{ad_free:false,ads_allowed:true});
});

test('ad release gate makes no membership request and uncertain accounts never load ads',async()=>{
  let calls=0;
  const options={enabled:true,client:'test',accountToken:'account',checkMembership:async()=>{calls++;return {ads_allowed:true};}};
  assert.equal(await advertisingAllowed({...options,enabled:false}),false);
  assert.equal(await advertisingAllowed({...options,game:true}),false);
  assert.equal(calls,0);
  for(const response of [{ad_free:true,ads_allowed:false},{},{ads_allowed:null}])assert.equal(await advertisingAllowed({...options,checkMembership:async()=>response}),false);
  assert.equal(await advertisingAllowed({...options,checkMembership:async()=>{throw Error('offline');}}),false);
  assert.equal(await advertisingAllowed(options),true);
  assert.equal(await advertisingAllowed({...options,accountToken:null}),true);
});
