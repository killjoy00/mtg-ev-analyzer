// Pure HTTP release gate for Actions: two disposable guest practice runs, no SQL credentials.
import assert from 'node:assert/strict';
const base=process.argv[2]?.replace(/\/$/,'');
if(!/^https:\/\/br-(twilight-hill-ayffyd2b|orange-feather-ayps8kep)-draftrunapi\.compute\.c-5\.us-east-2\.aws\.neon\.tech$/.test(base))throw Error('Unexpected backend');
async function call(path,body,token){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});const d=await r.json();assert.equal(r.status,200,`${path}: ${JSON.stringify(d)}`);return d;}
const health=await call('/health');assert.equal(health.sets,33);assert.equal(health.expansion_sets,32);assert.ok(health.puzzles>20000);
const guest=await call('/v1/session',{displayName:'Import check'});
for(const environment of ['mixed','powered-cube']) {
  let s=await call('/v1/runs',{environment},guest.token);
  assert.equal(s.current.pick_number,environment==='mixed'?1:2);
  for(const type of environment==='mixed'?['set','pack']:['pack','pack']) {
    const old=s.current.puzzle_id;
    s=await call(`/v1/runs/${s.id}/reroll`,{revision:s.revision,round:s.round-1,puzzleId:old,type},guest.token);
    assert.notEqual(s.current.puzzle_id,old);
  }
  for(let round=0;round<10;round++) {
    const p=s.current;assert.equal(p.prior_picks.length,p.pick_number-1);
    assert.equal(p.historical_pick_id,undefined);assert.ok(p.candidates.every(c=>c.model_probability===undefined));
    assert.ok([...p.candidates,...p.prior_picks].every(c=>c.image_url?.startsWith('https://')));
    s=await call(`/v1/runs/${s.id}/pick`,{revision:s.revision,round,puzzleId:p.puzzle_id,cardId:p.candidates[0].id},guest.token);
  }
  assert.equal(s.complete,true);assert.equal(s.answers.length,10);
  console.log(environment,'practice start, rerolls, ten picks and completion passed');
}
console.log(JSON.stringify(health));
