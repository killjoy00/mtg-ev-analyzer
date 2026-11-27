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

// Real database acceptance for both native analytics callers, with a unique
// QA correlation value; the gateway's header scope is tested separately.
const eventTag='qa-native-events-'+crypto.randomUUID();
const telemetry={events:[
  {name:'daily_share_arrival',props:{source:'result_share',daily:true,kind:'dated',set:'latest',context:'ios',session_id:eventTag}},
  {name:'membership_offer_viewed',props:{source:'membership',context:'ios',session_id:eventTag}},
  {name:'elite_activated',props:{session_id:eventTag}},
]};
assert.equal((await call('/v1/events',telemetry,{playerToken:wrong.token})).accepted,2,'guest events remain available; activation is server-only');
assert.equal((await call('/v1/events',telemetry,{playerToken:signed.linked.token,accountToken:signed.session.token})).accepted,2,'signed-in native events accept matching account proof');
await call('/v1/events',telemetry,{playerToken:signed.linked.token,status:401});

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

// A revoked account's durable gameplay token is not an anonymous credential.
const {default:draft}=await import('../worker/draft-run-function.mjs');
const draftCall=(path,token,accountToken,body)=>draft.fetch(new Request('https://packone.pro'+path,{
  method:body===undefined?'GET':'POST',
  headers:{authorization:'Bearer '+token,'content-type':'application/json',...(accountToken?{'x-pack1-mobile-account':accountToken}:{})},
  body:body===undefined?undefined:JSON.stringify(body),
}));
for(const accountToken of [undefined,signed.session.token]){
  assert.equal((await draftCall('/v1/daily-status',signed.linked.token,accountToken)).status,401);
  assert.equal((await draftCall('/v1/runs',signed.linked.token,accountToken,{daily:true})).status,401);
}
assert.equal((await draftCall('/v1/daily-status',wrong.token)).status,200,'unclaimed guest Daily remains available');
await call('/v1/profile/me',undefined,{playerToken:signed.linked.token,status:401});
await call('/v1/profile/history',undefined,{playerToken:signed.linked.token,status:401});

await call('/v1/events',telemetry,{playerToken:signed.linked.token,accountToken:signed.session.token,status:401});

// Simulate an older installation retaining A's player token after sign-out.
// A new sign-in handoff must be bound to the presenting player, but its
// authenticated account must never claim a different account's career.
async function googleFinishFor(accountId,source){
  const flow=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const code=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  await query(`INSERT INTO mobile_oauth_handoffs(
    flow_hash,handoff_hash,guest_player_id,auth_user_id,provider,expires_at,authenticated_at
  ) VALUES($1,$2,$3::uuid,$4::uuid,'google',now()+interval '5 minutes',now())`,
    [digest(flow),digest(code),source.playerId,accountId]);
  return call('/v1/mobile/account/google/finish',{handoffToken:code},{playerToken:source.token});
}
const otherId=crypto.randomUUID();
await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,true)',
  [otherId,'QA other mobile account','qa-mobile-'+otherId+'@example.invalid']);
const switched=await googleFinishFor(otherId,signed.linked);
assert.equal(switched.user.id,otherId);
assert.notEqual(switched.linked.playerId,signed.linked.playerId,'a new account never claims the previous account player');
assert.equal((await draftCall('/v1/daily-status',signed.linked.token,switched.session.token)).status,401,'a live B session cannot use A player');
assert.equal((await draftCall('/v1/daily-status',switched.linked.token,switched.session.token)).status,200);
await call('/v1/profile/me',undefined,{playerToken:signed.linked.token,accountToken:switched.session.token,status:401});

await call('/v1/events',telemetry,{playerToken:signed.linked.token,accountToken:switched.session.token,status:401});
await call('/v1/mobile/account/signout',{},{
  playerToken:switched.linked.token,accountToken:switched.session.token,
});
const returned=await googleFinishFor(userId,switched.linked);
assert.equal(returned.linked.playerId,signed.linked.playerId,'signing back into A restores its original player');
assert.equal(returned.linked.merged,false,'B career was not merged into A');
assert.equal((await query('SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid',[otherId])).rows[0].player_id,switched.linked.playerId);
assert.equal((await call('/v1/mobile/profile/me',undefined,{
  playerToken:returned.linked.token,accountToken:returned.session.token,
})).player.display_name,renamed,'A retains its original profile');
assert.equal((await draftCall('/v1/daily-status',returned.linked.token,returned.session.token)).status,200);
assert.equal((await draftCall('/v1/daily-status',switched.linked.token,returned.session.token)).status,401,'A cannot use B player');

assert.equal((await call('/v1/events',telemetry,{playerToken:returned.linked.token,accountToken:returned.session.token})).accepted,2);
const telemetryRows=(await query(`SELECT player_id,event_name,count(*)::int n
  FROM analytics_events WHERE event_props->>'session_id'=$1
  GROUP BY player_id,event_name ORDER BY player_id,event_name`,[eventTag])).rows;
const expectedTelemetry=[wrong.playerId,signed.linked.playerId].flatMap(player_id=>
  ['daily_share_arrival','membership_offer_viewed'].map(event_name=>({
    player_id,event_name,n:player_id===wrong.playerId?1:2,
  }))).sort((a,b)=>a.player_id.localeCompare(b.player_id)||a.event_name.localeCompare(b.event_name));
assert.deepEqual(telemetryRows.map(row=>({...row,n:Number(row.n)})),expectedTelemetry,'rejected sessions never insert analytics and verified activations remain server-only');
console.log('Native analytics passed: guest, authenticated, revoked, missing, mismatched and recovered account credentials.');
await call('/v1/mobile/account/signout',{},{
  playerToken:returned.linked.token,accountToken:returned.session.token,
});

console.log('Mobile auth passed: guest-bound OAuth, linked native session, rich private/public profile reads, exact player/account binding, cross-account switching, and revocation.');
