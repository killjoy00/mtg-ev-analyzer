// Explicit integration gate against an isolated Neon development branch.
// Usage: node tests/username-uniqueness-backend-smoke.mjs /path/to/dev.connection --dev-fixtures
//
// Proves the acceptance contract for owned usernames against real Postgres:
// the unique index is the authority, comparison ignores case and whitespace,
// the generic placeholder stays shareable, and identity linking and merging
// neither steal an established name nor raise an unhandled constraint error.
import fs from 'node:fs';
import assert from 'node:assert/strict';
if(!process.argv.includes('--dev-fixtures'))throw new Error('Use an isolated development database and --dev-fixtures.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {default:growth,query}=await import('../worker/growth-function.js');
const {default:legacy}=await import('../worker/index.js');
const {USERNAME_TAKEN_MESSAGE}=await import('../worker/username.mjs');

const tag=crypto.randomUUID().slice(0,8);
const origin='https://packone.pro';

async function call(service,path,body,token,status=200,extra={}) {
  const request=new Request('https://packone.pro'+path,{
    method:extra.method||(body===undefined?'GET':'POST'),
    headers:{'content-type':'application/json',origin,...(token?{authorization:'Bearer '+token}:{}),...extra.headers},
    body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(45000),
  });
  const response=await service.fetch(request);
  const data=await response.json();
  assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`);
  return data;
}

const guest=(displayName)=>call(growth,'/v1/session',{displayName});
const stored=async(playerId)=>(await query('SELECT display_name,username_owned FROM players WHERE id=$1::uuid',[playerId])).rows[0];
const owned=async(playerId)=>{const row=await stored(playerId);return row.username_owned===true||row.username_owned==='t';};

// An authenticated owner: a forged Auth identity plus the legacy session header
// exercises the real link, merge and profile paths without email delivery.
async function account(label) {
  const authId=crypto.randomUUID(),authToken=crypto.randomUUID()+crypto.randomUUID();
  await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,true)',
    [authId,`QA ${label} ${tag}`,`qa-username-${label}-${tag}@example.invalid`]);
  await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()+interval \'1 hour\',now())',
    [authToken,authId]);
  return {authId,headers:{'x-pack1-auth-session':authToken}};
}

const rename=(player,displayName,status=200)=>
  call(growth,'/v1/profile',{displayName},player.token,status,{method:'PATCH',headers:player.auth.headers});

async function claim(label,displayName) {
  const session=await guest(displayName);
  const auth=await account(label);
  await call(growth,'/v1/account/link',{},session.token,200,{headers:auth.headers});
  return {...session,auth};
}

// ---------------------------------------------------------------------------
// Multiple default players keep the generic placeholder.
// ---------------------------------------------------------------------------
const defaults=[await guest('Pack Player'),await guest('Pack Player'),await guest('PACK PLAYER')];
const defaultRows=await query(
  `SELECT count(*) n FROM players WHERE id=ANY($1::uuid[]) AND pack1_username_key(display_name)='pack player'`,
  [`{${defaults.map((row)=>row.playerId).join(',')}}`]);
assert.equal(Number(defaultRows.rows[0].n),3,'every default player may hold the placeholder');
for(const row of defaults)assert.equal(await owned(row.playerId),false,'the placeholder is never owned');
console.log('Placeholder players coexist',tag);

// ---------------------------------------------------------------------------
// A first custom username succeeds and is owned; duplicates are rejected.
// ---------------------------------------------------------------------------
const first=await claim('first','Pack Player');
const second=await claim('second','Pack Player');
const username=`Ryan ${tag}`;

const named=await rename(first,username);
assert.equal(named.player.display_name,username);
assert.equal(await owned(first.playerId),true,'a chosen username is owned');

for(const attempt of [username,username.toLowerCase(),username.toUpperCase(),`  Ryan   ${tag} `]) {
  const denied=await rename(second,attempt,409);
  assert.equal(denied.error,USERNAME_TAKEN_MESSAGE);
  assert.equal(denied.error,'That username is already taken.');
  assert.doesNotMatch(JSON.stringify(denied),/duplicate key|unique constraint|players_username_uq|23505|pg/i,
    'a Postgres constraint error must never reach the caller');
}
console.log('Exact, case-insensitive and whitespace duplicates rejected',tag);

// A genuinely different username succeeds, and renaming onto a taken one fails.
const distinct=`Bob ${tag}`;
assert.equal((await rename(second,distinct)).player.display_name,distinct);
assert.equal(await owned(second.playerId),true);
assert.equal((await rename(second,username,409)).error,USERNAME_TAKEN_MESSAGE);
assert.equal((await stored(second.playerId)).display_name,distinct,'a rejected rename changes nothing');
assert.equal((await stored(first.playerId)).display_name,username,'the established owner keeps the name');
console.log('Distinct username accepted and cross-player rename refused',tag);

// Reverting to the placeholder releases the name for somebody else to take.
await rename(second,'Pack Player');
assert.equal(await owned(second.playerId),false,'reverting releases the reservation');
const third=await claim('third','Pack Player');
assert.equal((await rename(third,distinct)).player.display_name,distinct,'a released username becomes available');
console.log('Released username is reclaimable',tag);

// ---------------------------------------------------------------------------
// The index, not the application, is the authority.
// ---------------------------------------------------------------------------
await assert.rejects(
  query('UPDATE players SET username_owned=true WHERE id=$1::uuid',
    [(await guest(username.toUpperCase())).playerId]),
  (error)=>error.pgCode==='23505',
  'Postgres refuses a duplicate owned username even when the application is bypassed');
console.log('Database-level uniqueness verified',tag);

// ---------------------------------------------------------------------------
// Guest nicknames stay non-unique, and never overwrite an owned username.
// ---------------------------------------------------------------------------
const nickname=await guest(username);
assert.equal((await stored(nickname.playerId)).display_name,username,'an anonymous nickname may repeat an owned name');
assert.equal(await owned(nickname.playerId),false);

const replayed=await call(legacy,'/v1/player',{displayName:`Stale ${tag}`},first.token,200,{method:'PATCH'});
assert.equal(replayed.displayName,username,'a replayed localStorage nickname cannot rewrite an owned username');
assert.equal((await stored(first.playerId)).display_name,username);
console.log('Owned usernames survive legacy nickname writes',tag);

// ---------------------------------------------------------------------------
// Identity linking and merging still work.
// ---------------------------------------------------------------------------
// A merge adopts a free source name onto a target still holding the placeholder.
const adoptable=`Carol ${tag}`;
const adoptSource=await guest(adoptable);
const adoptTarget=await claim('adopt','Pack Player');
const adopted=await call(growth,'/v1/account/link',{},adoptSource.token,200,{headers:adoptTarget.auth.headers});
assert.equal(adopted.token,adoptTarget.token,'the established account player survives the merge');
assert.equal(adopted.displayName,adoptable);
assert.equal((await stored(adoptTarget.playerId)).display_name,adoptable);
assert.equal(await owned(adoptTarget.playerId),true,'an adopted username is owned by the target');
assert.equal(Number((await query('SELECT count(*) n FROM players WHERE id=$1::uuid',[adoptSource.playerId])).rows[0].n),0);
console.log('Merge adopts a free source username',tag);

// A merge whose source name belongs to somebody else must not steal it, and
// must not raise a constraint error: linking has to keep working.
const stealSource=await guest(username);
const stealTarget=await claim('steal','Pack Player');
const blocked=await call(growth,'/v1/account/link',{},stealSource.token,200,{headers:stealTarget.auth.headers});
assert.equal(blocked.token,stealTarget.token);
assert.equal((await stored(stealTarget.playerId)).display_name,'Pack Player','a taken username is never adopted');
assert.equal(await owned(stealTarget.playerId),false);
assert.equal((await stored(first.playerId)).display_name,username,'the legitimate owner is untouched');
assert.equal(await owned(first.playerId),true);
console.log('Merge refuses to steal an owned username',tag);

// Claiming an account takes ownership of the nickname the browser already used,
// but only when it is free. A taken one links successfully and stays unowned.
const freeNickname=`Dana ${tag}`;
const adopter=await claim('adopter',freeNickname);
assert.equal(await owned(adopter.playerId),true,'linking reserves a free nickname');
assert.equal((await stored(adopter.playerId)).display_name,freeNickname);

const contender=await claim('contender',username);
assert.equal((await stored(contender.playerId)).display_name,username,'linking never fails over a taken nickname');
assert.equal(await owned(contender.playerId),false,'a taken nickname is not reserved');
assert.equal((await rename(contender,username,409)).error,USERNAME_TAKEN_MESSAGE,
  'and it cannot be taken later either');
assert.equal((await rename(contender,`Erin ${tag}`)).player.display_name,`Erin ${tag}`,'renaming resolves the collision');
assert.equal(await owned(contender.playerId),true);
console.log('Account claim reserves only a free username',tag);

// ---------------------------------------------------------------------------
// Concurrency: the constraint, not a preflight check, decides.
// ---------------------------------------------------------------------------
const racers=[await claim('race-a','Pack Player'),await claim('race-b','Pack Player')];
const contested=`Zoe ${tag}`;
const race=await Promise.all(racers.map(async(player)=>{
  const response=await growth.fetch(new Request('https://packone.pro/v1/profile',{
    method:'PATCH',
    headers:{'content-type':'application/json',origin,authorization:'Bearer '+player.token,...player.auth.headers},
    body:JSON.stringify({displayName:contested}),
  }));
  return {status:response.status,body:await response.json()};
}));
for(const result of race) {
  assert.ok([200,409].includes(result.status),`a contested rename answers cleanly, got ${result.status}: ${JSON.stringify(result.body)}`);
  if(result.status===409)assert.equal(result.body.error,USERNAME_TAKEN_MESSAGE);
}
const winners=await query(
  `SELECT count(*) n FROM players WHERE username_owned AND pack1_username_key(display_name)=pack1_username_key($1)`,[contested]);
assert.equal(Number(winners.rows[0].n),1,'exactly one player owns a contested username');
console.log('Concurrent claims resolve to a single owner',tag);

console.log('Username uniqueness verified end to end',tag);
