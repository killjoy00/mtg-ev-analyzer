import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import modelVersions from '../model-versions.json' with {type:'json'};
import {corpusDatabase} from '../scripts/neon-corpus-db.mjs';

const [branch,commit,connectionFile]=process.argv.slice(2);
const allowed=new Set(['br-twilight-hill-ayffyd2b','br-orange-feather-ayps8kep']);
if(!allowed.has(branch)||!/^[a-f0-9]{40}$/.test(commit||'')||!connectionFile)
  throw Error('Usage: v5-live-practice-acceptance.mjs BRANCH_ID FULL_COMMIT_SHA CONNECTION_FILE');
const query=corpusDatabase(connectionFile);
const origin=slug=>`https://${branch}-${slug}.compute.c-5.us-east-2.aws.neon.tech`;
const fixtures=[];

async function call(slug,path,{body,playerToken,accountToken,status=200}={}) {
  const response=await fetch(origin(slug)+path,{
    method:body===undefined?'GET':'POST',
    headers:{
      ...(body===undefined?{}:{'content-type':'application/json'}),
      ...(playerToken?{authorization:`Bearer ${playerToken}`}:{}),
      ...(accountToken?{'x-pack1-auth-session':accountToken}:{}),
    },
    body:body===undefined?undefined:JSON.stringify(body),
    redirect:'error',
    signal:AbortSignal.timeout(120000),
  });
  const data=await response.json().catch(()=>({}));
  assert.equal(response.status,status,`${slug}${path}: ${JSON.stringify(data)}`);
  return data;
}

async function guest(label) {
  const player=await call('pack1growth','/v1/session',{body:{displayName:`QA v5 ${label} ${commit.slice(0,7)}`}});
  assert.match(player.playerId||'',/^[a-f0-9-]{36}$/i);
  assert.match(player.token||'',/^p1_/);
  return player;
}

async function attachAccount(player,label) {
  const fixture={
    playerId:player.playerId,
    playerToken:player.token,
    authId:randomUUID(),
    authToken:randomUUID()+randomUUID(),
    ref:`v5-live-${label}-${randomUUID()}`,
  };
  fixtures.push(fixture);
  await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[
    fixture.authId,`QA v5 ${label}`,`qa-v5-${fixture.authId}@example.invalid`,
  ]);
  await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()+interval \'1 hour\',now())',[
    fixture.authToken,fixture.authId,
  ]);
  await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[
    fixture.authId,fixture.playerId,
  ]);
  await query(`INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference)
    VALUES($1::uuid,'unlimited_cube_practice','test',$2),
          ($1::uuid,'custom_corpus','test',$2)`,[fixture.authId,fixture.ref]);
  return fixture;
}

const auth=user=>({playerToken:user.playerToken,accountToken:user.authToken});
const parse=value=>typeof value==='string'?JSON.parse(value):value;

async function start(body,user) {
  const run=await call('draftrunapi','/v1/runs',{body:{...body,qa:true},...auth(user)});
  assert.equal(run.run_length,8);
  assert.equal(run.day,null);
  assert.equal(run.leaderboard_eligible,false);
  assert.equal(run.corpus_version,modelVersions.v5.corpus_version);
  return run;
}

async function reroll(run,type,user) {
  const before=Number(run.rerolls?.[type]||0);
  assert.ok(before>0,`${run.environment||'practice'} must offer a ${type} reroll`);
  const next=await call('draftrunapi',`/v1/runs/${run.id}/reroll`,{
    body:{revision:run.revision,round:run.answers.length,puzzleId:run.current.puzzle_id,type},
    ...auth(user),
  });
  assert.equal(Number(next.rerolls[type]),before-1);
  assert.ok(next.revision>run.revision);
  return next;
}

async function finish(run,user) {
  while(!run.complete) {
    const round=run.answers.length;
    const pick={
      revision:run.revision,
      round,
      puzzleId:run.current.puzzle_id,
      cardId:run.current.candidates[0].id,
    };
    run=await call('draftrunapi',`/v1/runs/${run.id}/pick`,{body:pick,...auth(user)});
    const answer=run.answers[round];
    assert.ok(answer.score>=0&&answer.score<=100);
    if(answer.historicalMatch)assert.equal(answer.score,100);
    else assert.ok(answer.score<=95);
  }
  assert.equal(run.answers.length,8);
  assert.equal(run.score,Math.round(run.answers.reduce((sum,a)=>sum+a.score,0)/8));
  assert.equal(run.leaderboard_eligible,false);
  const persisted=await call('draftrunapi',`/v1/runs/${run.id}`,auth(user));
  assert.equal(persisted.complete,true);
  assert.equal(persisted.score,run.score);
  assert.equal(persisted.answers.length,8);
  const stored=(await query(`SELECT corpus_version,score,result_persisted_at,measurement_qa,leaderboard_eligible
    FROM draft_run_sessions WHERE id=$1::uuid AND player_id=$2::uuid`,[run.id,user.playerId])).rows[0];
  assert.equal(stored?.corpus_version,modelVersions.v5.corpus_version);
  assert.equal(Number(stored?.score),Number(run.score));
  assert.ok(stored?.result_persisted_at,'Completed Practice must persist its result transaction.');
  assert.equal(stored?.measurement_qa,true);
  assert.equal(stored?.leaderboard_eligible,false);
  const result=(await query('SELECT count(*)::int n FROM game_results WHERE player_id=$1::uuid AND client_result_id=$2',[
    user.playerId,`draft-run:${run.id}`,
  ])).rows[0];
  assert.equal(Number(result?.n),1,'Completed Practice must persist exactly one game result.');
  return persisted;
}

async function cleanup() {
  for(const f of fixtures) {
    assert.match(f.playerId,/^[a-f0-9-]{36}$/i);
    assert.match(f.authId,/^[a-f0-9-]{36}$/i);
    // Keep completed QA gameplay rows as release evidence, just like the
    // existing Daily acceptance. Remove only temporary managed-auth access.
    await query('DELETE FROM entitlement_grants WHERE auth_user_id=$1::uuid AND provider=$2',[f.authId,'test']);
    await query('DELETE FROM account_links WHERE auth_user_id=$1::uuid',[f.authId]);
    await query('DELETE FROM neon_auth.session WHERE "userId"=$1::uuid',[f.authId]);
    await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[f.authId]);
  }
}

let completed=false;
try {
  const health=await call('draftrunapi','/health');
  assert.equal(health.ok,true);
  assert.equal(health.release_commit,commit);
  assert.equal(health.corpus_version,modelVersions.v5.corpus_version);
  assert.equal(health.unrated_puzzles,0);
  assert.deepEqual(health.missing_sets,[]);

  const readiness=(await query(`SELECT rv.revision::text current_revision,j.revision::text job_revision,
      j.state,s.id::text snapshot_id
    FROM draft_run_serving_revision rv
    JOIN draft_run_readiness_keys k ON k.corpus_version=$1
      AND k.difficulty_version=$2 AND k.serving_policy_version=$3 AND k.cache_schema='serving-cache-v1'
    JOIN draft_run_readiness_jobs j ON j.key_id=k.id AND j.revision=rv.revision
    JOIN draft_run_serving_snapshots s ON s.id=j.cache_snapshot_id AND s.revision=rv.revision
    WHERE rv.singleton`,[modelVersions.v5.corpus_version,health.difficulty_version,health.serving_policy_version])).rows[0];
  assert.equal(readiness?.state,'ready');
  assert.equal(readiness?.job_revision,readiness?.current_revision);
  assert.ok(readiness?.snapshot_id);

  const coverage=(await query(`SELECT count(*)::int expected,
      count(*) FILTER(WHERE s.corpus_version=$1)::int active
    FROM corpus_set_versions v
    JOIN draft_run_environment_policy p ON p.set_id=v.set_id
    LEFT JOIN corpus_source_snapshots s ON s.source_snapshot_id=p.active_snapshot_id
    WHERE v.corpus_version=$1`,[modelVersions.v5.corpus_version])).rows[0];
  assert.equal(Number(coverage.expected),32,'v9 release must contain all 32 rebuilt environments');
  assert.equal(Number(coverage.active),32,'all rebuilt environments must point at v9 snapshots');

  const ownerGuest=await guest('owner');
  await call('draftrunapi','/v1/runs',{body:{environment:'mixed',qa:true},playerToken:ownerGuest.token,status:403});
  const owner=await attachAccount(ownerGuest,'owner');
  const peer=await attachAccount(await guest('peer'),'peer');

  const capabilities=await call('draftrunapi','/v1/capabilities',auth(owner));
  for(const capability of ['account','unlimited_regular_practice','unlimited_cube_practice','custom_corpus'])
    assert.ok(capabilities.capabilities.includes(capability),`missing capability ${capability}`);

  const practice=await call('draftrunapi','/v1/practice-sets',auth(owner));
  assert.ok(Array.isArray(practice.sets)&&practice.sets.length>=2,'Practice must expose latest plus at least one archive set.');
  const latestId=health.daily_featured_sets[0];
  const latest=practice.sets.find(s=>s.set_id===latestId);
  assert.ok(latest,`Newest live set ${latestId} must be available for custom Practice.`);
  const archive=practice.sets.find(s=>s.set_id!==latestId);
  assert.ok(archive,'At least one older set must remain available for archive Practice.');

  let mixed=await start({environment:'mixed'},owner);
  mixed=await reroll(mixed,'set',owner);
  mixed=await finish(mixed,owner);

  const shared=await call('draftrunapi',`/v1/runs/${mixed.id}/share`,{body:{},...auth(owner)});
  assert.match(shared.id||'',/^[a-f0-9]+$/);
  const self=await start({challenge:shared.id},owner);
  assert.equal(self.id,mixed.id,'Opening your own share must return the original run.');
  assert.equal(self.comparison,null);
  let replay=await start({challenge:shared.id},peer);
  assert.equal(replay.comparison?.exact,true);
  assert.deepEqual(replay.rerolls,{set:0,pack:0});
  assert.equal(replay.current.puzzle_id,mixed.answers[0].puzzle.puzzle_id);
  await call('draftrunapi',`/v1/runs/${replay.id}/reroll`,{
    body:{revision:replay.revision,round:0,puzzleId:replay.current.puzzle_id,type:'pack'},
    ...auth(peer),status:409,
  });
  replay=await finish(replay,peer);
  const comparison=await call('draftrunapi',`/v1/shared-runs/${shared.id}`);
  assert.equal(comparison.scores.length,2);

  let cube=await start({environment:'powered-cube'},owner);
  assert.equal(cube.current.set_id,'powered-cube');
  cube=await reroll(cube,'pack',owner);
  cube=await finish(cube,owner);
  assert.ok(cube.answers.every(answer=>answer.puzzle.set_id==='powered-cube'));

  let latestRun=await start({environment:'mixed',setIds:[latest.set_id]},owner);
  assert.equal(latestRun.current.set_id,latest.set_id);
  latestRun=await reroll(latestRun,'pack',owner);
  latestRun=await finish(latestRun,owner);
  assert.ok(latestRun.answers.every(answer=>answer.puzzle.set_id===latest.set_id));
  const latestStored=(await query('SELECT custom_set_ids,measurement_qa,leaderboard_eligible FROM draft_run_sessions WHERE id=$1::uuid',[latestRun.id])).rows[0];
  assert.deepEqual(parse(latestStored.custom_set_ids),[latest.set_id]);
  assert.equal(latestStored.measurement_qa,true);
  assert.equal(latestStored.leaderboard_eligible,false);

  let archiveRun=await start({environment:'mixed',setIds:[archive.set_id]},owner);
  assert.equal(archiveRun.current.set_id,archive.set_id);
  archiveRun=await reroll(archiveRun,'pack',owner);
  archiveRun=await finish(archiveRun,owner);
  assert.ok(archiveRun.answers.every(answer=>answer.puzzle.set_id===archive.set_id));

  const ranked=(await query(`SELECT count(*)::int n FROM scores
    WHERE player_id=ANY($1::uuid[]) AND mode='draft_run'`,['{'+fixtures.map(f=>f.playerId).join(',')+'}'])).rows[0];
  assert.equal(Number(ranked.n),0,'QA Practice must not create public leaderboard scores.');

  completed=true;
  console.log(JSON.stringify({
    status:'passed',
    branch,
    commit,
    corpus_version:health.corpus_version,
    readiness_revision:readiness.current_revision,
    latest_set:latest.set_id,
    archive_set:archive.set_id,
    checks:[
      'exact release and v9 health/readiness',
      'guest Practice denied and account Practice granted',
      'mixed set reroll and persisted scoring',
      'shared friend replay identity and scores',
      'Cube pack reroll, completion and persistence',
      'Latest Set custom Practice completion and persistence',
      'archive set custom Practice completion and persistence',
      'no public leaderboard score',
    ],
  },null,2));
} finally {
  await cleanup();
  if(!completed)console.error('v5 live Practice acceptance failed; temporary QA auth cleanup completed.');
}
