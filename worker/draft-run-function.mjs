import {SERVING_POLICY_VERSION,LEGACY_SERVING_POLICY_VERSION,SERVING_QUALITY_SQL} from '../serving-quality.mjs';
import {accountCapabilities,requireCapability,practiceCapability} from './capabilities.mjs';
import {componentBelongsTo,corpusMembership} from './corpus-components.mjs';
import {liveRegularSets,recencyWeight} from '../daily-selection.mjs';
import {accountIdentity,linkedPlayerIdentity,rankingIdentityStatus} from './account-identity.mjs';
import {releaseMetadata} from './release.mjs';
import {ADMIN_API_VERSION} from '../admin-api-contract.mjs';
import {guardIngress} from './ingress-auth.mjs';
import {verifyDailyGenerationToken} from './daily-generation-auth.mjs';
import {neonTriggerInvocationHeader,verifyNeonScheduleTrigger,zonedDateTime} from './neon-trigger.mjs';
import {DAILY_ENVIRONMENTS,generateDailyEnvironmentResults} from './daily-generation-results.mjs';
import {ensureDailySchedule as ensureDailyScheduleForQuery} from './draft-run-daily.mjs';
import {draftRunLeaderboardRows,normalizeLeaderboardPeriod,resolveCurrentSeason} from './draft-run-season.mjs';
import {consumePlayerLimit} from './request-limits.mjs';
import {draftStartTiming} from './draft-start-timing.mjs';
import {digest} from './account-session.mjs';
import corpusCatalog from '../corpus/draft-run/catalog.json' with {type:'json'};
import growth, { query, player, readJson, json, withCors, gameDateKey } from './growth-function.js';
import { handleTrophyImport } from './trophy-import.mjs';
import {observeDecision,measurementInput,MEASUREMENT_CTE} from './decision-measurements.mjs';
import {handleAdmin} from './measurement-admin.mjs';
import {creatorChallengeForPublic,publicCreatorChallenge,loadCreatorChallengeForStart,loadCreatorChallengeForExistingSession,creatorRevealState} from './creator-challenges.mjs';
import {loadPuzzleMetadata,selectCachedDatabaseRun,selectDatabaseReroll,loadLiveSetMetadata,loadCachedCustomSetMetadata,servingRevisionMatches,servingCacheUnavailable} from './draft-run-selection.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION,LEGACY_DIFFICULTY_VERSION,publicDifficulty,rateDraftRunPuzzle} from '../draft-run-difficulty.mjs';
import {DRAFT_RUN_SELECTION_VERSION,PREVIOUS_SELECTION_VERSION,regularRunSet,dailySetWeight,dailyRequiredSets,DRAFT_RUN_LENGTH} from '../draft-run-policy.mjs';
import {
  DRAFT_RUN_CORPUS_VERSION, DRAFT_RUN_SCORING_VERSION, gradeDraftRunPick,
  publicDraftRunPuzzle, validateDraftRunPuzzle, draftRunEnvironment, calibratedSupports, supportSharpening,
} from '../draft-run.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const DECISION_REPORT_REASONS=new Set(['draft_context','card_or_image','score_recommendation','broken','other']);
const environmentOf = s => s.environment || 'mixed';
const runLength = s => s.puzzle_ids.length;
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const fail = (message,status=400) => { throw Object.assign(new Error(message),{status}); };
const DAILY_GENERATION_PATH='/internal/daily-generation';
const DAILY_TRIGGER_NAMES=new Set(['pack1-daily-primary','pack1-daily-retry']);
const DAILY_TRIGGER_MINUTES=new Map([['pack1-daily-primary',7],['pack1-daily-retry',37]]);
const bearer=request=>{
  const value=String(request.headers.get('authorization')||'');
  return value.startsWith('Bearer ')?value.slice(7):'';
};

async function puzzle(id,corpusVersion) {
  const r=await query('SELECT payload FROM draft_run_verified_puzzles WHERE puzzle_id=$1',[id]);
  const p=r.rows[0] ? parse(r.rows[0].payload) : null;
  if(!validateDraftRunPuzzle(p,p?.corpus_version)||!await componentBelongsTo(query,p,corpusVersion)) fail('This puzzle failed its data-quality check.',503);
  return p;
}

function decode(row) {
  return {...row,source_components:parse(row.source_components||'[]'),custom_set_ids:parse(row.custom_set_ids||'[]'),leaderboard_eligible:row.leaderboard_eligible===true||row.leaderboard_eligible==='t',revision:Number(row.revision),puzzle_ids:parse(row.puzzle_ids),daily_featured_sets:parse(row.daily_featured_sets||'[]'),answers:parse(row.answers),rerolls:parse(row.rerolls),difficulty_anchors:parse(row.difficulty_anchors||'[]'),seen_sources:parse(row.seen_sources),score:row.score==null?null:Number(row.score)};
}

async function session(id,owner) {
  if(!UUID.test(id)) fail('Invalid run.');
  const r=await query('SELECT * FROM draft_run_sessions WHERE id=$1::uuid AND player_id=$2::uuid',[id,owner]);
  if(!r.rows[0]) fail('Run not found.',404);
  return decode(r.rows[0]);
}

async function share(id) {
  if(!/^[a-f0-9]{24}$/.test(id||'')) fail('Invalid shared run.');
  const r=await query('SELECT sh.id,sh.session_id,sh.display_name,sh.score,sh.puzzle_ids,s.player_id owner_player_id,s.environment,s.corpus_version,s.scoring_version,s.difficulty_version,s.selection_version,s.serving_policy_version,s.source_components,s.custom_set_ids FROM draft_run_shares sh JOIN draft_run_sessions s ON s.id=sh.session_id WHERE sh.id=$1',[id]);
  if(!r.rows[0]) fail('Shared run not found.',404);
  return {...r.rows[0],score:Number(r.rows[0].score),puzzle_ids:parse(r.rows[0].puzzle_ids),source_components:parse(r.rows[0].source_components||'[]'),custom_set_ids:parse(r.rows[0].custom_set_ids||'[]')};
}

async function persistResult(s) {
  if(s.answers.length!==runLength(s) || s.result_persisted_at) return;
  const score=Math.round(s.answers.reduce((n,a)=>n+a.score,0)/runLength(s));
  const grade=score>=90?'A':score>=80?'B':score>=65?'C':score>=50?'D':'F';
  const creator=s.creator_challenge_id?await loadCreatorChallengeForExistingSession(query,s.creator_challenge_id):null;
  const shared=!creator&&s.challenge_id ? await share(s.challenge_id) : null;
  const other=shared?.owner_player_id===s.player_id ? null : shared;
  const exact=creator
    ? JSON.stringify(creator.source.puzzle_ids)===JSON.stringify(s.puzzle_ids)
    : other && JSON.stringify(other.puzzle_ids)===JSON.stringify(s.puzzle_ids);
  const opponentName=creator?.challenge.creator_public_name||(exact?other?.display_name:null);
  const opponentScore=creator?.source.score??(exact?other?.score:null);
  const outcome=exact && opponentScore!=null ? score>opponentScore?'win':score<opponentScore?'loss':'tie' : null;
  const sets=[...new Set(s.answers.map(a=>a.puzzle.set_id))].map(id=>({set_id:id,score:Math.round(s.answers.filter(a=>a.puzzle.set_id===id).reduce((n,a)=>n+a.score,0)/s.answers.filter(a=>a.puzzle.set_id===id).length)}));
  // The unique result key makes completion retryable after a dropped response.
  // All career, environment, ranked, and funnel writes commit together.
  await query(`WITH ranked AS (
    INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json,details_json,is_featured)
    SELECT $1::uuid,$2::date,$16,'draft_run',$3::int,$4,$5::jsonb,$6::jsonb,true
    WHERE $2::date IS NOT NULL AND $18::boolean
      AND EXISTS (
        SELECT 1 FROM account_links a JOIN players p ON p.id=a.player_id
        WHERE a.player_id=$1::uuid
          AND p.username_owned=true
          AND p.public_identity_hidden_at IS NULL
      )
    ON CONFLICT(player_id,challenge_date,set_id,mode) DO NOTHING
  ), result AS (
    INSERT INTO game_results(player_id,set_id,mode,score,grade,seed,is_daily,challenge_id,opponent_name,opponent_score,outcome,client_result_id,creator_challenge_id)
    VALUES($1::uuid,$16,'draft_run',$3::int,$4,$7,$2::date IS NOT NULL,$8,$9,$10::int,$11,$12,$19::uuid)
    ON CONFLICT(player_id,client_result_id) DO NOTHING RETURNING id
  ), environments AS (
    INSERT INTO game_result_environments(game_result_id,set_id,score)
    SELECT r.id,e.set_id,e.score FROM result r CROSS JOIN jsonb_to_recordset($13::jsonb) e(set_id text,score smallint)
    ON CONFLICT DO NOTHING
  ), events AS (INSERT INTO analytics_events(player_id,event_name,event_props)
    SELECT $1::uuid,event_name,$14::jsonb FROM result CROSS JOIN jsonb_array_elements_text($15::jsonb) n(event_name)
  ) UPDATE draft_run_sessions SET result_persisted_at=now() WHERE id=$17::uuid AND player_id=$1::uuid`,
  [
    s.player_id,s.day,score,grade,JSON.stringify(s.answers.map(a=>a.selectedId)),
    JSON.stringify({run:s.id,corpus_version:s.corpus_version,source_components:s.source_components,serving_policy_version:s.serving_policy_version||LEGACY_SERVING_POLICY_VERSION,scoring_version:s.scoring_version,historical_matches:s.answers.filter(a=>a.historicalMatch).length,run_length:runLength(s),selection_version:s.selection_version,creator_challenge_id:s.creator_challenge_id||null}),
    s.seed,other?s.challenge_id:null,opponentName,opponentScore,outcome,`draft-run:${s.id}`,JSON.stringify(sets),
    JSON.stringify({mode:'draft_run',set_id:environmentOf(s),daily:Boolean(s.day),score,run_id:s.id,challenge:Boolean(other),outcome,creator_challenge_id:s.creator_challenge_id||null,creator_challenge_slug:creator?.challenge.slug||null,creator_source_type:creator?.challenge.source_type||null}),
    JSON.stringify(['game_completed',...(environmentOf(s)==='powered-cube'?['cube_completed']:[]),...(s.day?['daily_completed']:[]),...(exact&&other?['challenge_complete']:[]),...(creator?['creator_challenge_complete']:[])]),
    environmentOf(s),s.id,s.leaderboard_eligible,s.creator_challenge_id||null,
  ]);
}

async function responseFor(s,timing=null) {
  const complete=s.answers.length===runLength(s);
  if(complete && !s.result_persisted_at) await persistResult(s);
  const current=complete ? null : publicDraftRunPuzzle(await (timing?
    timing.step('first_puzzle',()=>puzzle(s.puzzle_ids[s.answers.length],s.corpus_version)):
    puzzle(s.puzzle_ids[s.answers.length],s.corpus_version)));
  const creator=s.creator_challenge_id?await loadCreatorChallengeForExistingSession(query,s.creator_challenge_id):null;
  const shared=!creator&&s.challenge_id ? await share(s.challenge_id) : null;
  const other=shared?.owner_player_id===s.player_id ? null : shared;
  let answers=s.answers,comparison=null;
  if(creator) {
    const reveal=creatorRevealState(creator.challenge,creator.source,s.answers,{complete,self:creator.source.player_id===s.player_id});
    answers=reveal.answers;
    comparison=reveal.comparison;
  } else if(other) {
    comparison={kind:'friend',name:other.display_name,score:other.score,exact:JSON.stringify(other.puzzle_ids)===JSON.stringify(s.puzzle_ids)};
  }
  const identityStatus=s.day?await rankingIdentityStatus(query,s.player_id):null;
  const rankedIdentity=s.day&&s.leaderboard_eligible&&identityStatus?.eligible?identityStatus:null;
  let standing=null;
  if(complete && s.day && s.leaderboard_eligible && rankedIdentity) {
    const r=await query(`SELECT count(*) total,1+count(*) FILTER(WHERE score>$2::int) rank,count(*) FILTER(WHERE score>=$2::int) through_ties
      FROM scores
      WHERE challenge_date=$1::date AND mode='draft_run' AND set_id=$3
        AND EXISTS (
          SELECT 1 FROM account_links a JOIN players p ON p.id=a.player_id
          WHERE a.player_id=scores.player_id
            AND p.username_owned=true
            AND p.public_identity_hidden_at IS NULL
        )`,[s.day,s.score,environmentOf(s)]);
    const row=r.rows[0],total=Number(row.total);
    standing={rank:Number(row.rank),total,percentile:total>=10?Math.max(1,Math.ceil(Number(row.through_ties)/total*100)):null,final:s.day<gameDateKey()};
  }
  const rankedName=rankedIdentity?.display_name||null;
  return {ranked_name:rankedName,ranking_identity:identityStatus?{eligible:identityStatus.eligible,reason:identityStatus.reason}:null,id:s.id,corpus_version:s.corpus_version,source_components:s.source_components,serving_policy_version:s.serving_policy_version||LEGACY_SERVING_POLICY_VERSION,run_length:runLength(s),daily_featured_sets:s.daily_featured_sets,set_reroll_allowed:!s.day&&!s.challenge_id&&!s.creator_challenge_id&&!s.custom_set_ids.length,custom_set_ids:s.custom_set_ids,leaderboard_eligible:Boolean(s.leaderboard_eligible&&rankedIdentity),environment:environmentOf(s),day:s.day,revision:s.revision,round:s.answers.length+1,complete,score:s.score,answers,rerolls:s.day||s.creator_challenge_id?{set:0,pack:0}:s.rerolls,current,comparison,standing,scoring_version:s.scoring_version,difficulty_version:s.difficulty_version,selection_version:s.selection_version,creator_challenge_id:s.creator_challenge_id||null};
}

const ensureDailySchedule=(day,environment)=>ensureDailyScheduleForQuery(query,day,environment);
async function generateDailySchedules(request) {
  if(request.method!=='POST')fail('Not found.',404);
  const body=await readJson(request);
  let day;
  if(neonTriggerInvocationHeader(request)) {
    const trigger=verifyNeonScheduleTrigger(request,body,{names:DAILY_TRIGGER_NAMES});
    const local=zonedDateTime(trigger.scheduledAt,'America/Los_Angeles');
    const expectedMinute=DAILY_TRIGGER_MINUTES.get(trigger.name);
    if(local.hour!==0||local.minute!==expectedMinute||local.date!==gameDateKey()) {
      console.log(JSON.stringify({event:'daily_generation_trigger_skipped',trigger:trigger.name,scheduled_at:trigger.scheduledAt}));
      return json({ok:true,skipped:true});
    }
    day=local.date;
  } else {
    await verifyDailyGenerationToken(bearer(request));
    if(Object.keys(body).some(key=>key!=='day'))fail('Unexpected Daily generation input.');
    day=String(body.day||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day!==gameDateKey())fail('Daily generation day denied.',409);
  }
  const started=Date.now();
  const results=await generateDailyEnvironmentResults(day,ensureDailySchedule);
  for(const row of results)if(row.status==='failed')console.error(JSON.stringify({
    event:'daily_generation_failed',
    date:day,
    environment:row.environment,
    error_class:row.error_class,
  }));
  const success=results.every(row=>row.status!=='failed');
  return json({ok:success,date:day,success,results,duration_ms:Math.max(0,Date.now()-started)},success?200:500);
}

async function start(request) {
  const timing=draftStartTiming(process.env.PACK1_CAPACITY_DIAGNOSTICS==='1');
  const owner=await timing.step('player',()=>player(request)),body=await timing.step('body',()=>readJson(request)),daily=body.daily===true;
  const entrySource=daily&&body.source==='result_share'?'result_share':null;
  const source=body.challenge ? await share(String(body.challenge)) : null;
  const creatorState=body.creatorChallenge ? await loadCreatorChallengeForStart(query,String(body.creatorChallenge),{today:gameDateKey()}) : null;
  if(source&&creatorState)fail('Choose either a shared run or a creator challenge.');
  if((source||creatorState)&&daily)fail('A challenge replay is separate from the Daily.');
  // Reopening an invitation as its source owner must never manufacture a
  // self-opponent attempt. Return the authoritative source session instead.
  if(source?.owner_player_id===owner)return json(await responseFor(await session(source.session_id,owner)));
  if(creatorState?.source?.player_id===owner)return json(await responseFor(await session(creatorState.source.id,owner)));
  if(source) {
    const previous=(await query(
      'SELECT * FROM draft_run_sessions WHERE player_id=$1::uuid AND challenge_id=$2 ORDER BY created_at,id LIMIT 1',
      [owner,source.id],
    )).rows[0];
    if(previous)return json(await responseFor(decode(previous)));
  }
  const account=await timing.step('identity',()=>daily?linkedPlayerIdentity(query,owner):accountIdentity(request,query,owner));
  if(creatorState) {
    const previous=(await query(
      `SELECT * FROM draft_run_sessions
       WHERE creator_challenge_id=$1::uuid
         AND (player_id=$2::uuid OR ($3::uuid IS NOT NULL AND creator_participant_auth_user_id=$3::uuid))
       ORDER BY (creator_participant_auth_user_id IS NOT NULL) DESC,created_at,id LIMIT 1`,
      [creatorState.challenge.id,owner,account?.auth_user_id||null],
    )).rows[0];
    if(previous)return json(await responseFor(decode(previous)));
  }
  const capabilities=daily||creatorState?[]:await timing.step('capability',()=>accountCapabilities(account,query));
  let environment;
  try { environment=draftRunEnvironment(creatorState?.source?.environment || source?.environment || body.environment || 'mixed'); }
  catch { fail('Invalid Draft Run environment.'); }
  const requestedSetIds=body.setIds??[];
  if(!Array.isArray(requestedSetIds)||requestedSetIds.some(value=>typeof value!=='string'||!/^[-a-z0-9]{2,40}$/.test(value)))fail('Choose valid sets.');
  if(creatorState&&requestedSetIds.length)fail('Creator challenge decisions are fixed.');
  const setIds=creatorState?[...(creatorState.source.custom_set_ids||[])]:requestedSetIds;
  if(daily&&setIds.length)fail('Daily sets are fixed.');
  if(environment==='latest'&&!daily&&!creatorState)fail('Latest-set runs are Daily only. Choose sets for custom practice.');
  if(environment!=='mixed'&&setIds.length)fail('Custom sets use regular Draft Runs.');
  if(!daily&&!creatorState)requireCapability(capabilities,practiceCapability(environment,setIds));
  const rawIdempotency=String(request.headers.get('x-idempotency-key')||'');
  if(rawIdempotency&&daily)fail('Practice idempotency keys are not valid for Daily runs.');
  if(rawIdempotency&&(source||creatorState))fail('Practice idempotency keys are not valid for challenge replays.');
  if(rawIdempotency&&!IDEMPOTENCY_KEY.test(rawIdempotency))fail('Invalid practice idempotency key.');
  // Shared and creator replays reject client idempotency keys. Their server
  // identities provide the stable key so dropped/concurrent starts converge.
  const startIdempotencyHash=source
    ? digest(`shared:${source.id}`)
    : creatorState
      ? digest(`creator:${creatorState.challenge.id}`)
      : rawIdempotency?digest(rawIdempotency):null;
  const startRequestHash=startIdempotencyHash?digest(JSON.stringify({
    version:1,environment,setIds:[...setIds].sort(),challenge:source?.id||null,creatorChallenge:creatorState?.challenge.id||null,qa:body.qa===true,
  })):null;
  if(startIdempotencyHash) {
    const previous=(await timing.step('idempotency',()=>query(
      'SELECT * FROM draft_run_sessions WHERE player_id=$1::uuid AND start_idempotency_hash=$2 LIMIT 1',
      [owner,startIdempotencyHash],
    ))).rows[0];
    if(previous) {
      if(previous.start_request_hash!==startRequestHash)
        fail('This practice start key was already used for a different request.',409);
      return json(await responseFor(decode(previous)));
    }
  }
  const day=daily?gameDateKey():null;
  if(day) {
    const old=await query('SELECT * FROM draft_run_sessions WHERE (player_id=$1::uuid OR daily_account_id=$4::uuid) AND day=$2::date AND environment=$3 ORDER BY daily_account_id NULLS LAST,created_at LIMIT 1',[owner,day,environment,account?.auth_user_id||null]);
    if(old.rows[0]) {
      if(account&&!old.rows[0].daily_account_id)await query(`WITH identity_allowed AS MATERIALIZED (
      SELECT 1 WHERE pack1_identity_attachment_allowed($2::uuid)
    )
      UPDATE draft_run_sessions SET daily_account_id=$2::uuid
      WHERE id=$1::uuid AND daily_account_id IS NULL AND EXISTS(SELECT 1 FROM identity_allowed)`,[old.rows[0].id,account.auth_user_id]);
      return json(await responseFor(decode(old.rows[0])));
    }
  }
  await timing.step('quota',()=>consumePlayerLimit(query,owner,'runs',{limit:30,seconds:600}));
  let seed=day
    ? `daily:${environment}:${day}:${DRAFT_RUN_CORPUS_VERSION}:${DRAFT_RUN_SELECTION_VERSION}`
    : creatorState
      ? `creator:${creatorState.challenge.id}:${owner}`
      : source
        ? `shared:${source.id}:${owner}`
        : startIdempotencyHash ? `practice:${startIdempotencyHash}` : crypto.randomUUID();
  const replaySource=creatorState?.source||source;
  let corpusVersion=replaySource?.corpus_version||DRAFT_RUN_CORPUS_VERSION,scoringVersion=replaySource?.scoring_version||DRAFT_RUN_SCORING_VERSION;
  let servingPolicy=replaySource?.serving_policy_version||(replaySource?LEGACY_SERVING_POLICY_VERSION:SERVING_POLICY_VERSION);
  let ids,featuredSets=[],difficultyVersion=replaySource?.difficulty_version||DRAFT_RUN_DIFFICULTY_VERSION,selectionVersion=replaySource?.selection_version||DRAFT_RUN_SELECTION_VERSION;
  for(let attempt=0;attempt<2;attempt++) {
    let practiceChoices=null;
    if(creatorState)ids=creatorState.source.puzzle_ids;
    else if(source)ids=source.puzzle_ids;
    else if(day) {
      const {schedule}=await ensureDailySchedule(day,environment);
      corpusVersion=schedule.corpus_version;scoringVersion=schedule.scoring_version;servingPolicy=schedule.serving_policy_version||LEGACY_SERVING_POLICY_VERSION;
      ids=parse(schedule.puzzle_ids);difficultyVersion=schedule.difficulty_version||LEGACY_DIFFICULTY_VERSION;
      selectionVersion=schedule.selection_version||PREVIOUS_SELECTION_VERSION;
      featuredSets=parse(schedule.daily_featured_sets||'[]');
      seed=`daily:${environment}:${day}:${schedule.corpus_version}:${selectionVersion}`;
    } else {
      practiceChoices=await timing.step('selection',()=>selectCachedDatabaseRun(timing.selectionQuery(query),DRAFT_RUN_CORPUS_VERSION,seed,environment,{setIds}));
      ids=practiceChoices.map(item=>item.puzzle_id);
    }
    const choices=practiceChoices||await loadPuzzleMetadata(query,corpusVersion,ids);
    if(choices.some(item=>!item || (environment==='powered-cube')!==(item.set_id==='powered-cube')))fail('This run uses an unavailable corpus.',409);
    const sources=choices.map(item=>item.source_draft_hash),anchors=choices.map(publicDifficulty);
    const rerolls=day||source||creatorState?{set:0,pack:0}:environment==='powered-cube'||setIds.length?{set:0,pack:2}:{set:1,pack:1};
    const dailyAccountId=day?account?.auth_user_id||null:null;
    const creatorParticipantId=creatorState?account?.auth_user_id||null:null;
    const identityGuardId=dailyAccountId||creatorParticipantId;
    const inserted=await timing.step('session_insert',()=>query(`WITH identity_allowed AS MATERIALIZED (
      SELECT 1 WHERE $25::uuid IS NULL OR pack1_identity_attachment_allowed($25::uuid)
    )
      INSERT INTO draft_run_sessions(player_id,day,seed,corpus_version,scoring_version,puzzle_ids,seen_sources,challenge_id,environment,rerolls,difficulty_version,difficulty_anchors,selection_version,measurement_qa,daily_featured_sets,daily_account_id,leaderboard_eligible,custom_set_ids,serving_policy_version,start_idempotency_hash,start_request_hash,creator_challenge_id,creator_participant_auth_user_id)
      SELECT $1::uuid,$2::date,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11,$12::jsonb,$13,
        $14::boolean OR COALESCE((SELECT display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)' FROM players WHERE id=$1::uuid),false),$15::jsonb,$16::uuid,$17::boolean,$18::jsonb,$19,$20,$21,$23::uuid,$24::uuid
      FROM identity_allowed
      WHERE $22::bigint IS NULL OR EXISTS (
        SELECT 1 FROM draft_run_serving_revision WHERE singleton AND revision=$22::bigint FOR SHARE
      )
      ON CONFLICT DO NOTHING RETURNING *`,[
        owner,day,seed,corpusVersion,scoringVersion,JSON.stringify(ids),JSON.stringify(sources),source?.id||null,environment,JSON.stringify(rerolls),
        difficultyVersion,JSON.stringify(anchors),selectionVersion,body.qa===true,JSON.stringify(featuredSets),dailyAccountId,Boolean(day&&account),
        JSON.stringify(setIds),servingPolicy,startIdempotencyHash,startRequestHash,practiceChoices?.servingRevision||null,
        creatorState?.challenge?.id||null,creatorParticipantId,identityGuardId,
      ]));
    let currentSession=inserted.rows[0];
    if(!currentSession&&day)currentSession=(await query('SELECT * FROM draft_run_sessions WHERE (player_id=$1::uuid OR daily_account_id=$4::uuid) AND day=$2::date AND environment=$3',[owner,day,environment,account?.auth_user_id||null])).rows[0];
    if(!currentSession&&creatorState) {
      currentSession=(await query(
        `SELECT * FROM draft_run_sessions
         WHERE creator_challenge_id=$1::uuid
           AND (player_id=$2::uuid OR ($3::uuid IS NOT NULL AND creator_participant_auth_user_id=$3::uuid))
         ORDER BY (creator_participant_auth_user_id IS NOT NULL) DESC,created_at,id LIMIT 1`,
        [creatorState.challenge.id,owner,creatorParticipantId],
      )).rows[0];
    }
    if(!currentSession&&startIdempotencyHash) {
      currentSession=(await query(
        'SELECT * FROM draft_run_sessions WHERE player_id=$1::uuid AND start_idempotency_hash=$2 LIMIT 1',
        [owner,startIdempotencyHash],
      )).rows[0];
      if(currentSession&&currentSession.start_request_hash!==startRequestHash)
        fail('This practice start key was already used for a different request.',409);
    }
    if(!currentSession&&practiceChoices&&!await servingRevisionMatches(query,practiceChoices.servingRevision))continue;
    if(!currentSession)fail('Could not start your run. Please retry.',409);
    if(inserted.rows.length)await timing.step('analytics_insert',()=>query(
      'INSERT INTO analytics_events(player_id,event_name,event_props) SELECT $1::uuid,value,$3::jsonb FROM jsonb_array_elements_text($2::jsonb)',
      [
        owner,
        JSON.stringify([day?'daily_started':'game_started',...(environment==='powered-cube'?['cube_started']:[]),...(creatorState?['creator_challenge_started']:[])]),
        JSON.stringify({mode:'draft_run',set_id:environment,daily,challenge:Boolean(source||creatorState),run_id:currentSession.id,...(creatorState?{creator_challenge_id:creatorState.challenge.id,creator_challenge_slug:creatorState.challenge.slug,creator_source_type:creatorState.challenge.source_type}:{}),...(entrySource?{source:entrySource}:{})}),
      ],
    ));
    return timing.finish(json(await timing.step('response',()=>responseFor(decode(currentSession),timing))));
  }
  throw servingCacheUnavailable();
}

async function change(request,id,action) {
  const timing=draftStartTiming(action==='reroll'&&process.env.PACK1_CAPACITY_DIAGNOSTICS==='1',{header:'x-pack1-reroll-timing'});
  const owner=await timing.step('player',()=>player(request)),body=await timing.step('body',()=>readJson(request)),s=await timing.step('session',()=>session(id,owner));
  const round=Number(body.round);
  // Exact retry of a committed answer is safe; changing it never is.
  if(action==='pick' && Number.isInteger(round) && s.answers[round]?.selectedId===body.cardId && s.answers[round]?.puzzle.puzzle_id===body.puzzleId) return json(await responseFor(s));
  if(s.answers.length>=runLength(s)) fail('This run is complete.',409);
  if(s.day && s.day!==gameDateKey()) fail('This Daily has closed. Start today’s run.',410);
  if(s.revision!==body.revision || round!==s.answers.length || body.puzzleId!==s.puzzle_ids[round]) fail('Your run changed in another tab. Reload to continue.',409);
  if(action==='pick') {
    const p=await puzzle(body.puzzleId,s.corpus_version);
    if(!p.candidates.some(c=>c.id===body.cardId)) fail('Choose a card from this pack.');
    const grade=gradeDraftRunPick(p,body.cardId);
    const evidence=rateDraftRunPuzzle(p);
    grade.modelTargetDisagreement=evidence.modelTargetDisagreement;
    s.answers.push({...grade,puzzle:publicDraftRunPuzzle(p),ranking:(()=>{const calibrated=calibratedSupports(p.candidates,supportSharpening(p.corpus_version));return [...p.candidates].sort((a,b)=>b.model_probability-a.model_probability).map(c=>({id:c.id,name:c.name,support:calibrated.get(c.id),score:gradeDraftRunPick(p,c.id).score}));})()});
    if(s.answers.length===runLength(s)) s.score=Math.round(s.answers.reduce((n,a)=>n+a.score,0)/runLength(s));
  } else {
    if(s.day)fail('Daily runs are fixed. Rerolls are available in practice.',409);
    if(s.creator_challenge_id)fail('Creator challenges use fixed decisions and cannot be rerolled.',409);
    const type=body.type;
    if(!['set','pack'].includes(type)) fail('Invalid reroll.');
    if(environmentOf(s)==='powered-cube' && type==='set') fail('Powered Cube has two pack rerolls and no set reroll.');
    if(!Number.isInteger(s.rerolls[type]) || s.rerolls[type]<1) fail('That reroll has already been used.',409);
    const [current]=await timing.step('metadata',()=>loadPuzzleMetadata(timing.selectionQuery(query),s.corpus_version,[body.puzzleId]));
    if(!current) fail('This puzzle is unavailable.',503);
    
    const replacement=await timing.step('selection',()=>selectDatabaseReroll(timing.selectionQuery(query),s.corpus_version,current,{type,round,seed:s.seed,excludedSources:s.seen_sources,environment:environmentOf(s),difficultyVersion:s.difficulty_version||LEGACY_DIFFICULTY_VERSION,selectionVersion:s.selection_version||PREVIOUS_SELECTION_VERSION,daily:Boolean(s.day),day:s.day||gameDateKey(),anchor:s.difficulty_anchors[round],setIds:s.custom_set_ids}));
    if(!replacement) fail('No comparable replacement is available. Your reroll is still yours.',409);
    s.puzzle_ids[round]=replacement.puzzle_id;s.seen_sources.push(replacement.source_draft_hash);s.rerolls[type]-=1;
  }
  const answer=action==='pick'?s.answers.at(-1):null,{viewId,activeMs}=measurementInput(body);
  const updated=await timing.step('update',()=>query(`WITH changed AS (UPDATE draft_run_sessions SET puzzle_ids=$3::jsonb,answers=$4::jsonb,rerolls=$5::jsonb,seen_sources=$6::jsonb,score=$7::int,revision=revision+1,updated_at=now() WHERE id=$1::uuid AND revision=$2::int AND player_id=$8::uuid RETURNING *),
    ${MEASUREMENT_CTE} SELECT * FROM changed`,[id,s.revision,JSON.stringify(s.puzzle_ids),JSON.stringify(s.answers),JSON.stringify(s.rerolls),JSON.stringify(s.seen_sources),s.score,owner,round+1,body.puzzleId,action==='pick'?'pick':body.type,answer?.selectedId||null,answer?.score??null,answer?.historicalMatch??null,viewId,activeMs]));
  if(!updated.rows[0]) fail('Your run changed in another tab. Reload to continue.',409);
  return timing.finish(json(await timing.step('response',()=>responseFor(decode(updated.rows[0])))));
}

async function reportDecision(request,id) {
  const owner=await player(request);
  await consumePlayerLimit(query,owner,'decision_report',{limit:20,seconds:3600});
  const body=await readJson(request),s=await session(id,owner),round=Number(body.round);
  if(!Number.isInteger(round)||round<0||round>=s.answers.length)fail('Choose a revealed decision to report.');
  const answer=s.answers[round];
  if(body.puzzleId!==answer?.puzzle?.puzzle_id)fail('Reported decision no longer matches this run.',409);
  const reason=String(body.reason||'');
  if(!DECISION_REPORT_REASONS.has(reason))fail('Choose what seems wrong.');
  const comment=body.comment==null?'':String(body.comment).trim();
  if(comment.length>500)fail('Comment is too long.');
  const client=body.client&&typeof body.client==='object'?body.client:{};
  const clientPlatform=['web','ios','android'].includes(client.platform)?client.platform:'unknown';
  const clientField=value=>{
    if(value==null||value==='')return null;
    const text=String(value).trim();
    if(!text||text.length>64)fail('Invalid client version metadata.');
    return text;
  };
  const fullPuzzle=await puzzle(answer.puzzle.puzzle_id,s.corpus_version);
  const recommended=(Array.isArray(answer.ranking)&&answer.ranking[0])
    || [...(fullPuzzle.candidates||[])].sort((a,b)=>Number(b.model_probability||0)-Number(a.model_probability||0))[0]
    || null;
  const recommendedId=recommended?.id||null;
  const recommendedName=recommended?.name||null;
  const recommendedScore=recommendedId?gradeDraftRunPick(fullPuzzle,recommendedId).score:null;
  const release=releaseMetadata().release_commit;
  const inserted=await query(`INSERT INTO draft_run_decision_reports(
      run_id,player_id,puzzle_id,set_id,pick_number,round_number,
      selected_card_id,selected_card_name,recommended_card_id,recommended_card_name,recommended_card_score,
      reason,comment,environment,daily_date,corpus_version,model_version,scoring_version,
      difficulty_version,selection_version,serving_policy_version,backend_release,
      client_platform,client_version,client_build
    ) VALUES(
      $1::uuid,$2::uuid,$3,$4,$5::smallint,$6::smallint,
      $7,$8,$9,$10,$11::smallint,$12,$13,$14,$15::date,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
    ) RETURNING id`,[
      s.id,owner,answer.puzzle.puzzle_id,answer.puzzle.set_id,Number(answer.pickNumber||answer.puzzle.pick_number),round+1,
      answer.selectedId,answer.selectedName,recommendedId,recommendedName,recommendedScore,
      reason,comment||null,environmentOf(s),s.day||null,s.corpus_version,fullPuzzle.model_version||null,s.scoring_version,
      s.difficulty_version||null,s.selection_version||null,s.serving_policy_version||LEGACY_SERVING_POLICY_VERSION,release,
      clientPlatform,clientField(client.version),clientField(client.build),
    ]);
  return json({ok:true,id:inserted.rows[0].id});
}

async function createShare(request,id) {
  const owner=await player(request),s=await session(id,owner);
  if(s.answers.length!==runLength(s)) fail('Finish the run before sharing it.');
  if(s.day)return json({daily:true,day:s.day,environment:environmentOf(s),url:`/?game=draft-run&daily=1${environmentOf(s)!=='mixed'?'&set='+environmentOf(s):''}`});
  if(s.creator_challenge_id) {
    const state=await loadCreatorChallengeForExistingSession(query,s.creator_challenge_id);
    if(state.challenge.status!=='published')fail('This creator challenge is retired and can no longer be shared.',410);
    const info=publicCreatorChallenge(state.challenge);
    return json({creator:true,id:state.challenge.id,slug:state.challenge.slug,url:info.public_url});
  }
  if(s.challenge_id){const original=await share(s.challenge_id);if(JSON.stringify(original.puzzle_ids)===JSON.stringify(s.puzzle_ids))return json({id:original.id});}
  const name=(await linkedPlayerIdentity(query,owner))?.display_name||'A friend';
  const key=crypto.randomUUID().replaceAll('-','').slice(0,24);
  const r=await query(`INSERT INTO draft_run_shares(id,session_id,display_name,score,puzzle_ids) VALUES($1,$2::uuid,$3,$4::int,$5::jsonb) ON CONFLICT(session_id) DO UPDATE SET session_id=EXCLUDED.session_id RETURNING id`,[key,id,name,s.score,JSON.stringify(s.puzzle_ids)]);
  return json({id:r.rows[0].id});
}

async function dailyStatus(request) {
  const owner=await player(request),account=await accountIdentity(request,query,owner),day=gameDateKey();
  // Keep ranking-identity policy in its existing helper, but collapse the other
  // independent homepage reads into one SQL-over-HTTP request. The distributed
  // hold opens synchronously, so fanning every status request into several
  // simultaneous database requests amplifies the burst before practice starts.
  const [statusResult,rankingIdentity]=await Promise.all([
    query(`WITH history AS (
        SELECT day::text date,environment set_id,'draft_run' mode,score,id run_id
        FROM draft_run_sessions WHERE player_id=$1::uuid AND day=$2::date
          AND jsonb_array_length(answers)=jsonb_array_length(puzzle_ids)
      ), completed_days AS (
        SELECT DISTINCT day FROM draft_run_sessions
        WHERE player_id=$1::uuid AND day IS NOT NULL AND day<=$2::date
          AND jsonb_array_length(answers)=jsonb_array_length(puzzle_ids)
      ), ordered AS (
        SELECT day,(row_number() OVER(ORDER BY day DESC)-1)::int day_offset FROM completed_days
      )
      SELECT
        COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM history h),'[]'::jsonb) daily_history,
        (SELECT count(*)::int FROM ordered WHERE day=$2::date-day_offset) streak,
        COALESCE((SELECT jsonb_agg(DISTINCT capability ORDER BY capability)
          FROM entitlement_grants
          WHERE $3::uuid IS NOT NULL AND auth_user_id=$3::uuid
            AND capability IN ('custom_corpus','unlimited_cube_practice')
            AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())),'[]'::jsonb) paid_capabilities,
        EXISTS(SELECT 1 FROM provider_accounts
          WHERE $3::uuid IS NOT NULL AND auth_user_id=$3::uuid AND provider='patreon') membership_connected`,
      [owner,day,account?.auth_user_id||null]),
    rankingIdentityStatus(query,owner),
  ]);
  const status=statusResult.rows[0]||{},paid=parse(status.paid_capabilities||'[]');
  const capabilities=account?['account','unlimited_regular_practice',...paid]:[];
  const membership={connected:['t','true','1'].includes(String(status.membership_connected))};
  const history=parse(status.daily_history||'[]');
  return json({day,capabilities,player:{claimed:Boolean(account)},membership,ranking_identity:{eligible:rankingIdentity.eligible,reason:rankingIdentity.reason},daily_streak:Number(status.streak||0),daily_history:history.map(r=>({...r,score:Number(r.score)}))});
}

async function leaderboard(request) {
  const url=new URL(request.url),period=normalizeLeaderboardPeriod(url.searchParams.get('period')||'daily');
  if(!['daily','week','season','all'].includes(period)) fail('Invalid leaderboard period.');
  let environment;try{environment=draftRunEnvironment(url.searchParams.get('environment')||'mixed');}catch{fail('Invalid Draft Run environment.');}
  const today=gameDateKey();
  const season=period==='season'?await resolveCurrentSeason(query,{today,ensureSchedule:ensureDailyScheduleForQuery}):null;
  if(period==='season'&&!season)return json({period:'season',environment,start:null,today,season:null,rows:[]});
  const start=period==='daily'?today:period==='season'?season.start_date:period==='week'?(()=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);})():'2000-01-01';
  const blockedByPlayerId=await player(request,false);
  const rows=await draftRunLeaderboardRows(query,{start,end:today,environment,blockedByPlayerId,limit:100});
  return json({period,environment,start,today,season:period==='season'?season:null,rows});
}
async function route(request) {
  const url=new URL(request.url),path=url.pathname;
  if(path===DAILY_GENERATION_PATH) return generateDailySchedules(request);
  if(path==='/v1/trophy-import') return json(await handleTrophyImport(request,query));
  if(request.method==='OPTIONS') return new Response(null,{status:204});
  if(path.startsWith('/v1/admin/')) return json(await handleAdmin(request,query,readJson));
  if(request.method==='GET'&&path==='/health') {
    if(url.searchParams.get('quick')==='1')return json({ok:true,service:'draft-run',admin_api_version:ADMIN_API_VERSION,...releaseMetadata()});
    const result=await query(`SELECT p.set_id,count(*)::int archived,
      count(*) FILTER(WHERE r.puzzle_id IS NULL)::int unrated,
      count(*) FILTER(WHERE r.puzzle_id IS NOT NULL AND ${SERVING_QUALITY_SQL} AND p.pick_number BETWEEN CASE WHEN p.set_id='powered-cube' THEN 2 ELSE 1 END AND CASE WHEN p.set_id='powered-cube' THEN 9 ELSE 8 END)::int decisions,
      count(DISTINCT p.source_draft_hash) FILTER(WHERE r.puzzle_id IS NOT NULL AND ${SERVING_QUALITY_SQL} AND p.pick_number BETWEEN CASE WHEN p.set_id='powered-cube' THEN 2 ELSE 1 END AND CASE WHEN p.set_id='powered-cube' THEN 9 ELSE 8 END)::int drafts
      FROM draft_run_verified_puzzles p LEFT JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version=$2
      WHERE (${corpusMembership({serving:true})}) AND p.interesting AND p.pack_number=1 AND NOT EXISTS(SELECT 1 FROM corpus_source_exclusions x WHERE x.set_id=p.set_id AND x.corpus_version=p.corpus_version AND x.source_draft_hash=p.source_draft_hash) GROUP BY p.set_id`,[DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_DIFFICULTY_VERSION]);
    const rows=result.rows,sets=new Set(rows.map(p=>p.set_id)),unrated=rows.reduce((n,p)=>n+Number(p.unrated),0);
    const live=await loadLiveSetMetadata(query,DRAFT_RUN_CORPUS_VERSION),regular=liveRegularSets(live,gameDateKey()).map(s=>s.set_id);
    // Only a Live environment is expected to serve. Candidate, Paused and
    // Retired environments are intentionally absent from serving, so they are
    // reported rather than failed; a Live environment with nothing to serve fails.
    const liveIds=new Set(live.map(s=>s.set_id));
    const missingSets=live.filter(s=>!sets.has(s.set_id)).map(s=>s.set_id).sort();
    const nonServingSets=corpusCatalog.sets.map(s=>s.id).filter(id=>!liveIds.has(id)).sort();
    const by_set=Object.fromEntries(rows.filter(p=>Number(p.decisions)>0).sort((a,b)=>a.set_id.localeCompare(b.set_id)).map(p=>[p.set_id,{drafts:Number(p.drafts),decisions:Number(p.decisions),regular_run:regular.includes(p.set_id),status:live.some(s=>s.set_id===p.set_id)?'Live':'not-serving',daily_optional_weight:regular.includes(p.set_id)?recencyWeight(regular.indexOf(p.set_id)):null}]));
    const total=key=>rows.reduce((n,p)=>n+Number(p[key]),0),mixed=rows.filter(p=>regular.includes(p.set_id));
    const ok=!unrated&&!missingSets.length&&regular.length>=4&&corpusCatalog.corpus_version===DRAFT_RUN_CORPUS_VERSION;
    return json({ok,service:'draft-run',admin_api_version:ADMIN_API_VERSION,scoring_version:DRAFT_RUN_SCORING_VERSION,difficulty_version:DRAFT_RUN_DIFFICULTY_VERSION,selection_version:DRAFT_RUN_SELECTION_VERSION,corpus_version:DRAFT_RUN_CORPUS_VERSION,run_length:DRAFT_RUN_LENGTH,serving_policy_version:SERVING_POLICY_VERSION,minimum_implied_trophy_score:20,daily_featured_sets:regular.slice(0,4),daily_policy:{newest_minimum:2,previous_three_minimum:4,recency_half_life_releases:4},...releaseMetadata(),
      puzzles:total('decisions'),archived_playable_puzzles:total('archived'),sets:sets.size,expansion_sets:rows.filter(p=>p.set_id!=='powered-cube').length,regular_sets:mixed.length,
      mixed_puzzles:mixed.reduce((n,p)=>n+Number(p.decisions),0),cube_puzzles:Number(rows.find(p=>p.set_id==='powered-cube')?.decisions||0),unrated_puzzles:unrated,live_sets:live.length,missing_sets:missingSets,non_serving_sets:nonServingSets,by_set},ok?200:503);
  }
  if(request.method==='POST'&&path==='/v1/session') return growth.fetch(request);
  if(request.method==='POST'&&path==='/v1/runs') return start(request);
  if(request.method==='GET'&&path==='/v1/capabilities') {const owner=await player(request);return json({capabilities:await accountCapabilities(await accountIdentity(request,query,owner),query)});}
  if(request.method==='GET'&&path==='/v1/set-catalog') {
    const result=await query(`SELECT e.set_id,e.set_name,e.release_date::text,e.regular_run,
      v.manifest->>'source_date' data_date,
      NULLIF(v.manifest->'full_import'->>'training_drafts','')::int training_drafts,
      NULLIF(v.manifest->'full_import'->>'win_rate_cutoff','')::numeric win_rate_cutoff,
      NULLIF(v.manifest->'full_import'->>'qualified_trophies','')::int qualified_trophy_drafts,
      (COALESCE(NULLIF(v.manifest->'full_import'->>'total_puzzles','')::int,0)+COALESCE(c.component_puzzles,0))::int verified_decisions
      FROM draft_run_environment_policy e
      JOIN corpus_set_versions v ON v.set_id=e.set_id AND v.corpus_version=$1
      LEFT JOIN LATERAL (
        SELECT sum(NULLIF(cv.manifest->>'puzzles','')::int)::int component_puzzles
        FROM corpus_components cc JOIN corpus_set_versions cv
          ON cv.set_id=cc.set_id AND cv.corpus_version=cc.component_version
        WHERE cc.set_id=e.set_id AND cc.parent_version=$1 AND cc.status='Live'
      ) c ON true
      WHERE e.status='Live'
      ORDER BY e.release_date DESC NULLS LAST,e.set_id`,[DRAFT_RUN_CORPUS_VERSION]);
    return json({corpus_version:DRAFT_RUN_CORPUS_VERSION,sets:result.rows.map(s=>({...s,regular_run:s.regular_run===true||s.regular_run==='t',training_drafts:Number(s.training_drafts||0),win_rate_cutoff:s.win_rate_cutoff==null?null:Number(s.win_rate_cutoff),qualified_trophy_drafts:Number(s.qualified_trophy_drafts||0),verified_decisions:Number(s.verified_decisions||0)}))});
  }
  if(request.method==='GET'&&path==='/v1/practice-sets') {const owner=await player(request),caps=await accountCapabilities(await accountIdentity(request,query,owner),query);requireCapability(caps,'custom_corpus');return json({sets:await loadCachedCustomSetMetadata(query,DRAFT_RUN_CORPUS_VERSION)});}
  if(request.method==='GET'&&path==='/v1/daily-status') return dailyStatus(request);
  if(request.method==='GET'&&path==='/v1/leaderboard') return leaderboard(request);
  const creatorPublic=path.match(/^\/v1\/creator-challenges\/([a-z0-9-]{1,64})$/);
  if(request.method==='GET'&&creatorPublic) {
    const challenge=await creatorChallengeForPublic(query,creatorPublic[1],{today:gameDateKey()});
    const viewer=await player(request,false);
    if(viewer)await query(`INSERT INTO analytics_events(player_id,event_name,event_props)
      VALUES($1::uuid,'creator_challenge_open',$2::jsonb)`,[
        viewer,JSON.stringify({creator_challenge_id:challenge.id,creator_challenge_slug:challenge.slug,creator_source_type:challenge.source_type}),
      ]);
    return json(publicCreatorChallenge(challenge));
  }
  const match=path.match(/^\/v1\/runs\/([a-f0-9-]+)(?:\/(pick|reroll|share|view|report))?$/);
  if(match) {
    if(request.method==='POST'&&match[2]==='view') {
      const owner=await player(request),body=await readJson(request),s=await session(match[1],owner);
      if(body.revision!==s.revision||body.puzzleId!==s.puzzle_ids[s.answers.length])fail('Run changed.',409);
      return json(await observeDecision(query,s,body));
    }
    if(request.method==='GET'&&!match[2]) return json(await responseFor(await session(match[1],await player(request))));
    if(request.method==='POST'&&match[2]==='share') return createShare(request,match[1]);
    if(request.method==='POST'&&match[2]==='report') return reportDecision(request,match[1]);
    if(request.method==='POST'&&['pick','reroll'].includes(match[2])) return change(request,match[1],match[2]);
  }
  const shared=path.match(/^\/v1\/(?:challenges|shared-runs)\/([a-f0-9]+)$/);
  if(request.method==='GET'&&shared) { const s=await share(shared[1]);const scores=await query(`SELECT CASE WHEN p.username_owned
      AND p.public_identity_hidden_at IS NULL
      THEN p.display_name ELSE 'A friend' END name,r.score
      FROM draft_run_sessions r JOIN players p ON p.id=r.player_id
      WHERE r.score IS NOT NULL AND r.puzzle_ids=$2::jsonb
        AND (r.id=$3::uuid OR (r.challenge_id=$1 AND r.player_id<>$4::uuid))
      ORDER BY r.score DESC,r.created_at LIMIT 100`,[s.id,JSON.stringify(s.puzzle_ids),s.session_id,s.owner_player_id]);return json({id:s.id,name:s.display_name,score:s.score,scores:scores.rows,environment:s.environment,run_length:s.puzzle_ids.length}); }
  return json({error:'Not found.'},404);
}

export default {async fetch(request) {
  const internal=new URL(request.url).pathname===DAILY_GENERATION_PATH;
  if(!internal){const denied=guardIngress(request);if(denied)return denied;}
  try {const response=await route(request);response.headers.set('cache-control','no-store');return withCors(response,request);}
  catch(error) {const status=Number(error.status)||500;if(status===500) console.error('Draft Run request failed',error.message);const response=json({error:status===500?'Could not save your run. Please retry.':error.message,...(error.capability?{capability:error.capability}:{}),...(error.code?{code:String(error.code)}:{})},status);if(error.retryAfter)response.headers.set('retry-after',String(error.retryAfter));return withCors(response,request);}
}};
