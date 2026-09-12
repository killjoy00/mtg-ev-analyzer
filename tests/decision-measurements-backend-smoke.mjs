// Explicit integration test in the isolated development database only.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
if(!process.argv.includes('--dev-fixtures'))throw Error('Requires --dev-fixtures and an isolated development connection.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query}=await import('../worker/growth-function.js');
const {default:api}=await import('../worker/draft-run-function.mjs');
const tag=crypto.randomUUID(),user=crypto.randomUUID(),accountToken=crypto.randomUUID(),invite=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
let guest,run,repeat;
const httpBase=process.env.PACK1_MEASUREMENT_HTTP;
if(httpBase&&!/^https:\/\/br-twilight-hill-ayffyd2b-draftrunapi\.compute\.c-5\.us-east-2\.aws\.neon\.tech$/.test(httpBase))throw Error('HTTP integration is restricted to development.');
async function call(path,body,token,account,status=200){
  const request=new Request((httpBase||'https://packone.pro')+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...(account?{'x-pack1-auth-session':account}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  const response=await (httpBase?fetch(request):api.fetch(request));
  const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
}
try {
  await call('/v1/admin/measurements',undefined,null,null,401);
  await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[user,'QA measurement admin',`qa-measure-${tag}@example.invalid`]);
  await query('INSERT INTO neon_auth.session(id,"userId",token,"updatedAt","expiresAt") VALUES($1::uuid,$2::uuid,$3,now(),now()+interval \'1 hour\')',[crypto.randomUUID(),user,accountToken]);
  await call('/v1/admin/measurements',undefined,null,accountToken,403);
  await query('INSERT INTO pack1_admin_invites(token_hash,expires_at) VALUES($1,now()+interval \'1 hour\')',[createHash('sha256').update(invite).digest('hex')]);
  await call('/v1/admin/claim',{invite},null,accountToken);
  await call('/v1/admin/claim',{invite},null,accountToken);
  guest=await call('/v1/session',{displayName:'Measurement fixture '+tag.slice(0,5)});
  run=await call('/v1/runs',{environment:'mixed'},guest.token);
  let viewId=crypto.randomUUID();
  const first=run.current.puzzle_id;
  await call(`/v1/runs/${run.id}/view`,{revision:run.revision,puzzleId:first,viewId},guest.token);
  await call(`/v1/runs/${run.id}/view`,{revision:run.revision,puzzleId:first,viewId},guest.token);
  const pick={revision:run.revision,round:0,puzzleId:first,cardId:run.current.candidates[0].id,viewId,activeMs:1000};
  run=await call(`/v1/runs/${run.id}/pick`,pick,guest.token);
  await call(`/v1/runs/${run.id}/pick`,pick,guest.token);
  let rows=(await query('SELECT * FROM draft_run_decision_observations WHERE session_id=$1::uuid',[run.id])).rows;
  assert.equal(rows.length,1);assert.equal(Number(rows[0].active_ms),1000);assert.equal(rows[0].outcome,'pick');
  const originalId=run.id;
  repeat=(await query(`INSERT INTO draft_run_sessions(player_id,seed,corpus_version,scoring_version,puzzle_ids,seen_sources,environment,difficulty_version,selection_version,difficulty_anchors)
    SELECT player_id,$2,corpus_version,scoring_version,puzzle_ids,seen_sources,environment,difficulty_version,selection_version,difficulty_anchors FROM draft_run_sessions WHERE id=$1::uuid RETURNING id`,[originalId,crypto.randomUUID()])).rows[0].id;
  await call(`/v1/runs/${repeat}/view`,{revision:0,puzzleId:first,viewId:crypto.randomUUID()},guest.token);
  assert.equal((await query('SELECT first_encounter FROM draft_run_measurements WHERE session_id=$1::uuid',[repeat])).rows[0].first_encounter,'f');
  viewId=crypto.randomUUID();
  await call(`/v1/runs/${run.id}/view`,{revision:run.revision,puzzleId:run.current.puzzle_id,viewId},guest.token);
  await call(`/v1/runs/${run.id}/view`,{revision:run.revision,puzzleId:run.current.puzzle_id,viewId:crypto.randomUUID()},guest.token);
  const oldRevision=run.revision;
  run=await call(`/v1/runs/${run.id}/reroll`,{revision:run.revision,round:1,puzzleId:run.current.puzzle_id,type:'pack',viewId,activeMs:1000},guest.token);
  const reloaded=(await query('SELECT active_ms,outcome FROM draft_run_decision_observations WHERE session_id=$1::uuid AND revision=$2',[run.id,oldRevision])).rows[0];
  assert.equal(reloaded.active_ms,null);assert.equal(reloaded.outcome,'pack');
  viewId=crypto.randomUUID();
  await call(`/v1/runs/${run.id}/view`,{revision:run.revision,puzzleId:run.current.puzzle_id,viewId},guest.token);
  await query("UPDATE draft_run_decision_observations SET first_seen_at=now()-interval '25 hours',last_seen_at=now()-interval '25 hours' WHERE session_id=$1::uuid AND revision=$2",[run.id,run.revision]);
  await query("UPDATE draft_run_sessions SET updated_at=now()-interval '25 hours' WHERE id=$1::uuid",[run.id]);
  assert.equal((await query('SELECT likely_abandoned FROM draft_run_measurements WHERE session_id=$1::uuid AND revision=$2',[run.id,run.revision])).rows[0].likely_abandoned,'t');
  await call(`/v1/runs/${run.id}/view`,{revision:run.revision,puzzleId:run.current.puzzle_id,viewId},guest.token);
  assert.equal((await query('SELECT likely_abandoned FROM draft_run_measurements WHERE session_id=$1::uuid AND revision=$2',[run.id,run.revision])).rows[0].likely_abandoned,'f');
  let report=await call('/v1/admin/measurements',undefined,null,accountToken);
  assert.ok(Number(report.summary.answers)>=1);assert.ok(Number(report.coverage.repeats_excluded)>=1);
  await query('UPDATE draft_run_sessions SET measurement_qa=true WHERE id=ANY($1::uuid[])',['{'+[run.id,repeat].join(',')+'}']);
  report=await call('/v1/admin/measurements',undefined,null,accountToken);
  assert.ok(Number(report.coverage.qa_excluded)>=4);
  await call('/v1/admin/measurements?from=2026-02-30',undefined,null,accountToken,400);
  console.log('PASS: admin authorization, single-use claim, view/answer retry deduplication, repeat exclusion, reload timing, rerolls, inactivity/resume and QA exclusion.');
} finally {
  if(run)await query('UPDATE draft_run_sessions SET measurement_qa=true WHERE player_id=(SELECT player_id FROM draft_run_sessions WHERE id=$1::uuid)',[run.id]);
  await query('DELETE FROM pack1_admins WHERE auth_user_id=$1::uuid',[user]);
  await query('DELETE FROM neon_auth.session WHERE token=$1',[accountToken]);
}
