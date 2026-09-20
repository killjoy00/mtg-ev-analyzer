import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
if(!process.argv.includes('--dev-fixtures'))throw Error('Use a disposable branch.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
process.env.PACK1_ALLOW_LOCALHOST='1';
const {default:growth,query}=await import('../worker/growth-function.js');

const tag=crypto.randomUUID().slice(0,8);
const authId=crypto.randomUUID(),legacyAuth=crypto.randomUUID()+crypto.randomUUID();
const origin='https://packone.pro';
const json=async(response,status=200)=>{const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;};
const cookies=response=>response.headers.getSetCookie?.()||[response.headers.get('set-cookie')].filter(Boolean);
const value=(lines,name)=>{
  const line=lines.find(row=>row.startsWith(name+'='));
  assert.ok(line,'Missing '+name);
  return decodeURIComponent(line.slice(name.length+1).split(';')[0]);
};
const cookieHeader=(account,csrf,player)=>[
  account&&'__Host-pack1_account='+encodeURIComponent(account),
  csrf&&'__Secure-pack1_csrf='+encodeURIComponent(csrf),
  player&&'__Host-pack1_player='+encodeURIComponent(player),
].filter(Boolean).join('; ');

const legacyPlayer=await json(await growth.fetch(new Request('https://packone.pro/v1/session',{
  method:'POST',headers:{'content-type':'application/json',origin},
  body:JSON.stringify({displayName:'QA secure '+tag}),
})));
await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,true)',[authId,'QA Secure '+tag,'qa-secure-'+tag+'@example.invalid']);
await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()+interval \'1 hour\',now())',[legacyAuth,authId]);

const migratedResponse=await growth.fetch(new Request('https://packone.pro/v1/account/migrate',{
  method:'POST',
  headers:{origin,'content-type':'application/json',authorization:'Bearer '+legacyPlayer.token,'x-pack1-auth-session':legacyAuth},
  body:'{}',
}));
const migrated=await json(migratedResponse);
assert.equal(migrated.migrated,true);
assert.equal(migrated.user.id,authId);
const set=cookies(migratedResponse);
const account=value(set,'__Host-pack1_account'),csrf=value(set,'__Secure-pack1_csrf');
assert.match(account,/^[A-Za-z0-9_-]{43}$/);
assert.match(csrf,/^[A-Za-z0-9_-]{43}$/);
assert.equal(Number((await query('SELECT count(*) n FROM neon_auth.session WHERE token=$1',[legacyAuth])).rows[0].n),0,'legacy Neon session consumed');
const stored=(await query('SELECT session_hash,csrf_hash FROM account_sessions WHERE auth_user_id=$1::uuid AND revoked_at IS NULL',[authId])).rows[0];
assert.equal(stored.session_hash,createHash('sha256').update(account).digest('hex'));
assert.equal(stored.csrf_hash,createHash('sha256').update(csrf).digest('hex'));
assert.notEqual(stored.session_hash,account);

const session=await json(await growth.fetch(new Request('https://packone.pro/v1/account/session',{
  headers:{origin,cookie:cookieHeader(account,csrf)},
})));
assert.equal(session.user.id,authId);
assert.equal(session.session.token,undefined,'browser account token never returns in JSON');

const denied=await growth.fetch(new Request('https://packone.pro/v1/account/link-browser',{
  method:'POST',
  headers:{origin,'content-type':'application/json',authorization:'Bearer '+legacyPlayer.token,cookie:cookieHeader(account,csrf)},
  body:'{}',
}));
await json(denied,403);

const linkedResponse=await growth.fetch(new Request('https://packone.pro/v1/account/link-browser',{
  method:'POST',
  headers:{origin,'content-type':'application/json',authorization:'Bearer '+legacyPlayer.token,cookie:cookieHeader(account,csrf),'x-pack1-csrf':csrf},
  body:'{}',
}));
const linked=await json(linkedResponse);
assert.equal(linked.token,undefined,'browser link never exposes player bearer');
const linkedCookies=cookies(linkedResponse);
const rotated=value(linkedCookies,'__Host-pack1_account'),rotatedCsrf=value(linkedCookies,'__Secure-pack1_csrf'),player=value(linkedCookies,'__Host-pack1_player');
assert.notEqual(rotated,account,'account session rotates on account linking');
assert.match(player,/^p1_/);
assert.equal((await growth.fetch(new Request('https://packone.pro/v1/account/session',{headers:{origin,cookie:cookieHeader(account,csrf,player)}}))).status,401,'rotated account session is revoked');

const profileDenied=await growth.fetch(new Request('https://packone.pro/v1/profile',{
  method:'PATCH',
  headers:{origin,'content-type':'application/json',authorization:'Bearer '+player,cookie:cookieHeader(rotated,rotatedCsrf,player)},
  body:JSON.stringify({displayName:'QA Secure Changed'}),
}));
assert.equal(profileDenied.status,403);
await json(await growth.fetch(new Request('https://packone.pro/v1/profile',{
  method:'PATCH',
  headers:{origin,'content-type':'application/json',authorization:'Bearer '+player,cookie:cookieHeader(rotated,rotatedCsrf,player),'x-pack1-csrf':rotatedCsrf},
  body:JSON.stringify({displayName:'QA Secure Changed'}),
})));

const signout=await growth.fetch(new Request('https://packone.pro/v1/account/signout',{
  method:'POST',
  headers:{origin,'content-type':'application/json',cookie:cookieHeader(rotated,rotatedCsrf,player),'x-pack1-csrf':rotatedCsrf},
  body:'{}',
}));
await json(signout);
assert.ok(cookies(signout).some(row=>row.startsWith('__Host-pack1_account=')&&/Max-Age=0/.test(row)));
assert.ok(cookies(signout).some(row=>row.startsWith('__Host-pack1_player=')&&/Max-Age=0/.test(row)));
assert.equal((await growth.fetch(new Request('https://packone.pro/v1/account/session',{headers:{origin,cookie:cookieHeader(rotated,rotatedCsrf)}}))).status,401);

await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[authId]);
console.log('First-party account session migration, CSRF, rotation, no-token JSON and sign-out passed.');
