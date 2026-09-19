import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {paidPatreonMembership,parsePatreonMembership,rawMembershipFromIdentity,verifyPatreonSignature} from '../worker/patreon.mjs';

const member=(overrides={})=>({
  type:'member',
  id:'member-1',
  attributes:{currently_entitled_amount_cents:500,patron_status:'active_patron',is_free_trial:false,is_gifted:false,...overrides},
  relationships:{
    user:{data:{type:'user',id:'user-1'}},
    campaign:{data:{type:'campaign',id:'campaign-1'}},
    currently_entitled_tiers:{data:[{type:'tier',id:'tier-1'}]},
  },
});

test('Patreon membership policy grants current paid, gifted and trial access but not free/deleted membership',()=>{
  const paid=parsePatreonMembership(member());
  assert.equal(paid.userId,'user-1');assert.equal(paid.memberId,'member-1');assert.equal(paid.campaignId,'campaign-1');
  assert.deepEqual(paid.tierIds,['tier-1']);assert.equal(paidPatreonMembership(paid),true);
  assert.equal(paidPatreonMembership(parsePatreonMembership(member({currently_entitled_amount_cents:0,is_gifted:true}))),true);
  assert.equal(paidPatreonMembership(parsePatreonMembership(member({currently_entitled_amount_cents:0,is_free_trial:true}))),true);
  const free=parsePatreonMembership(member({currently_entitled_amount_cents:0,patron_status:null}));
  assert.equal(paidPatreonMembership(free),false);
  assert.equal(paidPatreonMembership(paid,{deleted:true}),false);
});

test('identity resolution uses the membership belonging to the current Patreon user',()=>{
  const other=member();other.id='other-member';other.relationships.user.data.id='other-user';
  const data={data:{type:'user',id:'user-1'},included:[other,member()]};
  const resolved=rawMembershipFromIdentity(data);
  assert.equal(resolved.userId,'user-1');assert.equal(resolved.member.memberId,'member-1');
});

test('Patreon webhook verification uses the documented raw-body HMAC MD5 signature',()=>{
  const raw=Buffer.from('{"data":{"type":"member"}}'),secret='fixture-secret';
  const signature=createHmac('md5',secret).update(raw).digest('hex');
  assert.equal(verifyPatreonSignature(raw,signature,secret),true);
  assert.equal(verifyPatreonSignature(raw,'0'.repeat(32),secret),false);
  assert.equal(verifyPatreonSignature(Buffer.from(raw.toString()+' '),signature,secret),false);
});

test('OAuth return path is account-oriented and does not expose a Patreon token in the browser',async()=>{
  const bootstrap=await import('node:fs/promises').then(fs=>fs.readFile('bootstrap.mjs','utf8'));
  const adapter=await import('node:fs/promises').then(fs=>fs.readFile('worker/patreon.mjs','utf8'));
  assert.match(bootstrap,/params\.has\('patreon'\)/);
  assert.match(adapter,/scope','identity'/);
  assert.doesNotMatch(adapter,/provider_accounts[\s\S]{0,500}(access_token|refresh_token)/i);
});
