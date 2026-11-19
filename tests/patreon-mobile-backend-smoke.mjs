import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import growth,{query} from '../worker/growth-function.js';
import {issueAccountSession} from '../worker/account-session.mjs';

if(!process.argv.includes('--dev-fixtures'))throw Error('Requires an isolated fixture database.');
const account=crypto.randomUUID(),otherAccount=crypto.randomUUID();
const player=crypto.randomUUID(),otherPlayer=crypto.randomUUID();
let accountSession;
const secret=(await query("SELECT value FROM settings WHERE key='player_secret'")).rows[0].value;
const playerToken=id=>`p1_${id}.${createHmac('sha256',secret).update(id).digest('base64url')}`;
async function call(action,{method='GET',body={confirm:true},owner=player,token=accountSession.token,extra={},status=200}={}) {
  const response=await growth.fetch(new Request('https://packone.pro/v1/patreon/mobile/'+action,{
    method,headers:{authorization:'Bearer '+playerToken(owner),'x-pack1-mobile-account':token,'content-type':'application/json',...extra},
    ...(method==='POST'?{body:JSON.stringify(body)}:{}),
  }));
  const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
}
try {
  for(const [user,owner] of [[account,player],[otherAccount,otherPlayer]]) {
    await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,true)',[user,'QA Native Patreon',`qa-native-patreon-${user}@example.invalid`]);
    await query('INSERT INTO players(id,display_name) VALUES($1::uuid,$2)',[owner,'QA Native Patreon']);
    await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[user,owner]);
  }
  accountSession=await issueAccountSession(query,{user_id:account});
  for(const capability of ['custom_corpus','unlimited_cube_practice']) {
    await query("INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference,expires_at) VALUES($1::uuid,$2,'manual',$3,now()+interval '1 day')",[account,capability,'QA-'+account]);
  }
  let status=await call('status');
  assert.equal(status.connected,false);
  assert.deepEqual(status.capabilities,[]);
  assert.ok(status.account_capabilities.includes('custom_corpus'));
  assert.ok(status.account_capabilities.includes('unlimited_cube_practice'));
  assert.equal(status.account_user_id,account);
  assert.equal(status.player_id,player);
  assert.equal(Object.hasOwn(status,'support_url'),false);
  await call('status',{owner:otherPlayer,status:401});
  await call('status',{token:randomBytes(32).toString('base64url'),status:401});
  await call('status',{extra:{cookie:'__Host-pack1_account='+accountSession.token},status:401});

  await query("INSERT INTO provider_accounts(auth_user_id,provider,provider_user_id,last_synced_at) VALUES($1::uuid,'patreon',$2,now())",[account,'qa-native-'+account]);
  await query("INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference,expires_at) VALUES($1::uuid,'custom_corpus','patreon',$2,now()-interval '1 second')",[account,'expired-'+account]);
  await query("INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference,revoked_at,expires_at) VALUES($1::uuid,'unlimited_cube_practice','patreon',$2,now(),now()+interval '1 day')",[account,'revoked-'+account]);
  status=await call('status');
  assert.equal(status.connected,true);
  assert.deepEqual(status.capabilities,[],'expired and revoked Patreon grants are not current access');
  assert.ok(status.account_capabilities.includes('custom_corpus'),'manual access is still active');

  await call('refresh',{method:'POST',body:{},status:400});
  const refresh=await call('refresh',{method:'POST'});
  assert.equal(refresh.requested,true);
  assert.equal((await call('status')).membership.sync_pending,true);
  await query("INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference,expires_at) VALUES($1::uuid,'custom_corpus','patreon',$2,now()+interval '1 day')",[account,'active-'+account]);
  await query("INSERT INTO provider_oauth_states(state_hash,auth_user_id,provider,expires_at) VALUES($1,$2::uuid,'patreon',now()+interval '10 minutes')",[randomBytes(32).toString('hex'),account]);
  await call('disconnect',{method:'POST'});
  status=await call('status');
  assert.equal(status.connected,false);
  assert.deepEqual(status.capabilities,[]);
  assert.ok(status.account_capabilities.includes('custom_corpus'));
  assert.ok(status.account_capabilities.includes('unlimited_cube_practice'));
  assert.equal(Number((await query("SELECT count(*) n FROM entitlement_grants WHERE auth_user_id=$1::uuid AND provider='manual' AND revoked_at IS NULL",[account])).rows[0].n),2);
  assert.equal(Number((await query("SELECT count(*) n FROM provider_oauth_states WHERE auth_user_id=$1::uuid",[account])).rows[0].n),0);
  await call('refresh',{method:'POST',status:409});
  await query('UPDATE account_sessions SET revoked_at=now() WHERE auth_user_id=$1::uuid',[account]);
  await call('status',{status:401});
  console.log('Native Patreon SQL fixture passed: exact identity, manual grants, expired/revoked grants, pending refresh, Patreon-only disconnect, OAuth cancellation and revoked sessions.');
} finally {
  await query('DELETE FROM account_sessions WHERE auth_user_id IN ($1::uuid,$2::uuid)',[account,otherAccount]);
  await query('DELETE FROM entitlement_grants WHERE auth_user_id IN ($1::uuid,$2::uuid)',[account,otherAccount]);
  await query('DELETE FROM provider_oauth_states WHERE auth_user_id IN ($1::uuid,$2::uuid)',[account,otherAccount]);
  await query('DELETE FROM provider_accounts WHERE auth_user_id IN ($1::uuid,$2::uuid)',[account,otherAccount]);
  await query('DELETE FROM account_links WHERE auth_user_id IN ($1::uuid,$2::uuid)',[account,otherAccount]);
  await query('DELETE FROM neon_auth."user" WHERE id IN ($1::uuid,$2::uuid)',[account,otherAccount]);
  await query('DELETE FROM players WHERE id IN ($1::uuid,$2::uuid)',[player,otherPlayer]);
}
