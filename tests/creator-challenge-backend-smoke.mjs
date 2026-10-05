import fs from 'node:fs';
import assert from 'node:assert/strict';
import {withPracticeAccess} from './practice-access-fixture.mjs';

if(!process.argv.includes('--dev-fixtures'))throw Error('Requires an isolated fixture database.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();

const {default:growth,query}=await import('../worker/growth-function.js');
const {default:runApi}=await import('../worker/draft-run-function.mjs');
const {creatorChallengeById}=await import('../worker/creator-challenges.mjs');

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
  const startHash='a'.repeat(64),requestHash='b'.repeat(64);
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
        'start_idempotency_hash',$6,
        'start_request_hash',$7,
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

const tag=crypto.randomUUID().slice(0,8);
const creator=await call(growth,'/v1/session',{displayName:'Merge Creator '+tag});
const target=await call(growth,'/v1/session',{displayName:'Merge Account '+tag});
const guestCompleted=await call(growth,'/v1/session',{displayName:'Merge Guest Complete '+tag});
const guestPartial=await call(growth,'/v1/session',{displayName:'Merge Guest Partial '+tag});
const targetAuth=crypto.randomUUID();

try {
  const template=await completePractice(creator);
  await query(`UPDATE players SET profile_public=true,username_owned=true WHERE id=$1::uuid`,[creator.playerId]);
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

  await query('SELECT merge_pack1_player($1::uuid,$2::uuid)',[guestCompleted.playerId,target.playerId]);

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
  assert.equal(authoritative.creator_challene_id,challengePartialGuest);
  assert.equal(authoritative.creator_participant_auth_user_id,targetAuth);

  const stats=await creatorChallengeById(query,challengePartialGuest,{includeStats:true});
  assert.equal(stats.attempts,1,'only the established completed creator attempt counts after merge');
  assert.equal(stats.wins+stats.ties+stats.losses,1);
  assert.equal(Number( ¡Ý¥ÐÅÕÉä¡M1P½Õ¹Ð ¨¤èé¥¹Ð¸I=4ÉÑ}ÉÕ¹}ÍÍÍ¥½¹Ì(]!IÉÑ½É}¡±±¹}¥ôÄèéÕÕ¥9ÉÑ½É}ÁÉÑ¥¥Á¹Ñ}ÕÑ¡}ÕÍÉ}¥ôÈèéÕÕ¥±l(¡±±¹AÉÑ¥±ÕÍÐ±ÑÉÑÕÑ °(t¤¤¹É½ÝÍlÁt¹¸¤°Ä°ÉÑ½ÈÁÉÑ¥¥Á¹ÐÕ¹¥ÅÕ¹ÍÌÉµ¥¹Ì¥¹ÑÐÑÈµÉ¤ì(ÍÍÉÐ¹ÅÕ°¡9ÕµÈ¢vBVW'4TÄT5B6÷VçB¢£¦çBâe$ôÒæÇF75öWfVçG0¢tU$RÆW%öCÒC£§WVBäBWfVçEöæÖSÒv7&VF÷%ö6ÆÆVævU÷7F'FVBp¢äBWfVçE÷&÷2Óãâv7&VF÷%ö6ÆÆVævUöBsÒC&Å·F&vWBçÆW$BÆ6ÆÆVævU'FÄwVW7EÒç&÷w5³ÒæâÃ° ¢6öç6öÆRæÆört7&VF÷"wVW7Bö66÷VçBGWÆ6FRÖW&vR&W6W'fW2&7F6R7F÷'æBWF÷&FFfR7&VF÷"7FG2âr°§ÒfæÆÇ°¢vBVW'tDTÄUDRe$ôÒ66÷VçEöÆæ·2tU$RWF÷W6W%öCÒC£§WVBrÅ·F&vWDWFÒæ6F6Óç·Ò°¢vBVW'tDTÄUDRe$ôÒæVöåöWFâ'W6W""tU$RCÒC£§WVBrÅ·F&vWDWFÒæ6F6Óç·Ò°§Ð