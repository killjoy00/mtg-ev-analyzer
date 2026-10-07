import fs from 'node:fs';
import assert from 'node:assert/strict';
import {withPracticeAccess} from './practice-access-fixture.mjs';

if(!process.argv.includes('--dev-fixtures'))throw Error('Requires an isolated fixture database.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();

const {default:growth,query}=await import('../worker/growth-function.js');
const {default:runApi}=await import('../worker/draft-run-function.mjs');
const {creatorChallengeById,createCreatorChallenge}=await import('../worker/creator-challenges.mjs');
const {
  DRAFT_RUN_SCORING_V3_LEGACY_PROFILE,
  DRAFT_RUN_SCORING_V3_LINEAR_PROFILE,
  gradeDraftRunPickForVersion,
}=await import('../draft-run.mjs');
const {
  beginCreatorPublicationOperation,
  dispatchCreatorPublicationAttempt,
  requestCreatorPrivacyRetirement,
}=await import('../worker/creator-challenge-publish.mjs');

async function call(service,path,body,token,status=200) {
  const request=new Request('https://packone.pro'+path,{
    method:body===undefined?'GET':'POST',
    headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const response=await withPracticeAccess(request,query,r=>service.fetch(r));
  const data=await response.json();
  assert.equal(response.status,status,path+': '+JSON.stringify(data));
  return data;
}

async function directCall(service,path,body,token,status=200,extraHeaders={}) {
  const request=new Request('https://packone.pro'+path,{
    method:body===undefined?'GET':'POST',
    headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...extraHeaders},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const response=await service.fetch(request);
  const data=await response.json();
  assert.equal(response.status,status,path+': '+JSON.stringify(data));
  return data;
}

async function completePractice(player) {
  let run=await call(runApi,'/v1/runs',{},player.token);
  while(!run.complete) {
    run=await call(runApi,`/v1/runs/${run.id}/pick`,{
      revision:run.revision,
      round:run.answers.length,
      puzzleId:run.current.puzzle_id,
      cardId:run.current.candidates[0].id,
    },player.token);
  }
  return run;
}

async function cloneCreatorAttempt(templateId,{id,playerId,challengeId,authId=null,complete=true}) {
  const challengeHex=challengeId.replaceAll('-',''),runHex=id.replaceAll('-','');
  const startHash=(challengeHex+challengeHex).slice(0,64);
  const requestHash=(runHex+runHex).slice(0,64);
  const result=await query(`
    INSERT INTO draft_run_sessions
    SELECT (jsonb_populate_record(NULL::draft_run_sessions,
      to_jsonb(template) || jsonb_build_object(
        'id',$2::text,
        'player_id',$3::text,
        'day',NULL,
        'seed','creator-merge-'||$2::text,
        'challenge_id',NULL,
        'creator_challenge_id',$4::text,
        'creator_participant_auth_user_id',$5::text,
        'start_idempotency_hash',$6::text,
        'start_request_hash',$7::text,
        'answers',CASE WHEN $8::boolean THEN template.answers ELSE '[]'::jsonb END,
        'score',CASE WHEN $8::boolean THEN template.score ELSE NULL END,
        'result_persisted_at',CASE WHEN $8::boolean THEN now() ELSE NULL END,
        'created_at',now(),
        'updated_at',now()
      )
    )).*
    FROM draft_run_sessions template
    WHERE template.id=$1::uuid
    RETURNING id,score
  `,[templateId,id,playerId,challengeId,authId,startHash,requestHash,complete]);
  assert.equal(result.rows.length,1);
  return result.rows[0];
}

async function insertCreatorResult(playerId,runId,challengeId,score) {
  await query(`INSERT INTO game_results(
      player_id,set_id,mode,score,grade,seed,is_daily,challenge_id,
      opponent_name,opponent_score,outcome,client_result_id,creator_challenge_id
    ) VALUES($1::uuid,'mixed','draft_run',$2,'B','creator-merge',false,NULL,
      'Merge Creator',80,'win',$3,$4::uuid)`,[
    playerId,score,`draft-run:${runId}`,challengeId,
  ]);
}

async function insertCreatorStart(playerId,runId,challengeId) {
  await query(`INSERT INTO analytics_events(player_id,event_name,event_props)
    VALUES($1::uuid,'creator_challenge_started',
      jsonb_build_object('run_id',$2::text,'creator_challenge_id',$3::text))`,[
    playerId,runId,challengeId,
  ]);
}

function mergeFunctionSql(path) {
  const source=fs.readFileSync(path,'utf8');
  const signature='CREATE OR REPLACE FUNCTION merge_pack1_player(source_player uuid, target_player uuid)';
  const start=source.indexOf(signature);
  const boundary=path.endsWith('0054_creator_event_idempotency.sql')
    ?source.indexOf('\nCOMMIT;',start)
    :source.length;
  const bodyEnd=source.lastIndexOf('END;',boundary);
  const terminatorEnd=source.indexOf(';',bodyEnd+4);
  assert.ok(start>=0&&bodyEnd>start&&terminatorEnd>bodyEnd,'merge function missing from '+path);
  return source.slice(start,terminatorEnd+1);
}

const tag=crypto.randomUUID().slice(0,8);
const creator=await call(growth,'/v1/session',{displayName:'Merge Creator '+tag});
const target=await call(growth,'/v1/session',{displayName:'Merge Account '+tag});
const guestCompleted=await call(growth,'/v1/session',{displayName:'Merge Guest Complete '+tag});
const guestPartial=await call(growth,'/v1/session',{displayName:'Merge Guest Partial '+tag});
const replayGuest=await call(growth,'/v1/session',{displayName:'Creator Replay Guest '+tag});
const concurrentGuest=await call(growth,'/v1/session',{displayName:'Creator Concurrent Guest '+tag});
const legacyReplayGuest=await call(growth,'/v1/session',{displayName:'Creator Legacy Replay Guest '+tag});
const dailyFirstGuest=await call(growth,'/v1/session',{displayName:'Creator Daily First '+tag});
const paidModeGuest=await call(growth,'/v1/session',{displayName:'Creator Paid Mode Guest '+tag});
const targetAuth=crypto.randomUUID(),creatorAuth=crypto.randomUUID(),creatorAccountToken=crypto.randomUUID()+crypto.randomUUID();

try {
  await query(`INSERT INTO neon_auth."user"(id,name,email,"emailVerified")
    VALUES($1::uuid,$2,$3,true)`,[
    creatorAuth,'Creator source fixture',`creator-source-${tag}@example.invalid`,
  ]);
  await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[creatorAuth,creator.playerId]);
  await query(`INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt")
    VALUES($1,$2::uuid,now()+interval '1 hour',now())`,[creatorAccountToken,creatorAuth]);
  await query(`INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference)
    VALUES($1::uuid,'unlimited_cube_practice','test',$2),($1::uuid,'custom_corpus','test',$2)`,[
    creatorAuth,'creator-source-'+tag,
  ]);
  let template=await directCall(runApi,'/v1/runs',{},creator.token,200,{'x-pack1-auth-session':creatorAccountToken});
  while(!template.complete) {
    template=await directCall(runApi,`/v1/runs/${template.id}/pick`,{
      revision:template.revision,
      round:template.answers.length,
      puzzleId:template.current.puzzle_id,
      cardId:template.current.candidates[0].id,
    },creator.token,200,{'x-pack1-auth-session':creatorAccountToken});
  }
  await query(`UPDATE players SET profile_public=true,username_owned=true WHERE id=$1::uuid`,[creator.playerId]);
  const creatorIdentity=(await query(`SELECT profile_public,username_owned,public_identity_hidden_at
    FROM players WHERE id=$1::uuid`,[creator.playerId])).rows[0];
  assert.equal(creatorIdentity.profile_public===true||creatorIdentity.profile_public==='t',true);
  assert.equal(creatorIdentity.username_owned===true||creatorIdentity.username_owned==='t',true);
  assert.equal(creatorIdentity.public_identity_hidden_at,null);

  // Exercise the production creation/audit SQL, rather than inserting the
  // challenge fixture directly. Polymorphic jsonb_build_object parameters must
  // be typed under PostgreSQL's prepared-statement protocol.
  const creationShare=await directCall(runApi,`/v1/runs/${template.id}/share`,{},creator.token);
  const creation=await createCreatorChallenge(query,{
    source_type:'practice',share:creationShare.id,slug:`creation-${tag}`,
    creator_public_name:'Creation Creator',acquisition_source:'creator',
    acquisition_campaign:'creation-smoke',
  },creatorAuth);
  assert.equal(creation.source_session_id,template.id);
  assert.equal(creation.status,'draft');
  const creationAudit=(await query(`SELECT detail FROM creator_challenge_audit
    WHERE creator_challenge_id=$1::uuid AND action='created'`,[creation.id])).rows;
  assert.equal(creationAudit.length,1);
  const auditDetail=typeof creationAudit[0].detail==='string'
    ?JSON.parse(creationAudit[0].detail):creationAudit[0].detail;
  assert.equal(auditDetail.source_type,'practice');
  assert.equal(auditDetail.source_session_id,template.id);
  console.log('Creator challenge creation and audit persistence verified against real PostgreSQL.');


  // Route-level creator behavior: standard campaigns remain guest-playable,
  // source owners open the original run, creator answers reveal only after a
  // submitted pick, and creator replay state never consumes the real Daily.
  const runtimeChallenge=crypto.randomUUID(),runtimeSlug=`runtime-${tag}`;
  await query(`INSERT INTO creator_challenges(
      id,slug,source_session_id,source_owner_player_id,source_type,source_day,source_environment,
      creator_public_name,headline,acquisition_source,acquisition_campaign,acquisition_medium,status,
      created_by_admin_auth_user_id,published_at,publication_detail
    ) VALUES($1::uuid,$2,$3::uuid,$4::uuid,'practice',NULL,'mixed',
      'Runtime Creator','Beat Runtime Creator','creator',$2,'creator','published',
      $5::uuid,now(),'{"live_verified":true}'::jsonb)`,[
    runtimeChallenge,runtimeSlug,template.id,creator.playerId,targetAuth,
  ]);

  // The database invariant must protect callers that do not yet send
  // ON CONFLICT during a rolling deploy. Concurrent raw inserts for the same
  // player/challenge/event converge without surfacing a uniqueness error.
  await Promise.all(Array.from({length:8},()=>query(
    `INSERT INTO analytics_events(player_id,event_name,event_props)
     VALUES($1::uuid,'creator_challenge_open',
       jsonb_build_object('creator_challenge_id',$2::text,'source','raw-concurrency-smoke'))`,
    [concurrentGuest.playerId,runtimeChallenge],
  )));
  assert.equal(Number((await query(`SELECT count(*)::int n FROM analytics_events
    WHERE player_id=$1::uuid AND event_name='creator_challenge_open'
      AND event_props->>'creator_challenge_id'=$2`,[
    concurrentGuest.playerId,runtimeChallenge,
  ])).rows[0].n),1,'database insert guard serializes concurrent creator opens');

  // A creator source recorded under the first v3 implementation must start a
  // challenger session with the resolved historical scoring profile, not the
  // current global scorer. Build one valid synthetic decision from an existing
  // verified puzzle so the two v3 floating-point paths differ by one point.
  const templatePuzzleIds=template.answers.map(answer=>answer.puzzle.puzzle_id);
  const templatePuzzleRows=await query(
    'SELECT puzzle_id,payload FROM draft_run_verified_puzzles WHERE puzzle_id=ANY($1::text[])',
    ['{'+templatePuzzleIds.join(',')+'}'],
  );
  const payloadById=new Map(templatePuzzleRows.rows.map(row=>[
    row.puzzle_id,
    typeof row.payload==='string'?JSON.parse(row.payload):structuredClone(row.payload),
  ]));
  const firstPayload=structuredClone(payloadById.get(templatePuzzleIds[0]));
  assert.ok(firstPayload&&firstPayload.candidates.length>=4,'legacy scoring fixture needs one verified pack');
  const [leader,selected,third,historical]=firstPayload.candidates;
  firstPayload.candidates=[leader,selected,third,historical];
  firstPayload.candidate_count=4;
  leader.model_probability=.19;
  selected.model_probability=.027;
  third.model_probability=.0135;
  historical.model_probability=.00675;
  firstPayload.historical_pick_id=historical.id;
  const syntheticPuzzleId=crypto.randomUUID().replaceAll('-','');
  const syntheticSourceHash=crypto.randomUUID().replaceAll('-','');
  firstPayload.puzzle_id=syntheticPuzzleId;
  firstPayload.source_draft_hash=syntheticSourceHash;
  assert.equal(gradeDraftRunPickForVersion(firstPayload,selected.id,DRAFT_RUN_SCORING_V3_LEGACY_PROFILE).score,13);
  assert.equal(gradeDraftRunPickForVersion(firstPayload,selected.id,DRAFT_RUN_SCORING_V3_LINEAR_PROFILE).score,14);
  await query(`INSERT INTO draft_run_verified_puzzles
    SELECT (jsonb_populate_record(NULL::draft_run_verified_puzzles,
      to_jsonb(source)||jsonb_build_object(
        'puzzle_id',$2::text,'source_draft_hash',$3::text,'candidate_count',4,'payload',$4::jsonb
      )
    )).*
    FROM draft_run_verified_puzzles source
    WHERE source.puzzle_id=$1`,[
    templatePuzzleIds[0],syntheticPuzzleId,syntheticSourceHash,JSON.stringify(firstPayload),
  ]);

  const legacySourceId=crypto.randomUUID();
  const legacyPuzzleIds=[syntheticPuzzleId,...templatePuzzleIds.slice(1)];
  const legacyPayloads=[firstPayload,...templatePuzzleIds.slice(1).map(id=>payloadById.get(id))];
  const legacyAnswers=legacyPayloads.map((puzzle,index)=>{
    const selectedId=index===0?selected.id:puzzle.historical_pick_id;
    const grade=gradeDraftRunPickForVersion(puzzle,selectedId,DRAFT_RUN_SCORING_V3_LEGACY_PROFILE);
    return {...grade,puzzle:{puzzle_id:puzzle.puzzle_id,set_id:puzzle.set_id,pick_number:puzzle.pick_number}};
  });
  const legacyScore=Math.round(legacyAnswers.reduce((sum,answer)=>sum+answer.score,0)/legacyAnswers.length);
  await query(`INSERT INTO draft_run_sessions
    SELECT (jsonb_populate_record(NULL::draft_run_sessions,
      to_jsonb(source)||jsonb_build_object(
        'id',$2::text,
        'seed','legacy-creator-'||$2::text,
        'scoring_version','trophy-consensus-v3',
        'puzzle_ids',$3::jsonb,
        'answers',$4::jsonb,
        'score',$5::int,
        'created_at','2026-09-16T00:00:00Z',
        'updated_at','2026-09-16T00:00:00Z',
        'result_persisted_at',NULL
      )
    )).*
    FROM draft_run_sessions source
    WHERE source.id=$1::uuid`,[
    template.id,legacySourceId,JSON.stringify(legacyPuzzleIds),JSON.stringify(legacyAnswers),legacyScore,
  ]);
  const legacyChallenge=crypto.randomUUID(),legacySlug=`legacy-score-${tag}`;
  await query(`INSERT INTO creator_challenges(
      id,slug,source_session_id,source_owner_player_id,source_type,source_day,source_environment,
      creator_public_name,headline,acquisition_source,acquisition_campaign,status,
      created_by_admin_auth_user_id,published_at,publication_detail
    ) VALUES($1::uuid,$2,$3::uuid,$4::uuid,'practice',NULL,'mixed',
      'Legacy Score Creator','Legacy scoring replay','creator',$2,'published',
      $5::uuid,now(),'{"live_verified":true}'::jsonb)`,[
    legacyChallenge,legacySlug,legacySourceId,creator.playerId,targetAuth,
  ]);
  let legacyReplay=await directCall(runApi,'/v1/runs',{creatorChallenge:legacyChallenge},legacyReplayGuest.token);
  assert.equal(legacyReplay.scoring_version,DRAFT_RUN_SCORING_V3_LEGACY_PROFILE,
    'creator start persists the resolved historical scoring profile');
  assert.equal(legacyReplay.current.puzzle_id,syntheticPuzzleId);
  legacyReplay=await directCall(runApi,`/v1/runs/${legacyReplay.id}/pick`,{
    revision:legacyReplay.revision,
    round:0,
    puzzleId:syntheticPuzzleId,
    cardId:selected.id,
  },legacyReplayGuest.token);
  assert.equal(legacyReplay.answers[0].score,13,
    'creator gameplay dispatches through the session-pinned historical scorer');
  while(!legacyReplay.complete) {
    legacyReplay=await directCall(runApi,`/v1/runs/${legacyReplay.id}/pick`,{
      revision:legacyReplay.revision,
      round:legacyReplay.answers.length,
      puzzleId:legacyReplay.current.puzzle_id,
      cardId:legacyReplay.current.candidates[0].id,
    },legacyReplayGuest.token);
  }
  const legacyReload=await directCall(runApi,`/v1/runs/${legacyReplay.id}`,undefined,legacyReplayGuest.token);
  assert.equal(legacyReload.complete,true);
  assert.equal(legacyReload.scoring_version,DRAFT_RUN_SCORING_V3_LEGACY_PROFILE,
    'historical scoring profile survives completion and reload');
  const legacyReport=await directCall(runApi,`/v1/runs/${legacyReplay.id}/report`,{
    round:0,puzzleId:syntheticPuzzleId,reason:'score_recommendation',
    comment:'historical scoring profile smoke',client:{platform:'web'},
  },legacyReplayGuest.token);
  assert.equal(legacyReport.ok,true);
  const legacyReportRow=(await query(`SELECT scoring_version
    FROM draft_run_decision_reports WHERE run_id=$1::uuid ORDER BY id DESC LIMIT 1`,[
    legacyReplay.id,
  ])).rows[0];
  assert.equal(legacyReportRow.scoring_version,DRAFT_RUN_SCORING_V3_LEGACY_PROFILE,
    'decision-report persistence retains the session scoring profile');

  const publicOne=await directCall(runApi,`/v1/creator-challenges/${runtimeSlug}`,undefined,replayGuest.token);
  const publicTwo=await directCall(runApi,`/v1/creator-challenges/${runtimeSlug}`,undefined,replayGuest.token);
  assert.equal(publicOne.id,runtimeChallenge);assert.equal(publicTwo.id,runtimeChallenge);
  assert.equal('answers' in publicOne,false,'public challenge metadata never serializes creator decisions');
  for(const eventName of ['creator_challenge_open','acquisition_touch']) {
    assert.equal(Number((await query(`SELECT count(*)::int n FROM analytics_events
      WHERE player_id=$1::uuid AND event_name=$2
        AND event_props->>'creator_challenge_id'=$3`,[
      replayGuest.playerId,eventName,runtimeChallenge,
    ])).rows[0].n),1,`${eventName} is deduplicated per player/challenge`);
  }

  const selfOpen=await directCall(runApi,'/v1/runs',{creatorChallenge:runtimeChallenge},creator.token);
  assert.equal(selfOpen.id,template.id,'creator self-open returns the authoritative source run');
  assert.equal(selfOpen.creator_source_owner.challenge_id,runtimeChallenge);
  assert.equal(selfOpen.creator_source_owner.source_type,'practice');

  const beforeDaily=await directCall(runApi,'/v1/daily-status',undefined,replayGuest.token);
  assert.equal(beforeDaily.daily_history.length,0);
  let replay=await directCall(runApi,'/v1/runs',{creatorChallenge:runtimeChallenge},replayGuest.token);
  assert.equal(replay.creator_challenge_id,runtimeChallenge);
  assert.equal(replay.day,null);
  assert.equal(replay.comparison.kind,'creator');
  assert.equal(replay.answers.length,0);
  const sourceAnswers=template.answers;
  for(let round=0;round<2;round++) {
    const selected=replay.current.candidates[0].id;
    replay=await directCall(runApi,`/v1/runs/${replay.id}/pick`,{
      revision:replay.revision,
      round:replay.answers.length,
      puzzleId:replay.current.puzzle_id,
      cardId:selected,
    },replayGuest.token);
    assert.equal(replay.answers.length,round+1);
    assert.ok(replay.answers.every(answer=>answer.creatorId),'only submitted rounds receive creator comparison fields');
    assert.equal(replay.answers[round].creatorId,sourceAnswers[round].selectedId);
  }
  assert.equal((await directCall(runApi,'/v1/daily-status',undefined,replayGuest.token)).daily_history.length,0,
    'creator replay does not create Daily history');
  const realDaily=await directCall(runApi,'/v1/runs',{daily:true},replayGuest.token);
  assert.notEqual(realDaily.id,replay.id);
  assert.equal(realDaily.creator_challenge_id??null,null);
  assert.ok(realDaily.day,'real Daily remains independently available after creator replay');

  const dailyFirst=await directCall(runApi,'/v1/runs',{daily:true},dailyFirstGuest.token);
  const replayAfterDaily=await directCall(runApi,'/v1/runs',{creatorChallenge:runtimeChallenge},dailyFirstGuest.token);
  assert.notEqual(replayAfterDaily.id,dailyFirst.id);
  assert.equal(replayAfterDaily.day,null);
  assert.equal((await directCall(runApi,'/v1/runs',{daily:true},dailyFirstGuest.token)).id,dailyFirst.id,
    'creator replay after Daily leaves the Daily reservation unchanged');

  // Exercise the real final-pick/result persistence path, not a cloned completed
  // fixture. A reserved Daily must stay independent throughout completion.
  while(!replay.complete) {
    replay=await directCall(runApi,`/v1/runs/${replay.id}/pick`,{
      revision:replay.revision,round:replay.answers.length,
      puzzleId:replay.current.puzzle_id,cardId:replay.current.candidates[0].id,
    },replayGuest.token);
  }
  assert.equal(replay.answers.length,8);
  assert.equal(replay.comparison.creator_matches,replay.answers.filter((answer,index)=>answer.selectedId===sourceAnswers[index].selectedId).length);
  assert.equal(replay.comparison.trophy_matches,replay.answers.filter(answer=>answer.historicalMatch).length);
  assert.equal(replay.comparison.outcome,replay.score>template.score?'win':replay.score<template.score?'loss':'tie');
  const persisted=(await query(`SELECT creator_challenge_id::text creator_challenge_id,score,outcome,is_daily,opponent_name
    FROM game_results WHERE player_id=$1::uuid AND client_result_id=$2`,[replayGuest.playerId,`draft-run:${replay.id}`])).rows;
  assert.equal(persisted.length,1);
  assert.equal(persisted[0].creator_challenge_id,runtimeChallenge);
  assert.equal(Number(persisted[0].score),Number(replay.score));
  assert.equal(persisted[0].outcome,replay.comparison.outcome);
  assert.ok(persisted[0].is_daily===false||persisted[0].is_daily==='f','saved creator result must be unranked');
  assert.equal(persisted[0].opponent_name,'Runtime Creator');
  const runtimeStats=await creatorChallengeById(query,runtimeChallenge,{includeStats:true});
  assert.equal(runtimeStats.attempts,1);
  assert.equal(runtimeStats.wins+runtimeStats.ties+runtimeStats.losses,1);
  assert.equal((await directCall(runApi,'/v1/runs',{daily:true},replayGuest.token)).id,realDaily.id);
  const reloaded=await directCall(runApi,`/v1/runs/${replay.id}`,undefined,replayGuest.token);
  assert.equal(reloaded.complete,true);
  assert.equal(reloaded.comparison.outcome,replay.comparison.outcome);
  console.log('All eight creator picks, final comparison, result persistence, reload and Daily isolation verified against real PostgreSQL.');

  // Paid creator sources keep the same paid capability gate as ordinary Practice.
  const paidSourceId=crypto.randomUUID(),paidChallenge=crypto.randomUUID(),paidSlug=`paid-${tag}`;
  await query(`INSERT INTO draft_run_sessions
    SELECT (jsonb_populate_record(NULL::draft_run_sessions,
      to_jsonb(source)||jsonb_build_object(
        'id',$2::text,'environment','powered-cube','seed',$3::text,
        'created_at',now(),'updated_at',now()
      )
    )).* FROM draft_run_sessions source WHERE source.id=$1::uuid`,[
    template.id,paidSourceId,`creator-paid-${tag}`,
  ]);
  await query(`INSERT INTO creator_challenges(
      id,slug,source_session_id,source_owner_player_id,source_type,source_day,source_environment,
      creator_public_name,headline,acquisition_source,acquisition_campaign,status,
      created_by_admin_auth_user_id,published_at,publication_detail
    ) VALUES($1::uuid,$2,$3::uuid,$4::uuid,'practice',NULL,'powered-cube',
      'Runtime Creator','Paid creator challenge','creator',$2,'published',
      $5::uuid,now(),'{"live_verified":true}'::jsonb)`,[
    paidChallenge,paidSlug,paidSourceId,creator.playerId,targetAuth,
  ]);
  const paidDenied=await directCall(runApi,'/v1/runs',{creatorChallenge:paidChallenge},paidModeGuest.token,403);
  assert.equal(paidDenied.capability,'unlimited_cube_practice');

  await query(`INSERT INTO neon_auth."user"(id,name,email,"emailVerified")
    VALUES($1::uuid,$2,$3,true)`,[
    targetAuth,'Creator merge target',`creator-merge-${targetAuth}@example.invalid`,
  ]);
  await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[targetAuth,target.playerId]);

  const challengeCompletedGuest=crypto.randomUUID();
  const challengePartialGuest=crypto.randomUUID();
  for(const [id,slug] of [[challengeCompletedGuest,`merge-complete-${tag}`],[challengePartialGuest,`merge-partial-${tag}`]]) {
    await query(`INSERT INTO creator_challenges(
        id,slug,source_session_id,source_owner_player_id,source_type,source_day,source_environment,
        creator_public_name,headline,acquisition_source,acquisition_campaign,status,
        created_by_admin_auth_user_id,published_at,publication_detail
      ) VALUES($1::uuid,$2,$3::uuid,$4::uuid,'practice',NULL,'mixed',
        'Merge Creator','Merge creator challenge','creator','merge-smoke','published',
        $5::uuid,now(),'{"live_verified":true}'::jsonb)`,[
      id,slug,template.id,creator.playerId,targetAuth,
    ]);
  }

  // Case 1: guest completed, established account only partial.
  const targetPartialId=crypto.randomUUID(),guestCompletedId=crypto.randomUUID();
  await cloneCreatorAttempt(template.id,{id:targetPartialId,playerId:target.playerId,challengeId:challengeCompletedGuest,authId:targetAuth,complete:false});
  const completed=await cloneCreatorAttempt(template.id,{id:guestCompletedId,playerId:guestCompleted.playerId,challengeId:challengeCompletedGuest,complete:true});
  await insertCreatorResult(guestCompleted.playerId,guestCompletedId,challengeCompletedGuest,Number(completed.score));
  await insertCreatorStart(target.playerId,targetPartialId,challengeCompletedGuest);
  await insertCreatorStart(guestCompleted.playerId,guestCompletedId,challengeCompletedGuest);
  // Both browser identities may have opened the same creator link before
  // sign-in. The merge must preserve the earliest attribution/open and must
  // never fail the creator-event uniqueness invariant.
  await query(`INSERT INTO analytics_events(player_id,event_name,event_props,created_at)
    VALUES
      ($1::uuid,'creator_challenge_open',jsonb_build_object('creator_challenge_id',$3::text),now()-interval '2 minutes'),
      ($1::uuid,'acquisition_touch',jsonb_build_object(
        'source','creator','campaign','merge-first-touch',
        'creator_challenge_id',$3::text
      ),now()-interval '2 minutes'),
      ($2::uuid,'creator_challenge_open',jsonb_build_object('creator_challenge_id',$3::text),now()-interval '1 minute'),
      ($2::uuid,'acquisition_touch',jsonb_build_object(
        'source','creator','campaign','target-later-touch',
        'creator_challenge_id',$3::text
      ),now()-interval '1 minute')`,[
    guestCompleted.playerId,target.playerId,challengeCompletedGuest,
  ]);

  // Simulate a subsequent secure-auth release replaying 0046 after 0054.
  // The database trigger invariant must keep the pre-0054 merge body safe.
  await query(mergeFunctionSql('migrations/0046_public_identity_safety.sql'));
  await query('SELECT merge_pack1_player($1::uuid,$2::uuid)',[guestCompleted.playerId,target.playerId]);
  await query(mergeFunctionSql('migrations/0054_creator_event_idempotency.sql'));

  const mergedCompleted=(await query(`SELECT player_id,creator_challenge_id,creator_participant_auth_user_id,
      start_idempotency_hash,start_request_hash,score
    FROM draft_run_sessions WHERE id=$1::uuid`,[guestCompletedId])).rows[0];
  assert.equal(mergedCompleted.player_id,target.playerId);
  assert.equal(mergedCompleted.creator_challenge_id,null,'duplicate completed guest session becomes ordinary Practice');
  assert.equal(mergedCompleted.creator_participant_auth_user_id,null);
  assert.equal(mergedCompleted.start_idempotency_hash,null);
  assert.equal(mergedCompleted.start_request_hash,null);
  assert.equal(Number(mergedCompleted.score),Number(completed.score),'ordinary Practice score/history is preserved');

  const retainedResult=(await query(`SELECT creator_challenge_id,opponent_name,opponent_score,outcome,score
    FROM game_results WHERE player_id=$1::uuid AND client_result_id=$2`,[
    target.playerId,`draft-run:${guestCompletedId}`,
  ])).rows[0];
  assert.equal(retainedResult.creator_challenge_id,null);
  assert.equal(retainedResult.opponent_name,null);
  assert.equal(retainedResult.opponent_score,null);
  assert.equal(retainedResult.outcome,null);
  assert.equal(Number(retainedResult.score),Number(completed.score));
  assert.equal(Number((await query(`SELECT count(*)::int n FROM analytics_events
    WHERE player_id=$1::uuid AND event_name='creator_challenge_started'
      AND event_props->>'creator_challenge_id'=$2`,[target.playerId,challengeCompletedGuest])).rows[0].n),1);
  assert.equal(Number((await query(`SELECT count(*)::int n FROM analytics_events
    WHERE player_id=$1::uuid AND event_name='creator_challenge_open'
      AND event_props->>'creator_challenge_id'=$2`,[
    target.playerId,challengeCompletedGuest,
  ])).rows[0].n),1,'overlapping creator opens collapse during identity merge');
  const mergedAttribution=(await query(`SELECT event_props
    FROM analytics_events
    WHERE player_id=$1::uuid AND event_name='acquisition_touch'
      AND event_props->>'creator_challenge_id'=$2`,[
    target.playerId,challengeCompletedGuest,
  ])).rows;
  assert.equal(mergedAttribution.length,1,'overlapping creator acquisition touches collapse during identity merge');
  const mergedProps=typeof mergedAttribution[0].event_props==='string'
    ?JSON.parse(mergedAttribution[0].event_props):mergedAttribution[0].event_props;
  assert.equal(mergedProps.campaign,'merge-first-touch',
    'identity merge preserves the earliest creator acquisition attribution');

  // Case 2: established account completed, guest only partial.
  const targetCompleteId=crypto.randomUUID(),guestPartialId=crypto.randomUUID();
  const targetComplete=await cloneCreatorAttempt(template.id,{id:targetCompleteId,playerId:target.playerId,challengeId:challengePartialGuest,authId:targetAuth,complete:true});
  await insertCreatorResult(target.playerId,targetCompleteId,challengePartialGuest,Number(targetComplete.score));
  await cloneCreatorAttempt(template.id,{id:guestPartialId,playerId:guestPartial.playerId,challengeId:challengePartialGuest,complete:false});
  await insertCreatorStart(target.playerId,targetCompleteId,challengePartialGuest);
  await insertCreatorStart(guestPartial.playerId,guestPartialId,challengePartialGuest);

  await query('SELECT merge_pack1_player($1::uuid,$2::uuid)',[guestPartial.playerId,target.playerId]);

  const mergedPartial=(await query(`SELECT player_id,creator_challenge_id,creator_participant_auth_user_id,
      start_idempotency_hash,start_request_hash,score
    FROM draft_run_sessions WHERE id=$1::uuid`,[guestPartialId])).rows[0];
  assert.equal(mergedPartial.player_id,target.playerId);
  assert.equal(mergedPartial.creator_challenge_id,null);
  assert.equal(mergedPartial.creator_participant_auth_user_id,null);
  assert.equal(mergedPartial.start_idempotency_hash,null);
  assert.equal(mergedPartial.start_request_hash,null);
  assert.equal(mergedPartial.score,null);

  const authoritative=(await query(`SELECT creator_challenge_id,creator_participant_auth_user_id
    FROM draft_run_sessions WHERE id=$1::uuid`,[targetCompleteId])).rows[0];
  assert.equal(authoritative.creator_challenge_id,challengePartialGuest);
  assert.equal(authoritative.creator_participant_auth_user_id,targetAuth);

  const stats=await creatorChallengeById(query,challengePartialGuest,{includeStats:true});
  assert.equal(stats.attempts,1,'only the established completed creator attempt counts after merge');
  assert.equal(stats.wins+stats.ties+stats.losses,1);

  const firstStats=await creatorChallengeById(query,challengeCompletedGuest,{includeStats:true});
  assert.equal(firstStats.attempts,0,'completed guest duplicate is demoted, so the established partial attempt contributes no completed creator attempt');

  const participantRows=await query(`SELECT creator_challenge_id,count(*)::int n
    FROM draft_run_sessions
    WHERE creator_challenge_id IN ($1::uuid,$2::uuid)
    GROUP BY creator_challenge_id
    ORDER BY creator_challenge_id`,[challengeCompletedGuest,challengePartialGuest]);
  assert.deepEqual(
    participantRows.rows.map(row=>[row.creator_challenge_id,Number(row.n)]).sort(),
    [[challengeCompletedGuest,1],[challengePartialGuest,1]].sort(),
    'exactly one creator-associated session survives per challenge after merge',
  );

  assert.equal(Number((await query(`SELECT count(*)::int n FROM analytics_events
    WHERE player_id=$1::uuid AND event_name='creator_challenge_started'
      AND event_props->>'creator_challenge_id'=$2`,[target.playerId,challengePartialGuest])).rows[0].n),1,
  'duplicate creator start telemetry is removed during merge');

  const mergedAccountDaily=await directCall(runApi,'/v1/runs',{daily:true},target.token);
  assert.ok(mergedAccountDaily.day,'the merged account can start its real Daily after creator attribution merge');
  assert.equal(Number((await query(`SELECT count(*)::int n FROM analytics_events
    WHERE player_id=$1::uuid AND event_name='acquisition_touch'
      AND event_props->>'campaign'='merge-first-touch'`,[target.playerId])).rows[0].n),1,
    'first-touch creator attribution remains available for subsequent Daily reporting');

  // A privacy retirement that initially observes an unpublished draft must
  // re-evaluate publication state if a publish becomes accepted before the
  // privacy scrub commits. This runs the production helper against real
  // PostgreSQL while deliberately interleaving the two operations.
  const privacyRaceChallenge=crypto.randomUUID(),privacyRaceSlug=`privacy-race-${tag}`;
  await query(`INSERT INTO creator_challenges(
      id,slug,source_session_id,source_owner_player_id,source_type,source_day,source_environment,
      creator_public_name,headline,acquisition_source,acquisition_campaign,status,
      created_by_admin_auth_user_id,publication_detail
    ) VALUES($1::uuid,$2,NULL,$3::uuid,'practice',NULL,'mixed',
      'Privacy Race Creator','Privacy race challenge','creator',$2,'draft',
      $4::uuid,'{}'::jsonb)`,[
    privacyRaceChallenge,privacyRaceSlug,paidModeGuest.playerId,targetAuth,
  ]);
  let releasePrivacyRead,signalPrivacyRead;
  const privacyReadHeld=new Promise(resolve=>{signalPrivacyRead=resolve;});
  const privacyReadRelease=new Promise(resolve=>{releasePrivacyRead=resolve;});
  let privacyReadIntercepted=false;
  const privacyRaceQuery=async(sql,params=[])=>{
    const result=await query(sql,params);
    if(!privacyReadIntercepted
      &&sql.includes('SELECT c.*,s.score source_score')
      &&String(params[0])===privacyRaceChallenge) {
      privacyReadIntercepted=true;
      signalPrivacyRead();
      await privacyReadRelease;
    }
    return result;
  };
  const publicationEnv={PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:'github_pat_fixture_abcdefghijklmnopqrstuvwxyz'};
  const publicationFetcher=async(url,options={})=>{
    if(String(url).includes('/actions/workflows/campaign-link-publish.yml/runs'))
      return Response.json({workflow_runs:[]});
    if(String(url).endsWith('/dispatches'))return new Response(null,{status:204});
    throw new Error('Unexpected publication fetch: '+url+' '+String(options?.method||'GET'));
  };
  const privacyRacePromise=requestCreatorPrivacyRetirement(
    privacyRaceQuery,paidModeGuest.playerId,
    {reason:'account_deletion',env:publicationEnv,fetcher:publicationFetcher},
  );
  await privacyReadHeld;
  const publishRaceRow=await creatorChallengeById(query,privacyRaceChallenge);
  const acceptedPublish=await beginCreatorPublicationOperation(
    query,publishRaceRow,'publish',{reason:'privacy_race_publish'},
  );
  await dispatchCreatorPublicationAttempt(
    query,acceptedPublish.row,acceptedPublish.operation,'publish',
    {env:publicationEnv,fetcher:publicationFetcher},
  );
  releasePrivacyRead();
  const privacyRaceReady=await privacyRacePromise;
  assert.equal(privacyRaceReady,false,
    'privacy cleanup stays pending when an initially unseen publish becomes accepted');
  const privacyRaceFinal=(await query(`SELECT status,creator_public_name,
      publication_operation_ref::text publication_operation_ref,publication_detail
    FROM creator_challenges WHERE id=$1::uuid`,[privacyRaceChallenge])).rows[0];
  const privacyRaceDetail=typeof privacyRaceFinal.publication_detail==='string'
    ?JSON.parse(privacyRaceFinal.publication_detail)
    :privacyRaceFinal.publication_detail;
  assert.equal(privacyRaceFinal.status,'retired');
  assert.equal(privacyRaceFinal.creator_public_name,'A creator');
  assert.notEqual(privacyRaceFinal.publication_operation_ref,acceptedPublish.operation,
    'retirement supersedes the accepted publish operation instead of discarding it as unnecessary');
  assert.equal(privacyRaceDetail.action,'retire');
  assert.equal(privacyRaceDetail.static_cleanup,'required');
  assert.equal(privacyRaceDetail.live_verified,false);
  assert.equal(privacyRaceDetail.dispatch.state,'pending',
    'retirement is not dispatched until the superseded accepted publish has settled');
  assert.equal(privacyRaceDetail.superseded_publish.operation,acceptedPublish.operation);
  assert.equal(privacyRaceDetail.superseded_publish.dispatch.state,'accepted');

  const settledPublishFetcher=async(url,options={})=>{
    if(String(url).includes('/actions/workflows/campaign-link-publish.yml/runs'))
      return Response.json({workflow_runs:[{
        id:987654,
        display_title:'Publish creator / '+acceptedPublish.operation,
        status:'completed',
        conclusion:'success',
        html_url:'https://github.example/runs/987654',
      }]});
    if(String(url).endsWith('/dispatches'))return new Response(null,{status:204});
    throw new Error('Unexpected settled publication fetch: '+url+' '+String(options?.method||'GET'));
  };
  const privacyRaceStillPending=await requestCreatorPrivacyRetirement(
    query,paidModeGuest.playerId,
    {reason:'account_deletion',env:publicationEnv,fetcher:settledPublishFetcher},
  );
  assert.equal(privacyRaceStillPending,false,
    'privacy cleanup remains pending after ordering the retirement behind the prior publish');
  const orderedPrivacyRaw=(await query(
    'SELECT publication_detail FROM creator_challenges WHERE id=$1::uuid',
    [privacyRaceChallenge],
  )).rows[0].publication_detail;
  const orderedPrivacy=typeof orderedPrivacyRaw==='string'?JSON.parse(orderedPrivacyRaw):orderedPrivacyRaw;
  assert.equal(orderedPrivacy.superseded_publish.operation,acceptedPublish.operation);
  assert.equal(orderedPrivacy.dispatch.state,'accepted',
    'retirement dispatch starts only after the superseded publish is completed');

  // Exercise later creator privacy cleanup without requiring live publication
  // infrastructure in this isolated database. The merge/result associations
  // must remain internally consistent when creator identity is scrubbed.
  await query(`UPDATE creator_challenges
    SET status='draft',published_at=NULL,publication_operation_ref=NULL,publication_detail='{}'::jsonb
    WHERE id IN ($1::uuid,$2::uuid,$3::uuid,$4::uuid)`,[
    runtimeChallenge,paidChallenge,challengeCompletedGuest,challengePartialGuest,
  ]);
  const privacyReady=await requestCreatorPrivacyRetirement(query,creator.playerId,{reason:'account_deletion'});
  assert.equal(privacyReady,true,'synthetic unpublished fixture challenges require no static cleanup');
  for(const challengeId of [runtimeChallenge,paidChallenge,challengeCompletedGuest,challengePartialGuest]) {
    const privacy=(await query(`SELECT status,creator_public_name,creator_handle,headline,
        creator_post_run_note,source_owner_auth_user_id,privacy_removed_at
      FROM creator_challenges WHERE id=$1::uuid`,[challengeId])).rows[0];
    assert.equal(privacy.status,'retired');
    assert.equal(privacy.creator_public_name,'A creator');
    assert.equal(privacy.creator_handle,null);
    assert.equal(privacy.headline,'Creator challenge unavailable');
    assert.equal(privacy.creator_post_run_note,null);
    assert.equal(privacy.source_owner_auth_user_id,null);
    assert.ok(privacy.privacy_removed_at);
  }
  const scrubbed=(await query(`SELECT opponent_name FROM game_results
    WHERE player_id=$1::uuid AND client_result_id=$2`,[
    target.playerId,`draft-run:${targetCompleteId}`,
  ])).rows[0];
  assert.equal(scrubbed.opponent_name,'A creator','privacy cleanup scrubs retained creator labels after merge');

  console.log('Creator challenge identity merge, stats, result demotion, telemetry uniqueness and privacy cleanup verified.');
} finally {
  // The backend gate runs against an isolated disposable database branch.
}
