import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {corpusDatabase} from '../scripts/neon-corpus-db.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';
import {SERVING_POLICY_VERSION} from '../serving-quality.mjs';
import {READINESS_CACHE_SCHEMA} from '../worker/corpus-readiness.mjs';

const [connectionFile,branch,commit]=process.argv.slice(2);
if(!connectionFile||!/^br-[a-z0-9-]+$/.test(branch||'')||!/^[a-f0-9]{40}$/.test(commit||'')) {
  throw Error('Usage: node tests/release-practice-smoke.mjs CONNECTION_FILE BRANCH_ID FULL_COMMIT_SHA');
}
const query=corpusDatabase(connectionFile);
const fixtures=[];
const runIds=[];
const slug=service=>`https://${branch}-${service}.compute.c-5.us-east-2.aws.neon.tech`;

async function call(service,path,body,user=null,status=200) {
  const headers={'content-type':'application/json'};
  if(user?.token)headers.authorization='Bearer '+user.token;
  if(user?.auth)headers['x-pack1-auth-session']=user.auth;
  const response=await fetch(slug(service)+path,{
    method:body===undefined?'GET':'POST',
    headers,
    body:body===undefined?undefined:JSON.stringify(body),
    redirect:'error',
    signal:AbortSignal.timeout(120000),
  });
  let data;
  try { data=await response.json(); } catch { data={}; }
  assert.equal(response.status,status,`${service}${path}: ${JSON.stringify(data)}`);
  return data;
}

async function account(label,{premium=false}={}) {
  const id=crypto.randomUUID(),auth=crypto.randomUUID()+crypto.randomUUID();
  const tag=id.slice(0,8);
  const user=await call('pack1growth','/v1/session',{displayName:`QA release practice ${label} ${tag}`});
  const grantRef='release-practice-'+id;
  await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[
    id,`QA release practice ${label}`,`qa-release-practice-${id}@example.invalid`,
  ]);
  await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()+interval \'2 hours\',now())',[auth,id]);
  await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[id,user.playerId]);
  if(premium) {
    await query(`INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference)
      VALUES($1::uuid,'unlimited_cube_practice','test',$2),($1::uuid,'custom_corpus','test',$2)`,[id,grantRef]);
  }
  const fixture={...user,id,auth,grantRef};
  fixtures.push(fixture);
  return fixture;
}

async function finish(run,user) {
  while(!run.complete) {
    assert.equal(run.corpus_version,DRAFT_RUN_CORPUS_VERSION,'New practice session must use the checked release corpus.');
    const round=run.answers.length;
    const pick={revision:run.revision,round,puzzleId:run.current.puzzle_id,cardId:run.current.candidates[0].id};
    run=await call('draftrunapi',`/v1/runs/${run.id}/pick`,pick,user);
    assert.equal(run.complete,round===7);
    if(round===7) {
      const retry=await call('draftrunapi',`/v1/runs/${run.id}/pick`,pick,user);
      assert.equal(retry.score,run.score,'Completion retry must be idempotent.');
    }
  }
  assert.equal(run.day,null);
  assert.equal(run.leaderboard_eligible,false);
  assert.equal(run.run_length,8);
  assert.equal(run.score,Math.round(run.answers.reduce((sum,a)=>sum+a.score,0)/8));
  runIds.push(run.id);
  return run;
}

async function assertPersisted(run,user) {
  const session=(await query(`SELECT corpus_version,score,result_persisted_at,measurement_qa,day,leaderboard_eligible
    FROM draft_run_sessions WHERE id=$1::uuid AND player_id=$2::uuid`,[run.id,user.playerId])).rows[0];
  assert.ok(session,'Completed QA practice session must persist.');
  assert.equal(session.corpus_version,DRAFT_RUN_CORPUS_VERSION);
  assert.equal(Number(session.score),Number(run.score));
  assert.ok(session.result_persisted_at);
  assert.ok(session.measurement_qa===true||session.measurement_qa==='t');
  assert.equal(session.day,null);
  assert.ok(session.leaderboard_eligible===false||session.leaderboard_eligible==='f');
  const results=(await query('SELECT count(*)::int n FROM game_results WHERE player_id=$1::uuid AND client_result_id=$2',[
    user.playerId,`draft-run:${run.id}`,
  ])).rows[0];
  assert.equal(Number(results.n),1,'Completion must persist exactly one game result.');
}

async function readiness() {
  const row=(await query(`SELECT rv.revision::text revision,j.state,j.worker_release
    FROM draft_run_serving_revision rv
    JOIN draft_run_readiness_keys k
      ON k.corpus_version=$1 AND k.difficulty_version=$2
      AND k.serving_policy_version=$3 AND k.cache_schema=$4
    JOIN draft_run_readiness_jobs j ON j.key_id=k.id AND j.revision=rv.revision
    WHERE rv.singleton`,[
      DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_DIFFICULTY_VERSION,SERVING_POLICY_VERSION,READINESS_CACHE_SCHEMA,
    ])).rows[0];
  assert.ok(row,`No readiness row for ${DRAFT_RUN_CORPUS_VERSION} at the current serving revision.`);
  assert.equal(row.state,'ready',JSON.stringify(row));
  assert.match(String(row.worker_release||''),/^[a-f0-9]{40}$/,'Readiness must retain a concrete reviewed worker release.');
  return row;
}

let primary,peer;
try {
  for(const service of ['pack1growth','draftrunapi','pack1api']) {
    const health=await call(service,'/health?quick=1');
    assert.equal(health.release_commit,commit,`${service} release revision`);
  }
  const ready=await readiness();

  const guest=await call('pack1growth','/v1/session',{displayName:'QA release practice guest '+commit.slice(0,7)});
  await call('draftrunapi','/v1/runs',{qa:true},guest.token?{token:guest.token}:null,403);

  primary=await account('owner',{premium:true});
  peer=await account('peer');

  const caps=await call('draftrunapi','/v1/capabilities',undefined,primary);
  assert.ok(caps.capabilities.includes('account'));
  assert.ok(caps.capabilities.includes('unlimited_regular_practice'));
  assert.ok(caps.capabilities.includes('unlimited_cube_practice'));
  assert.ok(caps.capabilities.includes('custom_corpus'));

  let mixed=await call('draftrunapi','/v1/runs',{environment:'mixed',qa:true},primary);
  assert.equal(mixed.corpus_version,DRAFT_RUN_CORPUS_VERSION);
  mixed=await call('draftrunapi',`/v1/runs/${mixed.id}/reroll`,{
    revision:mixed.revision,round:0,puzzleId:mixed.current.puzzle_id,type:'pack',
  },primary);
  mixed=await finish(mixed,primary);
  await assertPersisted(mixed,primary);

  const shared=await call('draftrunapi',`/v1/runs/${mixed.id}/share`,{},primary);
  assert.match(shared.id||'',/^[a-f0-9]{24}$/);
  const self=await call('draftrunapi','/v1/runs',{challenge:shared.id,qa:true},primary);
  assert.equal(self.id,mixed.id,'Opening your own share must recover the original session.');
  assert.equal(self.comparison,null);

  let replay=await call('draftrunapi','/v1/runs',{challenge:shared.id,qa:true},peer);
  assert.equal(replay.corpus_version,DRAFT_RUN_CORPUS_VERSION);
  assert.equal(replay.current.puzzle_id,mixed.answers[0].puzzle.puzzle_id);
  assert.equal(replay.comparison.exact,true);
  assert.deepEqual(replay.rerolls,{set:0,pack:0});
  await call('draftrunapi',`/v1/runs/${replay.id}/reroll`,{
    revision:replay.revision,round:0,puzzleId:replay.current.puzzle_id,type:'pack',
  },peer,409);
  replay=await finish(replay,peer);
  await assertPersisted(replay,peer);
  const reshared=await call('draftrunapi',`/v1/runs/${replay.id}/share`,{},peer);
  assert.equal(reshared.id,shared.id);
  const shareInfo=await call('draftrunapi','/v1/shared-runs/'+shared.id);
  assert.equal(shareInfo.scores.length,2);

  const {sets}=await call('draftrunapi','/v1/practice-sets',undefined,primary);
  assert.ok(Array.isArray(sets)&&sets.length>0,'Expected at least one selectable set for archive practice.');
  const selectedSet=sets[0].set_id;
  let setRun=await call('draftrunapi','/v1/runs',{setIds:[selectedSet],qa:true},primary);
  assert.ok(setRun.current&&setRun.current.set_id===selectedSet);
  setRun=await call('draftrunapi',`/v1/runs/${setRun.id}/reroll`,{
    revision:setRun.revision,round:0,puzzleId:setRun.current.puzzle_id,type:'pack',
  },primary);
  setRun=await finish(setRun,primary);
  assert.ok(setRun.answers.every(a=>a.puzzle.set_id===selectedSet));
  await assertPersisted(setRun,primary);

  let cube=await call('draftrunapi','/v1/runs',{environment:'powered-cube',qa:true},primary);
  assert.equal(cube.current.set_id,'powered-cube');
  cube=await call('draftrunapi',`/v1/runs/${cube.id}/reroll`,{
    revision:cube.revision,round:0,puzzleId:cube.current.puzzle_id,type:'pack',
  },primary);
  cube=await finish(cube,primary);
  assert.ok(cube.answers.every(a=>a.puzzle.set_id==='powered-cube'));
  await assertPersisted(cube,primary);

  for(const user of [primary,peer]) {
    const scores=(await query('SELECT count(*)::int n FROM scores WHERE player_id=$1::uuid',[user.playerId])).rows[0];
    assert.equal(Number(scores.n),0,'Release Practice fixtures must never create ranked scores.');
  }

  const current=await readiness();
  assert.equal(current.revision,ready.revision,'Acceptance gameplay must not mutate serving revision.');
  console.log(JSON.stringify({
    status:'passed',branch,commit,corpus_version:DRAFT_RUN_CORPUS_VERSION,
    serving_revision:current.revision,practice_runs:runIds.length,
    checks:['guest practice denied','account regular practice','pack reroll','score/result persistence',
      'stable exact shared run','shared reroll denied','single-set archive practice','Powered Cube practice',
      'no ranked fixture scores','current serving readiness'],
  },null,2));
} finally {
  let cleanupError=null;
  for(const user of fixtures.reverse()) {
    try {
      await query('DELETE FROM entitlement_grants WHERE auth_user_id=$1::uuid AND provider_reference=$2',[user.id,user.grantRef]);
      await query('DELETE FROM neon_auth.session WHERE token=$1',[user.auth]);
      await query('DELETE FROM account_links WHERE auth_user_id=$1::uuid AND player_id=$2::uuid',[user.id,user.playerId]);
      await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[user.id]);
    } catch(error) { cleanupError ||= error; }
  }
  if(cleanupError)throw cleanupError;
}
