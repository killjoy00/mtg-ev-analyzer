import fs from 'node:fs';
import assert from 'node:assert/strict';
if(!process.argv.includes('--dev-fixtures'))throw Error('Requires an isolated fixture database.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query,default:growth}=await import('../worker/growth-function.js');
const {applyPatreonMembership}=await import('../worker/patreon.mjs');
const {PATREON_POLICY}=await import('../patreon-policy.mjs');
const user=crypto.randomUUID(),other=crypto.randomUUID(),playerId=crypto.randomUUID(),token=crypto.randomUUID(),hash='a'.repeat(64),secondHash='b'.repeat(64);
const policy=PATREON_POLICY;
const supporterTier=policy.adFreeTierIds.find(id=>!policy.premiumTierIds.includes(id));
const member={memberId:'test-'+user,userId:'provider-'+user,campaignId:policy.campaignId,tierIds:[policy.premiumTierIds[0]],status:'active_patron',lastChargeStatus:'Paid',entitledAmountCents:500};
async function active(provider='patreon'){return Number((await query("SELECT count(*)::int n FROM entitlement_grants WHERE auth_user_id=$1::uuid AND provider=$2 AND revoked_at IS NULL AND expires_at>now()",[user,provider])).rows[0].n);}
async function revision(){return (await query("SELECT sync_revision FROM provider_accounts WHERE auth_user_id=$1::uuid AND provider='patreon'",[user])).rows[0].sync_revision;}
async function activations(){return Number((await query("SELECT count(*)::int n FROM analytics_events WHERE player_id=$1::uuid AND event_name='elite_activated'",[playerId])).rows[0].n);}
async function status(){const response=await growth.fetch(new Request('https://packone.pro/v1/patreon/status',{headers:{'x-pack1-auth-session':token}}));assert.equal(response.status,200);return response.json();}
async function sync(m,rev){return applyPatreonMembership(query,user,member.userId,m,{revision:rev??await revision(),policy});}
try {
  for(const id of [user,other])await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,\'QA Patreon\',$2,true)',[id,`qa-patreon-${id}@example.invalid`]);
  await query('INSERT INTO players(id,display_name) VALUES($1::uuid,$2)',[playerId,'QA Patreon']);
  await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[user,playerId]);
  await query('INSERT INTO neon_auth.session(id,"userId",token,"updatedAt","expiresAt") VALUES($1::uuid,$2::uuid,$3,now(),now()+interval \'1 hour\')',[crypto.randomUUID(),user,token]);
  await query("INSERT INTO provider_oauth_states(state_hash,auth_user_id,provider,expires_at,consumed_at) VALUES($1,$2::uuid,'patreon',now()+interval '10 minutes',now())",[hash,user]);
  assert.equal(await applyPatreonMembership(query,user,member.userId,member,{link:true,oauthStateHash:hash,policy}),true);
  assert.equal(await active(),2);
  assert.equal(await activations(),1,'first authoritative Elite grant emits one server activation');
  assert.equal((await query("SELECT event_props->>'source' source FROM analytics_events WHERE player_id=$1::uuid AND event_name='elite_activated' ORDER BY id DESC LIMIT 1",[playerId])).rows[0].source,'oauth');
  await sync(member);assert.equal(await activations(),1,'steady-state Elite reconciliation does not duplicate activation');
  assert.equal((await status()).membership.effective_state,'elite_entitled');
  await query("INSERT INTO provider_oauth_states(state_hash,auth_user_id,provider,expires_at,consumed_at) VALUES($1,$2::uuid,'patreon',now()+interval '10 minutes',now())",[secondHash,user]);
  assert.equal(await applyPatreonMembership(query,user,'different-provider-identity',member,{link:true,oauthStateHash:secondHash,policy}),false,'OAuth refresh cannot replace an existing Patreon identity');
  assert.equal((await query("SELECT provider_user_id FROM provider_accounts WHERE auth_user_id=$1::uuid AND provider='patreon'",[user])).rows[0].provider_user_id,member.userId);
  await query("INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference,expires_at) VALUES($1::uuid,'custom_corpus','manual','QA',now()+interval '1 day')",[user]);
  await assert.rejects(query("INSERT INTO provider_accounts(auth_user_id,provider,provider_user_id) VALUES($1::uuid,'patreon',$2)",[other,member.userId]));
  await sync({...member,tierIds:[supporterTier]});assert.equal(await active(),0,'Supporter downgrade revokes');
  assert.equal((await status()).membership.effective_state,'active_non_elite');
  await sync({...member,lastChargeStatus:'Refunded'});assert.equal(await active(),0,'Refunded Elite is not entitled');
  assert.equal((await status()).membership.effective_state,'not_entitled');
  await sync({...member,status:'former_patron'});assert.equal(await active(),2,'Still-entitled former patron remains Elite');
  assert.equal(await activations(),2,'downgrade to non-Elite then authoritative upgrade emits a new activation');
  assert.equal((await status()).membership.effective_state,'elite_entitled');
  await sync(member);assert.equal(await active(),2,'Upgrade restores');
  assert.equal(await activations(),2,'remaining Elite does not duplicate the transition event');
  const stale=await revision();await query("UPDATE provider_accounts SET sync_revision=sync_revision+1 WHERE auth_user_id=$1::uuid",[user]);
  assert.equal(await sync(null,stale),false);assert.equal(await active(),2,'Outdated snapshot cannot overwrite current state');
  await sync(null);assert.equal(await active(),0,'Deleted membership revokes');
  await sync(member);assert.equal(await active(),2);
  assert.equal(await activations(),3,'revoked membership becoming Elite again emits a transition');
  await query("UPDATE entitlement_grants SET expires_at=now()-interval '1 second' WHERE auth_user_id=$1::uuid AND provider='patreon'",[user]);
  assert.equal(await active(),0,'Stale access expires');
  await sync(member);
  assert.equal(await activations(),3,'TTL renewal without revocation is not a new Elite activation');
  const response=await growth.fetch(new Request('https://packone.pro/v1/patreon/disconnect',{method:'POST',headers:{'x-pack1-auth-session':token,'content-type':'application/json'},body:'{}'}));
  assert.equal(response.status,200);assert.equal(await active(),0);assert.equal(await active('manual'),1,'Manual grants survive');
  assert.equal(await applyPatreonMembership(query,user,member.userId,member,{link:true,oauthStateHash:hash,policy}),false,'Disconnect cancels an in-flight callback');
  assert.equal(Number((await query('SELECT count(*)::int n FROM neon_auth."user" WHERE id=$1::uuid',[user])).rows[0].n),1);
  console.log('Patreon SQL lifecycle passed: exact tier, authoritative elite_activated transitions, server classification, identity stability, upgrade/downgrade, unique account, stale snapshot, cancellation, expiry, disconnect, manual grant preservation.');
} finally {
  await query("DELETE FROM analytics_events WHERE player_id=$1::uuid",[playerId]);
  await query('DELETE FROM entitlement_grants WHERE auth_user_id IN ($1::uuid,$2::uuid)',[user,other]);
  await query('DELETE FROM neon_auth.session WHERE "userId" IN ($1::uuid,$2::uuid)',[user,other]);
  await query('DELETE FROM neon_auth."user" WHERE id IN ($1::uuid,$2::uuid)',[user,other]);
  await query('DELETE FROM players WHERE id=$1::uuid',[playerId]);
}
