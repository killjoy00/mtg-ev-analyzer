// Prove an old corpus remains readable, while new Daily plans use the release.
// Synthetic versions and players are restricted to a disposable Neon branch.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DRAFT_RUN_CORPUS_VERSION,gradeDraftRunPick} from '../draft-run.mjs';
if(!process.argv.includes('--dev-fixtures'))throw Error('An isolated development branch is required.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {default:api}=await import('../worker/draft-run-function.mjs');
const {query,gameDateKey}=await import('../worker/growth-function.js');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const tag=crypto.randomUUID(),version=`qa-previous-${tag}`;
async function call(path,body,token,status=200) {
  const response=await api.fetch(new Request(`https://packone.pro${path}`,{
    method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
  }));
  const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
}
const player=await call('/v1/session',{displayName:`QA versions ${tag.slice(0,8)}`});
let run=await call('/v1/runs',{qa:true},player.token);
const session=(await query('SELECT puzzle_ids FROM draft_run_sessions WHERE id=$1::uuid',[run.id])).rows[0];
const ids=parse(session.puzzle_ids);
await query(`INSERT INTO draft_run_verified_puzzles(puzzle_id,set_id,source_draft_hash,corpus_version,pick_number,candidate_count,consensus_top_gap,support_entropy,interesting,payload)
  SELECT md5($1 || p.puzzle_id),set_id,source_draft_hash,$1,pick_number,candidate_count,consensus_top_gap,support_entropy,interesting,
    payload || jsonb_build_object('puzzle_id',md5($1 || p.puzzle_id),'corpus_version',$1::text)
  FROM draft_run_verified_puzzles p WHERE p.puzzle_id IN (SELECT jsonb_array_elements_text($2::jsonb))`,[version,JSON.stringify(ids)]);
await query(`INSERT INTO draft_run_puzzle_ratings(puzzle_id,difficulty_version,rating,top_two_ratio,target_support_ratio)
 SELECT md5($1||puzzle_id),difficulty_version,rating,top_two_ratio,target_support_ratio FROM draft_run_puzzle_ratings
 WHERE puzzle_id IN (SELECT jsonb_array_elements_text($2::jsonb)) ON CONFLICT DO NOTHING`,[version,JSON.stringify(ids)]);
const oldRows=(await query('SELECT puzzle_id,payload FROM draft_run_verified_puzzles WHERE corpus_version=$1',[version])).rows;
const oldIds=(await query('SELECT md5($1 || id) AS id FROM jsonb_array_elements_text($2::jsonb) x(id)',[version,JSON.stringify(ids)])).rows.map(r=>r.id);
assert.equal(oldRows.length,8);
await query('UPDATE draft_run_sessions SET corpus_version=$2,puzzle_ids=$3::jsonb WHERE id=$1::uuid',[run.id,version,JSON.stringify(oldIds)]);
run=await call(`/v1/runs/${run.id}`,undefined,player.token);
assert.equal(run.current.puzzle_id,oldIds[0],'Resume must load the pinned corpus');
for(let i=0;i<8;i++) {
  const payload=parse(oldRows.find(p=>p.puzzle_id===run.current.puzzle_id).payload);
  const cardId=run.current.candidates[0].id,expected=gradeDraftRunPick(payload,cardId).score;
  run=await call(`/v1/runs/${run.id}/pick`,{revision:run.revision,round:i,puzzleId:run.current.puzzle_id,cardId},player.token);
  assert.equal(run.answers[i].score,expected,'Release must preserve the original score evidence');
}
const shared=await call(`/v1/runs/${run.id}/share`,{},player.token);
const challenge=await call('/v1/runs',{challenge:shared.id,qa:true},player.token);
assert.equal(challenge.current.puzzle_id,oldIds[0],'Shared runs must retain their corpus');
assert.equal((await query('SELECT corpus_version FROM draft_run_sessions WHERE id=$1::uuid',[challenge.id])).rows[0].corpus_version,version);
// This old version contains only the original eight sources. A reroll cannot
// find another old source and must not silently cross into the new corpus.
const unavailable=await call(`/v1/runs/${challenge.id}/reroll`,{revision:challenge.revision,round:0,puzzleId:challenge.current.puzzle_id,type:'pack'},player.token,409);
assert.match(unavailable.error,/No comparable replacement/);

const dailyPlayer=await call('/v1/session',{displayName:`QA daily ${tag.slice(0,8)}`});
await call('/v1/runs',{daily:true,qa:true},dailyPlayer.token);
await query(`UPDATE draft_run_schedules SET corpus_version=$2,puzzle_ids=$3::jsonb
  WHERE day=$1::date AND environment='mixed'`,[gameDateKey(),version,JSON.stringify(oldIds)]);
const daily=await call('/v1/runs',{daily:true,qa:true},player.token);
assert.equal(daily.current.puzzle_id,oldIds[0]);
assert.equal((await query('SELECT corpus_version FROM draft_run_sessions WHERE id=$1::uuid',[daily.id])).rows[0].corpus_version,version);
assert.equal((await query("SELECT corpus_version FROM draft_run_schedules WHERE day=$1::date AND environment='mixed'",[gameDateKey()])).rows[0].corpus_version,version);
console.log(JSON.stringify({corpusTransition:'ready',oldResume:true,oldGrading:true,oldChallenge:true,rerollsStayInVersion:true,existingDailyKeepsPinnedCorpus:true}));
