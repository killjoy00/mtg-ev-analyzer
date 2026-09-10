// Integration gate: isolated Neon development branch only.
// Usage: node tests/cube-run-backend-smoke.mjs /path/to/dev.connection --dev-fixtures
import fs from 'node:fs';
import assert from 'node:assert/strict';
if(!process.argv.includes('--dev-fixtures'))throw new Error('An isolated development branch is required.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {default:growth,query,gameDateKey}=await import('../worker/growth-function.js');
const {default:runApi}=await import('../worker/draft-run-function.mjs');
const prefix=process.env.PACK1_QA_FUNCTION_PREFIX;
const tag=crypto.randomUUID().slice(0,8);
async function call(service,path,body,token,status=200,headers={}) {
  const url=prefix?prefix+(service===growth?'pack1growth':'draftrunapi')+'.compute.c-5.us-east-2.aws.neon.tech'+path:'https://magic.planitnow.us'+path;
  const request=new Request(url,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  const response=await(prefix?fetch(request):service.fetch(request));
  const result=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(result)}`);return result;
}
const guest=await call(growth,'/v1/session',{displayName:'QA Cube '+tag});
const owner=await call(growth,'/v1/session',{displayName:'QA Cube owner '+tag});
const mixed=await call(runApi,'/v1/runs',{daily:true},owner.token);
const ownerCube=await call(runApi,'/v1/runs',{daily:true,environment:'powered-cube'},owner.token);
assert.notEqual(mixed.id,ownerCube.id);assert.equal(mixed.current.pick_number,1);
assert.notEqual(mixed.current.set_id,'powered-cube');assert.equal(ownerCube.current.pick_number,2);
const duplicate=await call(runApi,'/v1/runs',{daily:true,environment:'powered-cube'},guest.token);
assert.equal(duplicate.current.puzzle_id,ownerCube.current.puzzle_id);
let run=await call(runApi,'/v1/runs',{environment:'powered-cube'},guest.token);
assert.deepEqual(run.rerolls,{set:0,pack:2});assert.equal(run.current.prior_picks.length,1);
const action=type=>({revision:run.revision,round:run.answers.length,puzzleId:run.current.puzzle_id,type});
await call(runApi,`/v1/runs/${run.id}/reroll`,action('set'),guest.token,400);
for(let i=0;i<2;i++){
  const old=run.current.puzzle_id;
  run=await call(runApi,`/v1/runs/${run.id}/reroll`,action('pack'),guest.token);
  assert.equal(run.rerolls.pack,1-i);assert.equal(run.current.set_id,'powered-cube');assert.notEqual(run.current.puzzle_id,old);
}
await call(runApi,`/v1/runs/${run.id}/reroll`,action('pack'),guest.token,409);
for(let round=0;round<10;round++){
  const p=run.current;assert.equal(p.set_id,'powered-cube');assert.equal(p.prior_picks.length,p.pick_number-1);
  assert.doesNotMatch(JSON.stringify(p),/historical_pick|model_probability|source_draft/);
  const historical=(await query("SELECT payload->>'historical_pick_id' id FROM draft_run_verified_puzzles WHERE puzzle_id=$1",[p.puzzle_id])).rows[0].id;
  const body={revision:run.revision,round,puzzleId:p.puzzle_id,cardId:historical};
  run=await call(runApi,`/v1/runs/${run.id}/pick`,body,guest.token);
  assert.equal(run.answers.at(-1).score,100);
  if(round===9)assert.equal((await call(runApi,`/v1/runs/${run.id}/pick`,body,guest.token)).score,100);
}
assert.equal(run.complete,true);assert.equal(run.score,100);
const stored=(await query('SELECT puzzle_ids,seen_sources FROM draft_run_sessions WHERE id=$1::uuid',[run.id])).rows[0];
const unpack=v=>typeof v==='string'?JSON.parse(v):v;
assert.equal(unpack(stored.puzzle_ids).length,10);assert.equal(new Set(unpack(stored.seen_sources)).size,12);
const share=await call(runApi,`/v1/runs/${run.id}/share`,{},guest.token);
const invitation=await call(runApi,`/v1/challenges/${share.id}`);
assert.equal(invitation.environment,'powered-cube');
const friend=await call(runApi,'/v1/runs',{challenge:share.id,environment:'mixed'},owner.token);
assert.equal(friend.environment,'powered-cube');assert.equal(friend.comparison.exact,true);
const first=run.answers[0].puzzle;assert.equal(friend.current.puzzle_id,first.puzzle_id);
const rerolledFriend=await call(runApi,`/v1/runs/${friend.id}/reroll`,{revision:friend.revision,round:0,puzzleId:friend.current.puzzle_id,type:'pack'},owner.token);
assert.equal(rerolledFriend.comparison.exact,false);assert.equal(rerolledFriend.current.set_id,'powered-cube');

// Merge simultaneous Dailies independently; an unfinished target Cube wins.
const authId=crypto.randomUUID(),authToken=crypto.randomUUID()+crypto.randomUUID();
await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[authId,'QA Cube owner '+tag,`qa-cube-${tag}@example.invalid`]);
await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()+interval \'1 hour\',now())',[authToken,authId]);
const auth={'x-pack1-auth-session':authToken};
await query("INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json) VALUES($1::uuid,$2::date,'powered-cube','draft_run',100,'A','[]'::jsonb)",[guest.playerId,gameDateKey()]);
await call(growth,'/v1/account/link',{},owner.token,200,auth);
await call(growth,'/v1/account/link',{},guest.token,200,auth);
assert.equal((await call(runApi,'/v1/runs',{daily:true},owner.token)).id,mixed.id);
assert.equal((await call(runApi,'/v1/runs',{daily:true,environment:'powered-cube'},owner.token)).id,ownerCube.id);
assert.equal((await call(runApi,`/v1/runs/${duplicate.id}`,undefined,owner.token)).day,null);
const profile=await call(growth,'/v1/profile/me',undefined,owner.token);
assert.equal(profile.summary.games,1);assert.equal(profile.cube.games,1);assert.equal(profile.cube.average_score,100);
assert.equal(profile.by_mode.find(m=>m.mode==='cube').games,1);
assert.equal((await query("SELECT count(*) n FROM scores WHERE player_id=$1::uuid AND mode='draft_run'",[owner.playerId])).rows[0].n,'0');
assert.equal((await query("SELECT count(*) n FROM analytics_events WHERE player_id=$1::uuid AND event_name='cube_completed'",[owner.playerId])).rows[0].n,'1');
const board=await call(runApi,'/v1/leaderboard?period=all&environment=powered-cube');
assert.equal(board.environment,'powered-cube');
await call(runApi,'/v1/runs',{environment:'neo'},owner.token,400);
console.log('Cube HTTP/database regression passed: 10 trophy picks, both pack rerolls, environment isolation, Daily separation, same-pack sharing, retries, career attribution and account-merge priority.');
