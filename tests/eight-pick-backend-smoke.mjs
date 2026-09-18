// Destructive schedule fixtures: disposable development branch only.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadLiveSetMetadata} from '../worker/draft-run-selection.mjs';
import {liveRegularSets} from '../daily-selection.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {gradeDraftRunPick,publicDraftRunPuzzle} from '../draft-run.mjs';
if(!process.argv.includes('--dev-fixtures'))throw Error('Requires an isolated database and --dev-fixtures.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query,gameDateKey}=await import('../worker/growth-function.js');
const {default:api}=await import('../worker/draft-run-function.mjs');
const day=gameDateKey(),parse=v=>typeof v==='string'?JSON.parse(v):v;
async function call(path,body,token,status=200) {
  const r=await api.fetch(new Request('https://packone.pro'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)}));
  const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;
}
const guest=()=>call('/v1/session',{displayName:'QA eight '+crypto.randomUUID().slice(0,6)});
const stored=async id=>(await query('SELECT * FROM draft_run_sessions WHERE id=$1::uuid',[id])).rows[0];
const payloads=async ids=>{
  const rows=(await query('SELECT puzzle_id,payload FROM draft_run_verified_puzzles WHERE puzzle_id IN (SELECT jsonb_array_elements_text($1::jsonb))',[JSON.stringify(ids)])).rows;
  return ids.map(id=>parse(rows.find(p=>p.puzzle_id===id).payload));
};

// Seed today's fixture from a real historical schedule. Keep its original IDs.
const legacy=(await query("SELECT * FROM draft_run_schedules WHERE environment='mixed' AND jsonb_array_length(puzzle_ids)=10 ORDER BY day DESC LIMIT 1")).rows[0];
assert.ok(legacy,'A historical ten-pick schedule is required for the compatibility gate.');
await query("DELETE FROM draft_run_schedules WHERE day=$1::date AND environment='mixed'",[day]);
await query("INSERT INTO draft_run_schedules(day,environment,corpus_version,puzzle_ids,difficulty_version,selection_version) VALUES($1::date,'mixed',$2,$3::jsonb,$4,$5)",[day,legacy.corpus_version,JSON.stringify(parse(legacy.puzzle_ids)),legacy.difficulty_version,legacy.selection_version]);
const oldOwner=await guest();
let old=await call('/v1/runs',{daily:true,qa:true},oldOwner.token);
assert.equal(old.run_length,10);assert.equal(old.selection_version,legacy.selection_version);
assert.equal((await stored(old.id)).seed,`daily:mixed:${day}:${legacy.corpus_version}:${legacy.selection_version}`);
assert.deepEqual(parse((await stored(old.id)).puzzle_ids),parse(legacy.puzzle_ids));

// New schedules use eight decisions and freeze their guaranteed release list.
await query("DELETE FROM draft_run_schedules WHERE day=$1::date AND environment='mixed'",[day]);
const owner=await guest();
let run=await call('/v1/runs',{daily:true,qa:true},owner.token);
assert.equal(run.run_length,8);assert.deepEqual(run.daily_featured_sets,liveRegularSets(await loadLiveSetMetadata(query,DRAFT_RUN_CORPUS_VERSION),day).slice(0,4).map(s=>s.set_id));
const initial=await payloads(parse((await stored(run.id)).puzzle_ids));
assert.equal(new Set(initial.map(p=>p.source_draft_hash)).size,8);
assert.ok(initial.filter(p=>p.set_id===run.daily_featured_sets[0]).length>=2);
assert.ok(initial.filter(p=>run.daily_featured_sets.slice(1).includes(p.set_id)).length>=4);
const peer=await guest(),same=await call('/v1/runs',{daily:true,qa:true},peer.token);
assert.deepEqual(parse((await stored(same.id)).puzzle_ids),parse((await stored(run.id)).puzzle_ids));
for(let round=0;round<8;round++) {
  const request=()=>({revision:run.revision,round,puzzleId:run.current.puzzle_id});
  assert.equal(run.set_reroll_allowed,false);
  for(const type of ['set','pack'])await call(`/v1/runs/${run.id}/reroll`,{...request(),type},owner.token,409);
  const [p]=await payloads([run.current.puzzle_id]);
  const pick={...request(),cardId:p.historical_pick_id};
  run=await call(`/v1/runs/${run.id}/pick`,pick,owner.token);
  assert.equal(run.complete,round===7);
  if(round===7)assert.equal((await call(`/v1/runs/${run.id}/pick`,pick,owner.token)).score,100);
}
assert.equal(run.score,100);

const measurements=(await query('SELECT run_complete,likely_abandoned,is_qa FROM draft_run_measurements WHERE session_id=$1::uuid',[run.id])).rows;
assert.ok(measurements.length>=8);assert.ok(measurements.every(r=>r.run_complete==='t'&&r.likely_abandoned==='f'&&r.is_qa==='t'));
assert.equal((await call('/v1/runs',{daily:true},owner.token)).id,run.id);

// A reserved historical run survives a new schedule, completes at ten and shares ten.
old=await call('/v1/runs',{daily:true},oldOwner.token);assert.equal(old.run_length,10);
const prior=await payloads(parse((await stored(old.id)).puzzle_ids));
const answers=prior.slice(0,9).map(p=>({...gradeDraftRunPick(p,p.historical_pick_id),puzzle:publicDraftRunPuzzle(p)}));
await query('UPDATE draft_run_sessions SET answers=$2::jsonb,revision=9 WHERE id=$1::uuid',[old.id,JSON.stringify(answers)]);
old=await call(`/v1/runs/${old.id}`,undefined,oldOwner.token);assert.equal(old.complete,false);
old=await call(`/v1/runs/${old.id}/pick`,{revision:old.revision,round:9,puzzleId:old.current.puzzle_id,cardId:prior[9].historical_pick_id},oldOwner.token);
assert.equal(old.complete,true);assert.equal(old.score,100);assert.equal(old.answers.length,10);
for(const [result,user] of [[run,owner],[old,oldOwner]]) {
  const shared=await call(`/v1/runs/${result.id}/share`,{},user.token);
  assert.equal(shared.daily,true);assert.equal(shared.id,undefined);
}
console.log('Eight-pick Daily quotas, no rerolls, scoring, measurements, retries, first attempts and historical ten-pick completion passed.');
