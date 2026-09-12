// Pure HTTP release gate for Actions: two disposable guest practice runs, no SQL credentials.
import assert from 'node:assert/strict';
import { DRAFT_RUN_DIFFICULTY_VERSION } from '../draft-run-difficulty.mjs';
import {DRAFT_RUN_SELECTION_VERSION} from '../draft-run-policy.mjs';
const base=process.argv[2]?.replace(/\/$/,'');
if(!/^https:\/\/br-(twilight-hill-ayffyd2b|orange-feather-ayps8kep)-draftrunapi\.compute\.c-5\.us-east-2\.aws\.neon\.tech$/.test(base))throw Error('Unexpected backend');
async function call(path,body,token){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});const d=await r.json();assert.equal(r.status,200,`${path}: ${JSON.stringify(d)}`);return d;}
const health=await call('/health');assert.equal(health.sets,33);assert.equal(health.expansion_sets,32);assert.ok(health.puzzles>20000);
const guest=await call('/v1/session',{displayName:'Import check'});
for(const environment of ['mixed','powered-cube']) {
  let s=await call('/v1/runs',{environment,qa:true},guest.token);
  assert.equal(s.difficulty_version,DRAFT_RUN_DIFFICULTY_VERSION);
  assert.equal(s.selection_version,DRAFT_RUN_SELECTION_VERSION);
  assert.equal(s.current.pick_number,environment==='mixed'?1:2);
  const anchor=s.current.difficulty;
  for(const type of environment==='mixed'?['set','pack']:['pack','pack']) {
    const old=s.current.puzzle_id;
    const before=s.current.difficulty;
    s=await call(`/v1/runs/${s.id}/reroll`,{revision:s.revision,round:s.round-1,puzzleId:old,type},guest.token);
    assert.notEqual(s.current.puzzle_id,old);
    assert.equal(s.current.difficulty.band,anchor.band);
    assert.ok(Math.abs(s.current.difficulty.rating-anchor.rating)<=10);
    assert.ok(Math.abs(s.current.difficulty.rating-before.rating)<=10);
  }
  const bands={easy:0,medium:0,hard:0};
  for(let round=0;round<10;round++) {
    const p=s.current;assert.equal(p.prior_picks.length,p.pick_number-1);
    assert.equal(p.difficulty.version,DRAFT_RUN_DIFFICULTY_VERSION);
    assert.equal(p.pack_number,1);
    assert.ok(p.pick_number<=(environment==='mixed'?10:11));
    if(environment==='mixed')assert.ok(!['hbg','sir','pio'].includes(p.set_id));
    if(round>=6)assert.notEqual(p.difficulty.band,'easy');
    if(round>=8)assert.ok(p.pick_number>=(environment==='mixed'?8:9));
    bands[p.difficulty.band]++;
    assert.equal(p.historical_pick_id,undefined);assert.ok(p.candidates.every(c=>c.model_probability===undefined));
    assert.ok([...p.candidates,...p.prior_picks].every(c=>c.image_url?.startsWith('https://')));
    s=await call(`/v1/runs/${s.id}/pick`,{revision:s.revision,round,puzzleId:p.puzzle_id,cardId:p.candidates[0].id},guest.token);
  }
  assert.equal(s.complete,true);assert.equal(s.answers.length,10);
  assert.ok(bands.easy<=1);assert.equal(bands.hard,3);assert.equal(bands.medium,7-bands.easy);
  assert.equal(s.answers.slice(6).filter(a=>a.puzzle.difficulty.band==='hard').length,2);
  const invitation=await call(`/v1/runs/${s.id}/share`,{},guest.token);
  const friend=await call('/v1/runs',{challenge:invitation.id},guest.token);
  assert.equal(friend.difficulty_version,s.difficulty_version);
  assert.equal(friend.current.puzzle_id,s.answers[0].puzzle.puzzle_id);
  assert.deepEqual(friend.current.difficulty,s.answers[0].puzzle.difficulty);
  console.log(environment,'practice start, rerolls, ten picks and completion passed');
}
console.log(JSON.stringify(health));
