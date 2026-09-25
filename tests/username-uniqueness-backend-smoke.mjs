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
const {default:growth,query,gameDateKey}=await import('../worker/growth-function.js');
const {default:legacy}=await import('../worker/index.js');
const {default:draftRun}=await import('../worker/draft-run-function.mjs');
const {linkedPlayerIdentity}=await import('../worker/account-identity.mjs');
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
  const link=await call(growth,'/v1/account/link',{},session.token,200,{headers:auth.headers});
  return {...session,auth,link};
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
assert.deepEqual(contender.link.rankingIdentity,{eligible:false,reason:'username_taken'},
  'linking reports why this account is not rank-eligible');
assert.equal(await linkedPlayerIdentity(query,contender.playerId),null,
  'an unowned collision is linked but is not a public ranked identity');
const attentionProfile=await call(growth,'/v1/profile/me',undefined,contender.token,200);
assert.equal(attentionProfile.player.username_owned,false,'My Pack One receives the persistent attention state');
const attentionStatus=await call(draftRun,'/v1/daily-status',undefined,contender.token,200);
assert.deepEqual(attentionStatus.ranking_identity,{eligible:false,reason:'username_taken'},
  'Daily home receives an explicit username reason rather than treating the account as a guest');
const conflictEvents=await query(
  "SELECT count(*) n FROM analytics_events WHERE player_id=$1::uuid AND event_name='username_ownership_conflict'",
  [contender.playerId],
);
assert.equal(Number(conflictEvents.rows[0].n),1,'the collision emits one structured admin-observable event');

// Recreate the original bug directly: both linked players have the same stored
// nickname, but only the legitimate owner may surface on public leaderboards.
const today=gameDateKey();
for(const [playerId,score] of [[first.playerId,91],[contender.playerId,89]]) {
  await query(
    `INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json,details_json,is_featured)
     VALUES($1::uuid,$2::date,'mixed','draft_run',$3::int,'A','[]'::jsonb,'{}'::jsonb,true)
     ON CONFLICT(player_id,challenge_date,set_id,mode) DO NOTHING`,
    [playerId,today,score],
  );
}
const draftBoard=await call(draftRun,'/v1/leaderboard?period=all&environment=mixed',undefined,null,200);
assert.equal(draftBoard.rows.filter(row=>row.display_name===username).length,1,
  'Draft Run exposes the owned username exactly once');

const legacySet=`q${tag}`;
for(const [playerId,score] of [[first.playerId,91],[contender.playerId,89]]) {
  await query(
    `INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json,details_json,is_featured)
     VALUES($1::uuid,$2::date,$3,'top3',$4::int,'A','[]'::jsonb,'{}'::jsonb,true)
     ON CONFLICT(player_id,challenge_date,set_id,mode) DO NOTHING`,
    [playerId,today,legacySet,score],
  );
}
const legacyBoard=await call(legacy,`/v1/leaderboard?period=all&set=${legacySet}&mode=top3`,undefined,null,200);
assert.equal(legacyBoard.filter(row=>row.display_name===username).length,1,
  'the legacy board also exposes the owned username exactly once');

// Public challenge attribution follows the same boundary. A guest/local
// nickname may still be duplicated, but it is presented generically to others.
const challengePayload={
  setId:legacySet,setName:'QA',
  pack:[
    {id:`a-${tag}`,name:'A',model_probability:0.6,image_url:''},
    {id:`b-${tag}`,name:'B',model_probability:0.3,image_url:''},
    {id:`c-${tag}`,name:'C',model_probability:0.1,image_url:''},
  ],
  historicalId:`a-${tag}`,
  selectedIds:[`a-${tag}`,`b-${tag}`,`c-${tag}`],
  displayName:username,
};
const genericShare=await call(legacy,'/v1/challenges',challengePayload,contender.token,200);
assert.equal(genericShare.displayName,'A friend','an unowned nickname is not public share attribution');
const loadedGenericShare=await call(legacy,`/v1/challenges/${genericShare.id}`,undefined,null,200);
assert.equal(loadedGenericShare.creator.displayName,'A friend');

assert.equal((await rename(contender,username,409)).error,USERNAME_TAKEN_MESSAGE,
  'and the duplicate cannot be taken later either');
const resolvedName=`Erin ${tag}`;
assert.equal((await rename(contender,resolvedName)).player.display_name,resolvedName,'renaming resolves the collision');
assert.equal(await owned(contender.playerId),true);
assert.equal((await linkedPlayerIdentity(query,contender.playerId)).display_name,resolvedName,
  'the renamed account becomes a public ranked identity');
const resolvedStatus=await call(draftRun,'/v1/daily-status',undefined,contender.token,200);
assert.deepEqual(resolvedStatus.ranking_identity,{eligible:true,reason:null},
  'the Daily warning clears immediately after a successful rename');

const renamedDraftBoard=await call(draftRun,'/v1/leaderboard?period=all&environment=mixed',undefined,null,200);
assert.ok(renamedDraftBoard.rows.some(row=>row.display_name===resolvedName),
  'the existing Draft Run score becomes visible under the newly owned username');
const renamedLegacyBoard=await call(legacy,`/v1/leaderboard?period=all&set=${legacySet}&mode=top3`,undefined,null,200);
assert.ok(renamedLegacyBoard.some(row=>row.display_name===resolvedName),
  'the existing legacy score becomes visible under the newly owned username');

const ownedShare=await call(legacy,'/v1/challenges',{...challengePayload,displayName:resolvedName},contender.token,200);
assert.equal(ownedShare.displayName,resolvedName,'an owned username may be public share attribution');
console.log('Linked collisions stay private until renamed',tag);

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
