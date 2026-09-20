import fs from 'node:fs';
import assert from 'node:assert/strict';
import {digest} from '../worker/account-session.mjs';
if(!process.argv.includes('--dev-fixtures'))throw Error('Use an isolated branch.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query,deleteMobileAccountData}=await import('../worker/growth-function.js');
const growth=(await import('../worker/growth-function.js')).default;
const draft=(await import('../worker/draft-run-function.mjs')).default;
const parse=v=>typeof v==='string'?JSON.parse(v):v;

async function call(service,path,body,{playerToken,accountToken,status=200}={}) {
  const response=await service.fetch(new Request('https://packone.pro'+path,{
    method:body===undefined?'GET':'POST',
    headers:{
      'content-type':'application/json',
      ...(playerToken?{authorization:'Bearer '+playerToken}:{}),
      ...(accountToken?{'x-pack1-mobile-account':accountToken}:{}),
    },
    body:body===undefined?undefined:JSON.stringify(body),
  }));
  const data=await response.json();
  assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`);
  return data;
}

const guest=await call(growth,'/v1/session',{displayName:'QA mobile claim'});
let run=await call(draft,'/v1/runs',{daily:true},{playerToken:guest.token});
while(!run.complete) {
  const payload=parse((await query('SELECT payload FROM draft_run_verified_puzzles WHERE puzzle_id=$1',[run.current.puzzle_id])).rows[0].payload);
  run=await call(draft,`/v1/runs/${run.id}/pick`,{
    revision:run.revision,round:run.answers.length,puzzleId:run.current.puzzle_id,cardId:payload.historical_pick_id,
  },{playerToken:guest.token});
}
assert.equal(run.leaderboard_eligible,false);
const claim=await call(draft,`/v1/runs/${run.id}/claim`,{},{playerToken:guest.token});
assert.match(claim.claimToken,/^[A-Za-z0-9_-]{43}$/);

const userId=crypto.randomUUID();
const accountToken=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const csrf=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const email=`qa-mobile-${userId}@example.invalid`;
await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,true)',[userId,'QA mobile account',email]);
await query(`INSERT INTO account_sessions(session_hash,auth_user_id,csrf_hash,expires_at)
  VALUES($1,$2::uuid,$3,now()+interval '1 hour')`,[digest(accountToken),userId,digest(csrf)]);

const linked=await call(growth,'/v1/mobile/account/link',{claimToken:claim.claimToken},{playerToken:guest.token,accountToken});
assert.equal(linked.validatedDailyScore,true);
assert.equal(linked.playerId,guest.playerId);
assert.match(linked.token,/^p1_/);
const stored=(await query('SELECT leaderboard_eligible,daily_account_id FROM draft_run_sessions WHERE id=$1::uuid',[run.id])).rows[0];
assert.equal(stored.leaderboard_eligible===true||stored.leaderboard_eligible==='t',true);
assert.equal(stored.daily_account_id,userId);
assert.equal((await query(`SELECT count(*) n FROM scores WHERE player_id=$1::uuid AND mode='draft_run' AND challenge_date=$2::date`,[guest.playerId,run.day])).rows[0].n,'1');

await call(growth,'/v1/mobile/account/link',{claimToken:claim.claimToken},{playerToken:linked.token,accountToken,status:409});
const session=await call(growth,'/v1/mobile/account/session',undefined,{playerToken:linked.token,accountToken});
assert.equal(session.user.id,userId);
assert.equal(session.deletion.passwordSupported,false);
await call(growth,'/v1/mobile/account/delete',{password:'irrelevant'},{playerToken:linked.token,accountToken,status:409});
await call(growth,'/v1/mobile/account/signout',{},{playerToken:linked.token,accountToken});
await call(growth,'/v1/mobile/account/session',undefined,{playerToken:linked.token,accountToken,status:401});

const googleHandoff=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
await query(`INSERT INTO mobile_oauth_handoffs(
    flow_hash,handoff_hash,guest_player_id,auth_user_id,provider,expires_at,authenticated_at
  ) VALUES($1,$2,$3::uuid,$4::uuid,'google',now()+interval '5 minutes',now())`,
  [digest('f'.repeat(43)),digest(googleHandoff),guest.playerId,userId]);
const otherGuest=await call(growth,'/v1/session',{displayName:'QA wrong OAuth guest'});
await call(growth,'/v1/mobile/account/google/finish',{handoffToken:googleHandoff},{playerToken:otherGuest.token,status:409});
const googleSession=await call(growth,'/v1/mobile/account/google/finish',{handoffToken:googleHandoff},{playerToken:linked.token});
assert.equal(googleSession.user.id,userId);
assert.match(googleSession.session.token,/^[A-Za-z0-9_-]{43}$/);
await call(growth,'/v1/mobile/account/google/finish',{handoffToken:googleHandoff},{playerToken:linked.token,status:409});
await call(growth,'/v1/mobile/account/session',undefined,{playerToken:linked.token,accountToken:googleSession.session.token});
await call(growth,'/v1/mobile/account/signout',{},{playerToken:linked.token,accountToken:googleSession.session.token});

await query(`INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference)
  VALUES($1::uuid,'custom_corpus','test','mobile-delete')`,[userId]);
assert.equal(await deleteMobileAccountData(userId,guest.playerId,email),true);
for(const [sql,params,label] of [
  ['SELECT count(*) n FROM neon_auth."user" WHERE id=$1::uuid',[userId],'auth user'],
  ['SELECT count(*) n FROM players WHERE id=$1::uuid',[guest.playerId],'player'],
  ['SELECT count(*) n FROM draft_run_sessions WHERE player_id=$1::uuid',[guest.playerId],'draft sessions'],
  ['SELECT count(*) n FROM scores WHERE player_id=$1::uuid',[guest.playerId],'scores'],
  ['SELECT count(*) n FROM analytics_events WHERE player_id=$1::uuid',[guest.playerId],'analytics'],
  ['SELECT count(*) n FROM entitlement_grants WHERE auth_user_id=$1::uuid',[userId],'entitlements'],
  ['SELECT count(*) n FROM account_sessions WHERE auth_user_id=$1::uuid',[userId],'Pack One account sessions'],
]) {
  assert.equal((await query(sql,params)).rows[0].n,'0',label+' should be deleted');
}

console.log('Mobile auth passed: revocable native account session, guest-bound one-use run claim, Google OAuth handoff finish, ranked promotion, signout, and full account-data deletion.');
