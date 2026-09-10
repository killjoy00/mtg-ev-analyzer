// Explicit integration gate against an isolated Neon development branch.
// Usage: node tests/draft-run-backend-smoke.mjs /path/to/dev.connection --dev-fixtures
import fs from 'node:fs';
import assert from 'node:assert/strict';
if(!process.argv.includes('--dev-fixtures'))throw new Error('Use an isolated development database and --dev-fixtures.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {default:growth,query,gameDateKey}=await import('../worker/growth-function.js');
const {default:runApi}=await import('../worker/draft-run-function.mjs');
const tag=crypto.randomUUID().slice(0,8),timings=[];
const httpPrefix=process.env.PACK1_QA_FUNCTION_PREFIX;
if(httpPrefix&&!/^https:\/\/br-[a-z0-9-]+-$/.test(httpPrefix))throw new Error('Invalid development function prefix');
async function call(service,path,body,token,status=200,extra={}) {
  const started=performance.now();
  const url=httpPrefix?httpPrefix+(service===growth?'pack1growth':'draftrunapi')+'.compute.c-5.us-east-2.aws.neon.tech'+path:'https://magic.planitnow.us'+path;
  const request=new Request(url,{method:extra.method||(body===undefined?'GET':'POST'),headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...extra.headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  const r=await(httpPrefix?fetch(request):service.fetch(request));
  const data=await r.json();timings.push({path,ms:Math.round(performance.now()-started)});
  assert.equal(r.status,status,`${path}: ${JSON.stringify(data)}`);return data;
}
const guest=await call(growth,'/v1/session',{displayName:'QA guest '+tag});
const owner=await call(growth,'/v1/session',{displayName:'QA owner '+tag});
console.log('Created isolated guest and owner fixtures',tag);
let original=await call(runApi,'/v1/runs',{daily:true},owner.token);
let duplicate=await call(runApi,'/v1/runs',{daily:true},guest.token);
let s=await call(runApi,'/v1/runs',{},guest.token);
const initial=s.current.puzzle_id;
const req={revision:s.revision,round:0,puzzleId:initial,type:'pack'};
const concurrent=await Promise.all([call(runApi,`/v1/runs/${s.id}/reroll`,req,guest.token).catch(e=>e),call(runApi,`/v1/runs/${s.id}/reroll`,req,guest.token).catch(e=>e)]);
assert.equal(concurrent.filter(r=>!(r instanceof Error)).length,1,'Only one concurrent reroll can commit');
assert.match(concurrent.find(r=>r instanceof Error).message,/409|another tab|already/);
s=await call(runApi,`/v1/runs/${s.id}`,undefined,guest.token);
assert.equal(s.rerolls.pack,0);assert.notEqual(s.current.puzzle_id,initial);
for(let round=0;round<10;round++) {
  const body={revision:s.revision,round,puzzleId:s.current.puzzle_id,cardId:s.current.candidates[0].id};
  const other=s.current.candidates[1].id;
  s=await call(runApi,`/v1/runs/${s.id}/pick`,body,guest.token);
  assert.equal((await call(runApi,`/v1/runs/${s.id}/pick`,body,guest.token)).revision,s.revision);
  await call(runApi,`/v1/runs/${s.id}/pick`,{...body,cardId:other},guest.token,409);
  console.log('Locked decision and retries verified',round+1);
}
assert.equal(s.complete,true);
await call(growth,'/v1/results',{mode:'draft_run',score:100,clientResultId:'forged-'+tag},guest.token,403);
const privateProfile=await call(growth,'/v1/profile/me',undefined,guest.token);
assert.equal(privateProfile.player.profile_public,false);
await call(growth,'/v1/profile/'+privateProfile.player.profile_key,undefined,undefined,404);
await call(growth,'/v1/profile',{profilePublic:true},guest.token,403,{method:'PATCH'});

// Controlled auth fixtures exercise the real session/link/merge path without email delivery.
const authId=crypto.randomUUID(),authToken=crypto.randomUUID()+crypto.randomUUID();
await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[authId,'QA owner '+tag,`qa-${tag}@example.invalid`]);
await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()+interval \'1 hour\',now())',[authToken,authId]);
const authHeaders={'x-pack1-auth-session':authToken};
// Even an unfinished established Daily takes priority over a guest's finished score.
await query("INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade) VALUES($1::uuid,$2::date,'mixed','draft_run',100,'A')",[guest.playerId,gameDateKey()]);
await call(growth,'/v1/account/link',{},owner.token,200,{headers:authHeaders});
const linked=await call(growth,'/v1/account/link',{},guest.token,200,{headers:authHeaders});
assert.equal(linked.token,owner.token);
const resumed=await call(runApi,'/v1/runs',{daily:true},owner.token);assert.equal(resumed.id,original.id);
assert.equal((await query("SELECT count(*) n FROM scores WHERE player_id=$1::uuid AND challenge_date=$2::date AND mode='draft_run'",[owner.playerId,gameDateKey()])).rows[0].n,'0');
const transferred=await call(runApi,`/v1/runs/${duplicate.id}`,undefined,owner.token);assert.equal(transferred.day,null);
assert.equal((await call(runApi,`/v1/runs/${s.id}`,undefined,owner.token)).complete,true);
await call(runApi,`/v1/runs/${s.id}`,undefined,guest.token,404);
const history=await call(growth,'/v1/profile/me',undefined,owner.token);
assert.equal(history.summary.games,1);assert.ok(history.by_set.length>=9);
assert.equal(history.player.profile_key,(await call(growth,'/v1/profile/me',undefined,owner.token)).player.profile_key);
await call(growth,'/v1/profile',{profilePublic:true},owner.token,200,{method:'PATCH'});
const publicProfile=await call(growth,'/v1/profile/'+history.player.profile_key);
assert.doesNotMatch(JSON.stringify(publicProfile),/auth_user_id|player_id|@example|token|email|claimed/);
await call(growth,'/v1/profile',{profilePublic:false},owner.token,200,{method:'PATCH'});
await call(growth,'/v1/profile/'+history.player.profile_key,undefined,undefined,404);
console.log('Account merge, Daily priority and public profile privacy verified');

// Ties count people, and old qualifying results still earn milestones beyond the UI's 120 rows.
const board='qa-'+tag,peers=[];
for(let i=0;i<9;i++)peers.push(crypto.randomUUID());
await query('INSERT INTO players(id,display_name) SELECT value::uuid,$2 FROM jsonb_array_elements_text($1::jsonb)',[JSON.stringify(peers),'QA tie '+tag]);
await query("INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade) SELECT p.id::uuid,$2::date-1,$3,'top3',p.score,'B' FROM jsonb_to_recordset($1::jsonb)p(id text,score int)",[JSON.stringify([owner.playerId,...peers].map((id,i)=>({id,score:[90,95,95,90,90,90,10,10,10,10][i]}))),gameDateKey(),board]);
let p=await call(growth,'/v1/profile/me',undefined,owner.token),finish=p.daily_history.find(r=>r.set_id===board);
assert.equal(finish.rank,3);assert.equal(finish.percentile,60);assert.equal(finish.final,true);
const old=board+'old';
await query("INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade) SELECT p.id::uuid,$2::date-500,$3,'top3',p.score,'B' FROM jsonb_to_recordset($1::jsonb)p(id text,score int)",[JSON.stringify([owner.playerId,...peers].map((id,i)=>({id,score:i?50:90}))),gameDateKey(),old]);
await query("INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade) SELECT $1::uuid,$2::date-n,$3,'full',40,'D' FROM generate_series(2,125) n",[owner.playerId,gameDateKey(),board]);
p=await call(growth,'/v1/profile/me',undefined,owner.token);assert.equal(p.daily_history.length,120);assert.equal(p.best_final_percentile,10);assert.ok(p.achievements.find(a=>a.id==='top10').unlocked);
const achievementsBefore=(await query("SELECT count(*) n FROM analytics_events WHERE player_id=$1::uuid AND event_name='achievement_unlocked'",[owner.playerId])).rows[0].n;
await call(growth,'/v1/profile/me',undefined,owner.token);
assert.equal((await query("SELECT count(*) n FROM analytics_events WHERE player_id=$1::uuid AND event_name='achievement_unlocked'",[owner.playerId])).rows[0].n,achievementsBefore);
const analytics=(await query("SELECT event_name,count(*) n FROM analytics_events WHERE player_id=$1::uuid AND event_name IN('account_claimed','public_profile_enabled') GROUP BY event_name",[owner.playerId])).rows;
assert.ok(analytics.every(r=>Number(r.n)===1));assert.equal(analytics.length,2);
await query('SELECT * FROM analytics_retention_cohorts LIMIT 1');await query('SELECT * FROM analytics_daily_next_day_retention LIMIT 1');
fs.mkdirSync('generated/review',{recursive:true});fs.writeFileSync('generated/review/backend-timings.json',JSON.stringify(timings,null,2));
console.log('Passed real database: concurrent writes, ten locked picks, retries, forged score rejection, guest privacy, account claim, merge, Daily conflicts, environment transfer, public opt-in, percentile ties, old milestones, event idempotency and funnel queries.');
