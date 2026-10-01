import fs from 'node:fs';
import assert from 'node:assert/strict';
import {digest} from '../worker/account-session.mjs';

if(!process.argv.includes('--dev-fixtures'))throw Error('Use an isolated branch.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();

const {query}=await import('../worker/growth-function.js');
const growth=(await import('../worker/growth-function.js')).default;

async function call(path,body,{playerToken,accountToken,status=200,method}={}) {
  const response=await growth.fetch(new Request('https://packone.pro'+path,{
    method:method||(body===undefined?'GET':'POST'),
    headers:{
      ...(body===undefined?{}:{'content-type':'application/json'}),
      ...(playerToken?{authorization:'Bearer '+playerToken}:{}),
      ...(accountToken?{'x-pack1-mobile-account':accountToken}:{}),
    },
    body:body===undefined?undefined:JSON.stringify(body),
  }));
  const data=await response.json();
  assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`);
  return data;
}

const guest=await call('/v1/session',{displayName:'QA mobile auth'});
assert.match(guest.token,/^p1_/);

const userId=crypto.randomUUID();
const email=`qa-mobile-${userId}@example.invalid`;
await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,true)',[
  userId,'QA mobile account',email,
]);

const handoff=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
await query(`INSERT INTO mobile_oauth_handoffs(
    flow_hash,handoff_hash,guest_player_id,auth_user_id,provider,expires_at,authenticated_at
  ) VALUES($1,$2,$3::uuid,$4::uuid,'google',now()+interval '5 minutes',now())`,[
  digest('f'.repeat(43)),digest(handoff),guest.playerId,userId,
]);

const wrong=await call('/v1/session',{displayName:'QA wrong mobile auth'});
await call('/v1/mobile/account/google/finish',{handoffToken:handoff},{
  playerToken:wrong.token,status:409,
});

const signed=await call('/v1/mobile/account/google/finish',{handoffToken:handoff},{
  playerToken:guest.token,
});
assert.equal(signed.user.id,userId);
assert.match(signed.session.token,/^[A-Za-z0-9_-]{43}$/);
assert.equal(signed.linked.playerId,guest.playerId);
assert.match(signed.linked.token,/^p1_/);
assert.equal((await query('SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid',[userId])).rows[0].player_id,guest.playerId);

await call('/v1/mobile/account/google/finish',{handoffToken:handoff},{
  playerToken:guest.token,status:409,
});

const session=await call('/v1/mobile/account/session',undefined,{
  playerToken:signed.linked.token,accountToken:signed.session.token,
});
assert.equal(session.user.id,userId);
assert.equal(session.credentials.google,false);

await call('/v1/mobile/account/session',undefined,{
  playerToken:wrong.token,accountToken:signed.session.token,status:401,
});

const profile=await call('/v1/mobile/profile/me',undefined,{
  playerToken:signed.linked.token,accountToken:signed.session.token,
});
assert.equal(profile.player.claimed,true);
assert.equal(typeof profile.player.display_name,'string');
assert.ok(Array.isArray(profile.achievements));
assert.ok(Array.isArray(profile.best_environments));
assert.ok(Array.isArray(profile.daily_history));
assert.equal(typeof profile.environment_total,'number');

const renamed='Mobile '+userId.slice(0,8);
const updatedProfile=await call('/v1/mobile/profile',{
  displayName:renamed,
  profilePublic:true,
},{playerToken:signed.linked.token,accountToken:signed.session.token,method:'PATCH'});
assert.equal(updatedProfile.player.display_name,renamed);
assert.equal(updatedProfile.player.profile_public,true);
assert.equal(updatedProfile.player.username_owned,true);

await call('/v1/mobile/account/password-change',{
  currentPassword:'not-a-password',
  newPassword:'different-password',
},{playerToken:signed.linked.token,accountToken:signed.session.token,status:409});


const publicProfile=await call('/v1/mobile/profile/'+updatedProfile.player.profile_key,undefined,{
  playerToken:signed.linked.token,
});
assert.equal(publicProfile.player.display_name,renamed);
assert.equal(publicProfile.player.claimed,undefined);

const history=await call('/v1/mobile/profile/history?limit=5',undefined,{
  playerToken:signed.linked.token,accountToken:signed.session.token,
});
assert.ok(Array.isArray(history.rows));
assert.ok(history.rows.length<=5);

await call('/v1/mobile/profile/me',undefined,{
  playerToken:wrong.token,accountToken:signed.session.token,status:401,
});

await call('/v1/mobile/account/signout',{},{
  playerToken:signed.linked.token,accountToken:signed.session.token,
});
await call('/v1/mobile/account/session',undefined,{
  playerToken:signed.linked.token,accountToken:signed.session.token,status:401,
});

console.log('Mobile auth passed: guest-bound OAuth, linked native session, rich private/public profile reads, exact player/account binding, and revocation.');
