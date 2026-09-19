import fs from 'node:fs';
import assert from 'node:assert/strict';
if(!process.argv.includes('--dev-fixtures'))throw Error('Requires --dev-fixtures and an isolated development connection.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
delete process.env.PATREON_CLIENT_ID;delete process.env.PATREON_CLIENT_SECRET;delete process.env.PATREON_WEBHOOK_SECRET;
const {query}=await import('../worker/growth-function.js');
const {default:growth}=await import('../worker/growth-function.js');
const user=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID(),reference='member-'+crypto.randomUUID();
async function call(path,body,status=200,headers={}){
  const request=new Request('https://packone.pro'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-pack1-auth-session':token,...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const response=await growth.fetch(request),data=await response.json();
  assert.equal(response.status,status,JSON.stringify(data));return data;
}
try{
  await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,true)',[user,'QA Patreon',`qa-patreon-${user}@example.invalid`]);
  await query('INSERT INTO neon_auth.session(id,"userId",token,"updatedAt","expiresAt") VALUES($1::uuid,$2::uuid,$3,now(),now()+interval \'1 hour\')',[crypto.randomUUID(),user,token]);
  let status=await call('/v1/patreon/status');
  assert.equal(status.connected,false);assert.deepEqual(status.capabilities,[]);

  await query(`INSERT INTO provider_accounts(auth_user_id,provider,provider_user_id,provider_member_id,provider_campaign_id,membership_status,currently_entitled_amount_cents)
    VALUES($1::uuid,'patreon',$2,$3,'campaign-fixture','active_patron',500)`,[user,'patreon-user-'+user,reference]);
  await query(`INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference)
    VALUES($1::uuid,'custom_corpus','patreon',$2),($1::uuid,'unlimited_cube_practice','patreon',$2)`,[user,reference]);
  status=await call('/v1/patreon/status');
  assert.equal(status.connected,true);assert.equal(status.membership.status,'active_patron');
  assert.deepEqual(status.capabilities,['custom_corpus','unlimited_cube_practice']);

  await call('/v1/patreon/webhook',{},503,{'x-patreon-event':'members:update','x-patreon-signature':'0'.repeat(32)});
  await call('/v1/patreon/disconnect',{});
  status=await call('/v1/patreon/status');
  assert.equal(status.connected,false);assert.deepEqual(status.capabilities,[]);
  const revoked=(await query("SELECT count(*)::int n FROM entitlement_grants WHERE auth_user_id=$1::uuid AND provider='patreon' AND revoked_at IS NOT NULL",[user])).rows[0];
  assert.equal(Number(revoked.n),2);
  console.log('Patreon backend smoke passed: account status, provider linkage, capability visibility, fail-closed webhook and disconnect revocation.');
}finally{
  await query("DELETE FROM entitlement_grants WHERE auth_user_id=$1::uuid AND provider='patreon'",[user]);
  await query('DELETE FROM neon_auth.session WHERE "userId"=$1::uuid',[user]);
  await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[user]);
}
