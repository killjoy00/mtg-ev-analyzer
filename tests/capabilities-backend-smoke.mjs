import fs from 'node:fs';
import {SERVING_POLICY_VERSION} from '../serving-quality.mjs';
import assert from 'node:assert/strict';
if(!process.argv.includes('--dev-fixtures'))throw Error('Use an isolated branch.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query}=await import('../worker/growth-function.js');
const {default:api}=await import('../worker/draft-run-function.mjs');
const parse=v=>typeof v==='string'?JSON.parse(v):v;
async function call(path,body,user={},status=200){
  const r=await api.fetch(new Request('https://packone.pro'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(user.token?{authorization:'Bearer '+user.token}:{}),...(user.auth?{'x-pack1-auth-session':user.auth}:{})},body:body===undefined?undefined:JSON.stringify(body)}));
  const data=await r.json();assert.equal(r.status,status,`${path}: ${JSON.stringify(data)}`);return data;
}
async function account(){
  const id=crypto.randomUUID(),auth=crypto.randomUUID()+crypto.randomUUID();
  const user=await call('/v1/session',{displayName:'QA capabilities '+id.slice(0,6)});
  await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[id,'QA capabilities',`qa-caps-${id}@example.invalid`]);
  await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()+interval \'1 hour\',now())',[auth,id]);
  await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[id,user.playerId]);
  return {...user,id,auth};
}
const anonymous=await call('/v1/session',{displayName:'QA anonymous caps'});
assert.deepEqual((await call('/v1/capabilities',undefined,anonymous)).capabilities,[]);
await call('/v1/runs',{},anonymous,403);
await call('/v1/runs',{environment:'powered-cube'},anonymous,403);
const user=await account();
assert.deepEqual((await call('/v1/capabilities',undefined,user)).capabilities,['account','unlimited_regular_practice']);
// A player bearer, forged capability list, and an expired managed session do not grant practice.
await call('/v1/runs',{capabilities:['unlimited_regular_practice']},{token:user.token},403);
await call('/v1/runs',{}, {...user,auth:'not-a-session'},401);
let run=await call('/v1/runs',{},user);
assert.equal(run.serving_policy_version,SERVING_POLICY_VERSION);assert.equal(run.run_length,8);assert.equal(run.day,null);
assert.notEqual((await call('/v1/runs',{},user)).id,run.id,'Free account practice has no daily reservation');
await call('/v1/runs',{environment:'powered-cube'},user,403);
await call('/v1/runs',{setIds:['hob']},user,403);
await call('/v1/practice-sets',undefined,user,403);
await query("INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference) VALUES($1::uuid,'unlimited_cube_practice','test','current'),($1::uuid,'custom_corpus','test','current')",[user.id]);
assert.equal((await call('/v1/runs',{environment:'powered-cube'},user)).environment,'powered-cube');
const {sets}=await call('/v1/practice-sets',undefined,user);
// These retained Live archives omit complete P1P1 packs; they remain useful
// in mixed runs but must not be advertised as complete custom-set runs.
for(const id of ['ecl','tla','tmt']){
 assert.ok(!sets.some(s=>s.set_id===id));
 await call('/v1/runs',{setIds:[id]},user,400);
}
for(const n of [1,2,3,4]){
  const ids=sets.slice(0,n).map(s=>s.set_id),custom=await call('/v1/runs',{setIds:ids},user);
  const stored=(await query('SELECT puzzle_ids FROM draft_run_sessions WHERE id=$1::uuid',[custom.id])).rows[0];
  const selected=(await query('SELECT set_id,source_draft_hash FROM draft_run_verified_puzzles WHERE puzzle_id IN (SELECT jsonb_array_elements_text($1::jsonb))',[JSON.stringify(parse(stored.puzzle_ids))])).rows;
  const counts=ids.map(id=>selected.filter(s=>s.set_id===id).length);
  assert.equal(selected.length,8);assert.equal(new Set(selected.map(s=>s.source_draft_hash)).size,8);
  assert.ok(Math.max(...counts)-Math.min(...counts)<=1);assert.deepEqual(custom.rerolls,{set:0,pack:2});
}
await call('/v1/runs',{setIds:['not-live']},user,400);
await call('/v1/runs',{daily:true,setIds:[sets[0].set_id]},user,400);
await query("UPDATE entitlement_grants SET expires_at=now()-interval '1 minute' WHERE auth_user_id=$1::uuid AND capability='unlimited_cube_practice'",[user.id]);
await query("UPDATE entitlement_grants SET revoked_at=now() WHERE auth_user_id=$1::uuid AND capability='custom_corpus'",[user.id]);
await call('/v1/runs',{environment:'powered-cube'},user,403);
await call('/v1/runs',{setIds:[sets[0].set_id]},user,403);
async function finish(s,owner){
  while(!s.complete){const p=parse((await query('SELECT payload FROM draft_run_verified_puzzles WHERE puzzle_id=$1',[s.current.puzzle_id])).rows[0].payload);
    s=await call(`/v1/runs/${s.id}/pick`,{revision:s.revision,round:s.round-1,puzzleId:s.current.puzzle_id,cardId:p.historical_pick_id},owner);
  }return s;
}
run=await finish(run,user);
const shared=await call(`/v1/runs/${run.id}/share`,{},user),peer=await account();
assert.equal((await call(`/v1/runs/${run.id}/share`,{},user)).id,shared.id);
let replay=await call('/v1/runs',{challenge:shared.id},peer);
assert.equal(replay.serving_policy_version,run.serving_policy_version);assert.deepEqual(replay.rerolls,{set:0,pack:0});assert.equal(replay.comparison.exact,true);
assert.equal(replay.current.puzzle_id,run.answers[0].puzzle.puzzle_id);
await call(`/v1/runs/${replay.id}/reroll`,{revision:replay.revision,round:0,puzzleId:replay.current.puzzle_id,type:'pack'},peer,409);
replay=await finish(replay,peer);
assert.equal((await call(`/v1/runs/${replay.id}/share`,{},peer)).id,shared.id,'Sharing a replay preserves the original run identity');
assert.equal((await call('/v1/shared-runs/'+shared.id)).scores.length,2);
console.log('Capabilities passed: authoritative identity, unlimited regular practice, future grants, revocation, balanced custom sets and stable shared decisions/scores.');
