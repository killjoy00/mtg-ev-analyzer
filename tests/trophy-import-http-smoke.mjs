// Pure HTTP release gate for Actions: two disposable guest practice runs, no SQL credentials.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import { DRAFT_RUN_DIFFICULTY_VERSION } from '../draft-run-difficulty.mjs';
import {DRAFT_RUN_SELECTION_VERSION,DRAFT_RUN_LENGTH,SELECTABLE_ONLY_SETS,maxRunPick} from '../draft-run-policy.mjs';
import {eligiblePickForRound} from '../draft-run.mjs';
import catalog from '../corpus/draft-run/catalog.json' with {type:'json'};
export async function verifyTrophyImport(base,{fetcher=fetch,log=console.log}={}) {
base=base?.replace(/\/$/,'');
if(!/^https:\/\/br-(twilight-hill-ayffyd2b|orange-feather-ayps8kep)-draftrunapi\.compute\.c-5\.us-east-2\.aws\.neon\.tech$/.test(base))throw Error('Unexpected backend');
async function call(path,body,token){const r=await fetcher(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});const d=await r.json();assert.equal(r.status,200,`${path}: ${JSON.stringify(d)}`);return d;}
function assertPrivatePuzzle(p){
  assert.equal(p.difficulty,undefined);
  assert.equal(p.historical_pick_id,undefined);
  assert.ok(p.candidates.every(c=>c.model_probability===undefined));
}
const health=await call('/health');assert.equal(health.sets,catalog.sets.length);assert.equal(health.expansion_sets,catalog.sets.filter(s=>s.id!=='powered-cube').length);assert.ok(health.puzzles>20000);
const guest=await call('/v1/session',{displayName:'Import check'});
const friendGuest=await call('/v1/session',{displayName:'Import check peer'});
for(const environment of ['mixed','powered-cube']) {
  let s=await call('/v1/runs',{environment,qa:true},guest.token);
  assert.equal(s.difficulty_version,DRAFT_RUN_DIFFICULTY_VERSION);
  assert.equal(s.selection_version,DRAFT_RUN_SELECTION_VERSION);
  assert.equal(s.run_length,DRAFT_RUN_LENGTH);
  assert.equal(s.current.pick_number,environment==='mixed'?1:2);
  assertPrivatePuzzle(s.current);
  for(const type of environment==='mixed'?['set','pack']:['pack','pack']) {
    const old=s.current.puzzle_id;
    s=await call(`/v1/runs/${s.id}/reroll`,{revision:s.revision,round:s.round-1,puzzleId:old,type},guest.token);
    assert.notEqual(s.current.puzzle_id,old);
    assertPrivatePuzzle(s.current);
  }
  for(let round=0;round<DRAFT_RUN_LENGTH;round++) {
    const p=s.current;assert.equal(p.prior_picks.length,p.pick_number-1);
    assert.equal(p.pack_number,1);
    assert.ok(p.pick_number<=maxRunPick(environment));
    if(environment==='mixed')assert.ok(!SELECTABLE_ONLY_SETS.has(p.set_id));
    else assert.equal(p.set_id,'powered-cube');
    assert.ok(eligiblePickForRound(round,p.pick_number,environment,s.selection_version));
    assertPrivatePuzzle(p);
    assert.ok([...p.candidates,...p.prior_picks].every(c=>c.image_url?.startsWith('https://')));
    s=await call(`/v1/runs/${s.id}/pick`,{revision:s.revision,round,puzzleId:p.puzzle_id,cardId:p.candidates[0].id},guest.token);
    assert.equal(s.complete,round===DRAFT_RUN_LENGTH-1);
  }
  assert.equal(s.complete,true);assert.equal(s.answers.length,DRAFT_RUN_LENGTH);
  assert.equal(s.score,Math.round(s.answers.reduce((sum,a)=>sum+a.score,0)/DRAFT_RUN_LENGTH));
  assert.ok(s.answers.every(a=>a.puzzle.difficulty===undefined));
  const invitation=await call(`/v1/runs/${s.id}/share`,{},guest.token);
  const friend=await call('/v1/runs',{challenge:invitation.id,qa:true},friendGuest.token);
  assert.equal(friend.run_length,DRAFT_RUN_LENGTH);
  assert.equal(friend.difficulty_version,s.difficulty_version);
  assert.equal(friend.current.puzzle_id,s.answers[0].puzzle.puzzle_id);
  assertPrivatePuzzle(friend.current);
  log(environment,`practice start, rerolls, ${DRAFT_RUN_LENGTH} picks, private difficulty and completion passed`);
}
log(JSON.stringify(health));
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)await verifyTrophyImport(process.argv[2]);
