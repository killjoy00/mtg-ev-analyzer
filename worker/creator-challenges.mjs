import {buildCampaignTrackingUrl,buildCampaignVanityUrl,normalizeAcquisitionValue,normalizeCampaignSlug} from '../campaign-links.mjs';
import {componentBelongsTo} from './corpus-components.mjs';
import {validateDraftRunPuzzle} from '../draft-run.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHARE=/^[a-f0-9]{24}$/;
const PACK_ONE_HOSTS=new Set(['packone.pro','www.packone.pro']);
const SOURCE_TYPES=new Set(['practice','daily']);
const SOURCE_ENVIRONMENTS=new Set(['mixed','powered-cube','latest']);
const ALLOWED_PRACTICE_URL_PARAMS=new Set(['game','shared','challenge','set','utm_source','utm_campaign','utm_medium','ref']);
const bool=value=>value===true||value==='t'||value==='true';
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const fail=(message,status=400,code=null)=>{throw Object.assign(Error(message),{status,...(code?{code}:{})});};

function plain(value,{required=false,max=160,label='Value'}={}) {
  const text=String(value??'').trim();
  if(required&&!text)fail(`${label} is required.`);
  if(text.length>max)fail(`${label} is too long.`);
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))fail(`${label} contains unsupported characters.`);
  return text||null;
}

export function parsePracticeShareReference(input) {
  const raw=String(input??'').trim();
  if(SHARE.test(raw))return raw;
  let url;
  try {url=new URL(raw);} catch {fail('Enter a valid Pack One shared-run URL or 24-character share ID.');}
  if(url.protocol!=='https:'||!PACK_ONE_HOSTS.has(url.hostname.toLowerCase())||url.username||url.password||url.port||url.hash)
    fail('Use a Pack One shared-run URL from an approved Pack One origin.');
  let id=null;
  const pathname=url.pathname.replace(/\/+$/,'')||'/';
  if(pathname==='/') {
    for(const key of url.searchParams.keys())if(!ALLOWED_PRACTICE_URL_PARAMS.has(key))fail('The shared-run URL contains unsupported parameters.');
    if(url.searchParams.get('game')!=='draft-run')fail('This is not a Draft Run share URL.');
    const shared=url.searchParams.get('shared'),challenge=url.searchParams.get('challenge');
    if(shared&&challenge&&shared!==challenge)fail('The shared-run URL is ambiguous.');
    id=shared||challenge;
  } else if(pathname==='/open/shared') {
    for(const key of url.searchParams.keys())if(key!=='id')fail('The shared-run URL contains unsupported parameters.');
    id=url.searchParams.get('id');
  } else {
    fail('This Pack One URL is not a supported shared-run route.');
  }
  if(!SHARE.test(String(id||'')))fail('The shared-run URL does not contain a valid share ID.');
  return String(id);
}

function decodeSource(row) {
  if(!row)return null;
  return {
    ...row,
    answers:parse(row.answers||'[]'),
    puzzle_ids:parse(row.puzzle_ids||'[]'),
    source_components:parse(row.source_components||'[]'),
    custom_set_ids:parse(row.custom_set_ids||'[]'),
    measurement_qa:bool(row.measurement_qa),
    profile_public:bool(row.profile_public),
    username_owned:bool(row.username_owned),
    score:row.score==null?null:Number(row.score),
  };
}

async function validateHistoricalPuzzles(query,source) {
  if(!Array.isArray(source.puzzle_ids)||source.puzzle_ids.length!==8)fail('Creator source must contain exactly eight decisions.',409,'CREATOR_SOURCE_INELIGIBLE');
  if(!Array.isArray(source.answers)||source.answers.length!==8||source.score==null)fail('Creator source run is not complete.',409,'CREATOR_SOURCE_INELIGIBLE');
  for(let index=0;index<8;index++) {
    const id=source.puzzle_ids[index],answer=source.answers[index];
    if(!answer||answer?.puzzle?.puzzle_id!==id||!answer.selectedId)fail('Creator source answers do not match the authoritative decision order.',409,'CREATOR_SOURCE_INELIGIBLE');
    const result=await query('SELECT payload FROM draft_run_verified_puzzles WHERE puzzle_id=$1',[id]);
    const puzzle=result.rows[0]?parse(result.rows[0].payload):null;
    if(!validateDraftRunPuzzle(puzzle,puzzle?.corpus_version)||!await componentBelongsTo(query,puzzle,source.corpus_version))
      fail('This source uses historical puzzle data that Pack One can no longer serve safely.',409,'CREATOR_SOURCE_UNAVAILABLE');
    if(!puzzle.candidates.some(card=>card.id===answer.selectedId))
      fail('A creator selection is not part of its authoritative historical pack.',409,'CREATOR_SOURCE_INELIGIBLE');
  }
}

async function sourceSession(query,id,{expectedPlayerId=null,expectedType=null,shareId=null}={}) {
  if(!UUID.test(String(id||'')))fail('Invalid creator source session.');
  const result=await query(`SELECT s.*,p.display_name,p.profile_public,p.username_owned,p.public_identity_hidden_at,
      a.auth_user_id source_owner_auth_user_id
    FROM draft_run_sessions s
    JOIN players p ON p.id=s.player_id
    LEFT JOIN account_links a ON a.player_id=s.player_id
    WHERE s.id=$1::uuid LIMIT 1`,[id]);
  const source=decodeSource(result.rows[0]);
  if(!source)fail('Creator source run not found.',404,'CREATOR_SOURCE_NOT_FOUND');
  if(expectedPlayerId&&String(source.player_id)!==String(expectedPlayerId))fail('The selected creator does not own that Daily.',409,'CREATOR_SOURCE_MISMATCH');
  const type=source.day?'daily':'practice';
  if(expectedType&&type!==expectedType)fail(`This source is not a completed ${expectedType==='daily'?'Daily':'Practice'} run.`,409,'CREATOR_SOURCE_TYPE');
  if(source.measurement_qa)fail('QA-only runs cannot become public creator challenges.',409,'CREATOR_SOURCE_QA');
  if(source.public_identity_hidden_at||!source.profile_public)fail('This creator is not currently eligible for public promotion.',409,'CREATOR_IDENTITY_PRIVATE');
  if(!SOURCE_ENVIRONMENTS.has(source.environment||'mixed'))fail('Creator source environment is unsupported.',409,'CREATOR_SOURCE_ENVIRONMENT');
  if(type==='practice'&&source.challenge_id)fail('A replay of another shared run cannot be promoted as the creator source.',409,'CREATOR_SOURCE_INELIGIBLE');
  if(type==='practice'&&source.creator_challenge_id)fail('A creator-challenge replay cannot be promoted as a new creator source.',409,'CREATOR_SOURCE_INELIGIBLE');
  if(shareId) {
    const linked=await query('SELECT 1 FROM draft_run_shares WHERE id=$1 AND session_id=$2::uuid',[shareId,source.id]);
    if(!linked.rows[0])fail('Shared Practice source no longer matches its authoritative run.',409,'CREATOR_SOURCE_MISMATCH');
  }
  await validateHistoricalPuzzles(query,source);
  return source;
}

export async function resolvePracticeSource(query,input) {
  const shareId=parsePracticeShareReference(input);
  const result=await query('SELECT session_id FROM draft_run_shares WHERE id=$1',[shareId]);
  if(!result.rows[0])fail('Shared Practice run not found.',404,'CREATOR_SOURCE_NOT_FOUND');
  const source=await sourceSession(query,result.rows[0].session_id,{expectedType:'practice',shareId});
  return {source,shareId};
}

export async function resolveDailySource(query,{playerId,sessionId}) {
  if(!UUID.test(String(playerId||''))||!UUID.test(String(sessionId||'')))fail('Choose a valid creator and completed Daily.');
  return sourceSession(query,sessionId,{expectedPlayerId:playerId,expectedType:'daily'});
}

function sourceSummary(source,{shareId=null}={}) {
  return {
    source_session_id:source.id,
    source_type:source.day?'daily':'practice',
    creator_player_id:source.player_id,
    creator_auth_user_id:source.source_owner_auth_user_id||null,
    creator_default_name:source.display_name,
    creator_profile_public:source.profile_public,
    creator_username_owned:source.username_owned,
    score:source.score,
    environment:source.environment||'mixed',
    day:source.day||null,
    decisions:source.puzzle_ids.length,
    share_id:shareId,
    corpus_version:source.corpus_version,
    scoring_version:source.scoring_version,
    difficulty_version:source.difficulty_version,
    selection_version:source.selection_version,
    serving_policy_version:source.serving_policy_version,
    source_components:source.source_components,
  };
}

export async function resolveCreatorSourceInput(query,payload) {
  const type=String(payload?.source_type||'').trim();
  if(!SOURCE_TYPES.has(type))fail('Choose Shared Practice Run or Completed Daily.');
  if(type==='practice') {
    const resolved=await resolvePracticeSource(query,payload.share);
    return {...resolved,summary:sourceSummary(resolved.source,{shareId:resolved.shareId})};
  }
  const source=await resolveDailySource(query,{playerId:payload.creator_player_id,sessionId:payload.source_session_id});
  return {source,shareId:null,summary:sourceSummary(source)};
}

function normalizeMetadata(payload,source) {
  const slug=normalizeCampaignSlug(payload.slug);
  if(!slug)fail('Use a valid creator-challenge slug.');
  const sourceValue=normalizeAcquisitionValue(payload.acquisition_source??'creator');
  const campaign=normalizeAcquisitionValue(payload.acquisition_campaign??'beat-the-creator');
  const mediumRaw=String(payload.acquisition_medium??'creator').trim();
  const medium=mediumRaw?normalizeAcquisitionValue(mediumRaw):null;
  if(!sourceValue||!campaign||(mediumRaw&&!medium))fail('Use valid acquisition source, campaign, and medium values.');
  const creatorName=plain(payload.creator_public_name??source.display_name,{required:true,max:80,label:'Creator name'});
  const handle=plain(payload.creator_handle,{max:80,label:'Creator handle'});
  const headline=plain(payload.headline??`Can you beat ${creatorName}?`,{max:160,label:'Headline'});
  const note=plain(payload.creator_post_run_note,{max:500,label:'Creator note'});
  return {slug,source:sourceValue,campaign,medium,creatorName,handle,headline,note};
}

function num(value){return value==null?null:Number(value);}

function challengeRow(row) {
  if(!row)return null;
  return {
    ...row,
    source_score:num(row.source_score),
    attempts:Number(row.attempts||0),
    wins:Number(row.wins||0),
    ties:Number(row.ties||0),
    losses:Number(row.losses||0),
    beat_percentage:row.beat_percentage==null?null:Number(row.beat_percentage),
    average_score:row.average_score==null?null:Number(row.average_score),
  };
}

export async function creatorChallengeById(query,id,{forUpdate=false}={}) {
  if(!UUID.test(String(id||'')))fail('Invalid creator challenge.');
  const result=await query(`SELECT c.*,s.score source_score,s.day authoritative_source_day,s.environment authoritative_environment,
      s.puzzle_ids,s.answers,s.player_id authoritative_owner_player_id,s.measurement_qa,
      p.public_identity_hidden_at,p.profile_public,
      stats.attempts,stats.wins,stats.ties,stats.losses,stats.beat_percentage,stats.average_score
    FROM creator_challenges c
    LEFT JOIN draft_run_sessions s ON s.id=c.source_session_id
    LEFT JOIN players p ON p.id=c.source_owner_player_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int attempts,
        count(*) FILTER(WHERE x.score>s.score)::int wins,
        count(*) FILTER(WHERE x.score=s.score)::int ties,
        count(*) FILTER(WHERE x.score<s.score)::int losses,
        round(100.0*count(*) FILTER(WHERE x.score>s.score)/nullif(count(*),0),1) beat_percentage,
        round(avg(x.score),1) average_score
      FROM draft_run_sessions x
      WHERE x.creator_challenge_id=c.id
        AND x.score IS NOT NULL
        AND jsonb_array_length(x.answers)=jsonb_array_length(x.puzzle_ids)
        AND NOT x.measurement_qa
        AND NOT EXISTS (
          SELECT 1 FROM account_links ax
          JOIN pack1_admins admin ON admin.auth_user_id=ax.auth_user_id
          WHERE ax.player_id=x.player_id
        )
    ) stats ON true
    WHERE c.id=$1::uuid${forUpdate?' FOR UPDATE OF c':''}`,[id]);
  return challengeRow(result.rows[0]);
}

export async function creatorChallengeBySlug(query,slug) {
  const normalized=normalizeCampaignSlug(slug);
  if(!normalized)fail('Creator challenge not found.',404);
  const result=await query('SELECT id FROM creator_challenges WHERE slug=$1',[normalized]);
  if(!result.rows[0])fail('Creator challenge not found.',404);
  return creatorChallengeById(query,result.rows[0].id);
}

export async function validateCreatorChallengeSource(query,row,{today,requireClosed=true}={}) {
  if(!row||!row.source_session_id||!row.authoritative_owner_player_id||row.source_score==null)
    fail('This creator challenge is no longer available.',410,'CREATOR_CHALLENGE_UNAVAILABLE');
  if(row.public_identity_hidden_at||!bool(row.profile_public)||bool(row.measurement_qa))
    fail('This creator is not currently eligible for public promotion.',409,'CREATOR_IDENTITY_PRIVATE');
  if(row.source_type==='daily'&&String(row.authoritative_source_day)!==String(row.source_day))
    fail('Creator challenge source no longer matches its frozen Daily.',409,'CREATOR_SOURCE_MISMATCH');
  if(String(row.authoritative_environment||'')!==String(row.source_environment||''))
    fail('Creator challenge source no longer matches its frozen environment.',409,'CREATOR_SOURCE_MISMATCH');
  if(requireClosed&&row.source_type==='daily'&&String(row.authoritative_source_day||'')>=String(today||''))
    fail('This creator Daily is not yet available as a replay.',409,'CREATOR_DAILY_STILL_OPEN');
  const source=await sourceSession(query,row.source_session_id,{expectedPlayerId:row.source_owner_player_id,expectedType:row.source_type});
  if(source.score!==row.source_score)fail('Creator challenge source score changed unexpectedly.',409,'CREATOR_SOURCE_MISMATCH');
  return source;
}

export async function assertCreatorChallengePlayable(query,row,{today}={}) {
  if(!row||row.status!=='published')fail('This creator challenge is not available.',410,'CREATOR_CHALLENGE_UNAVAILABLE');
  return validateCreatorChallengeSource(query,row,{today,requireClosed:true});
}

export function publicCreatorChallenge(row) {
  const entry={
    destination:`/?game=draft-run&creator=${row.id}`,
    source:row.acquisition_source,
    campaign:row.acquisition_campaign,
    ...(row.acquisition_medium?{medium:row.acquisition_medium}:{}),
  };
  return {
    id:row.id,
    slug:row.slug,
    creator_name:row.creator_public_name,
    creator_handle:row.creator_handle||null,
    headline:row.headline||`Can you beat ${row.creator_public_name}?`,
    score:row.source_score,
    environment:row.source_environment,
    source_type:row.source_type,
    source_day:row.source_day||null,
    run_length:8,
    attempts:Number(row.attempts||0),
    wins:Number(row.wins||0),
    ties:Number(row.ties||0),
    losses:Number(row.losses||0),
    beat_percentage:row.beat_percentage==null?null:Number(row.beat_percentage),
    average_score:row.average_score==null?null:Number(row.average_score),
    public_url:buildCampaignVanityUrl(row.slug),
    tracked_url:buildCampaignTrackingUrl(entry),
  };
}

export async function creatorChallengeForPublic(query,identifier,{today}={}) {
  const row=UUID.test(String(identifier||''))?await creatorChallengeById(query,identifier):await creatorChallengeBySlug(query,identifier);
  await assertCreatorChallengePlayable(query,row,{today});
  return row;
}

export async function loadCreatorChallengeForStart(query,identifier,{today}={}) {
  const challenge=UUID.test(String(identifier||''))?await creatorChallengeById(query,identifier):await creatorChallengeBySlug(query,identifier);
  const source=await assertCreatorChallengePlayable(query,challenge,{today});
  return {challenge,source};
}

export async function loadCreatorChallengeForExistingSession(query,id) {
  const challenge=await creatorChallengeById(query,id);
  if(!challenge||!['published','retired'].includes(challenge.status)||challenge.privacy_removed_at)
    fail('This creator challenge is no longer available.',410,'CREATOR_CHALLENGE_UNAVAILABLE');
  if(!challenge.source_session_id||!challenge.authoritative_owner_player_id||challenge.source_score==null)
    fail('This creator challenge is no longer available.',410,'CREATOR_CHALLENGE_UNAVAILABLE');
  if(challenge.public_identity_hidden_at||!bool(challenge.profile_public)||bool(challenge.measurement_qa))
    fail('This creator challenge is no longer available.',410,'CREATOR_CHALLENGE_UNAVAILABLE');
  const source=await sourceSession(query,challenge.source_session_id,{
    expectedPlayerId:challenge.source_owner_player_id,
    expectedType:challenge.source_type,
  });
  return {challenge,source};
}

export function creatorRevealState(challenge,source,answers,{complete=false,self=false}={}) {
  const sourceAnswers=Array.isArray(source?.answers)?source.answers:[];
  const revealed=(Array.isArray(answers)?answers:[]).map((answer,index)=>{
    const creator=sourceAnswers[index];
    if(!creator)return answer;
    return {
      ...answer,
      creatorId:creator.selectedId,
      creatorName:creator.selectedName,
      creatorMatch:creator.selectedId===answer.selectedId,
    };
  });
  const creatorMatches=revealed.filter(answer=>answer.creatorMatch).length;
  const trophyMatches=revealed.filter(answer=>answer.historicalMatch).length;
  const score=complete&&revealed.length?Math.round(revealed.reduce((sum,answer)=>sum+Number(answer.score||0),0)/revealed.length):null;
  const outcome=complete&&score!=null
    ? score>source.score?'win':score<source.score?'loss':'tie'
    : null;
  const comparison={
    kind:'creator',
    id:challenge.id,
    slug:challenge.slug,
    name:challenge.creator_public_name,
    handle:challenge.creator_handle||null,
    headline:challenge.headline||`Can you beat ${challenge.creator_public_name}?`,
    score:source.score,
    exact:true,
    source_type:challenge.source_type,
    source_day:challenge.source_day||null,
    creator_matches:complete?creatorMatches:null,
    trophy_matches:complete?trophyMatches:null,
    outcome,
    self:Boolean(self),
    ...(complete&&challenge.creator_post_run_note?{creator_post_run_note:challenge.creator_post_run_note}:{}),
  };
  return {answers:revealed,comparison,outcome,creatorMatches,trophyMatches};
}

export async function createCreatorChallenge(query,payload,adminAuthUserId) {
  const resolved=await resolveCreatorSourceInput(query,payload);
  const meta=normalizeMetadata(payload,resolved.source);
  const inserted=await query(`INSERT INTO creator_challenges(
      slug,source_session_id,source_owner_player_id,source_owner_auth_user_id,source_share_id,source_type,source_day,source_environment,
      creator_public_name,creator_handle,headline,creator_post_run_note,
      acquisition_source,acquisition_campaign,acquisition_medium,status,created_by_admin_auth_user_id
    ) VALUES($1,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::date,$8,$9,$10,$11,$12,$13,$14,$15,'draft',$16::uuid)
    ON CONFLICT(slug) DO NOTHING RETURNING id`,[
      meta.slug,resolved.source.id,resolved.source.player_id,resolved.source.source_owner_auth_user_id||null,resolved.shareId,
      resolved.source.day?'daily':'practice',resolved.source.day||null,resolved.source.environment||'mixed',
      meta.creatorName,meta.handle,meta.headline,meta.note,meta.source,meta.campaign,meta.medium,adminAuthUserId,
    ]);
  if(!inserted.rows[0])fail('That slug is already reserved by another creator challenge.',409,'CREATOR_SLUG_TAKEN');
  const id=inserted.rows[0].id;
  await query(`INSERT INTO creator_challenge_audit(creator_challenge_id,admin_auth_user_id,action,detail)
    VALUES($1::uuid,$2::uuid,'created',jsonb_build_object('source_type',$3,'source_session_id',$4::text))`,
    [id,adminAuthUserId,resolved.source.day?'daily':'practice',resolved.source.id]);
  return creatorChallengeById(query,id);
}

export function creatorCampaignEntry(row) {
  if(!row?.id||!row?.slug)fail('Creator challenge is incomplete.',409,'CREATOR_CHALLENGE_INCOMPLETE');
  const title=row.headline||`Can you beat ${row.creator_public_name}?`;
  const daily=row.source_type==='daily'&&row.source_day
    ? ` on the ${row.source_day} Daily`
    : '';
  const description=`${row.creator_public_name} scored ${row.source_score}/100${daily}. Play the same eight real draft decisions.`;
  return {
    slug:row.slug,
    destination:`/?game=draft-run&creator=${row.id}`,
    source:row.acquisition_source,
    campaign:row.acquisition_campaign,
    ...(row.acquisition_medium?{medium:row.acquisition_medium}:{}),
    social_title:title,
    social_description:description,
  };
}

export async function requestCreatorChallengePublication(query,id,adminAuthUserId) {
  const row=await creatorChallengeById(query,id);
  if(!row)fail('Creator challenge not found.',404);
  if(row.status==='retired')fail('Retired creator challenges cannot be republished.',409,'CREATOR_CHALLENGE_RETIRED');
  await assertCreatorSourceAvailable(query,row);
  if(row.status==='published')return {challenge:row,entry:creatorCampaignEntry(row),already_published:true};
  const operation=row.publication_operation_ref||crypto.randomUUID();
  const updated=await query(`UPDATE creator_challenges
    SET status='publishing',publication_operation_ref=$2::uuid,publication_error=NULL,
        published_by_admin_auth_user_id=COALESCE(published_by_admin_auth_user_id,$3::uuid),updated_at=now()
    WHERE id=$1::uuid AND status IN ('draft','failed','publishing')
    RETURNING id`,[id,operation,adminAuthUserId]);
  if(!updated.rows[0])fail('Creator challenge publication state changed. Reload and try again.',409);
  await query(`INSERT INTO creator_challenge_audit(creator_challenge_id,admin_auth_user_id,action,detail)
    VALUES($1::uuid,$2::uuid,'publish_requested',jsonb_build_object('operation',$3::text))
  `,[id,adminAuthUserId,operation]);
  const challenge=await creatorChallengeById(query,id);
  return {challenge,entry:creatorCampaignEntry(challenge),already_published:false};
}

export async function completeCreatorChallengePublication(query,id,adminAuthUserId) {
  const row=await creatorChallengeById(query,id);
  if(!row)fail('Creator challenge not found.',404);
  await assertCreatorSourceAvailable(query,row);
  if(row.status==='retired')fail('Retired creator challenges cannot be published.',409);
  if(row.status==='published')return row;
  const result=await query(`UPDATE creator_challenges SET status='published',
      published_at=COALESCE(published_at,now()),published_by_admin_auth_user_id=COALESCE(published_by_admin_auth_user_id,$2::uuid),
      publication_error=NULL,updated_at=now()
    WHERE id=$1::uuid AND status='publishing' RETURNING id`,[id,adminAuthUserId]);
  if(!result.rows[0])fail('Creator challenge is not awaiting publication.',409);
  await query(`INSERT INTO creator_challenge_audit(creator_challenge_id,admin_auth_user_id,action)
    VALUES($1::uuid,$2::uuid,'published')`,[id,adminAuthUserId]);
  return creatorChallengeById(query,id);
}

export async function failCreatorChallengePublication(query,id,adminAuthUserId,errorMessage) {
  const message=plain(errorMessage,{max:300,label:'Publication error'})||'Publication failed.';
  const result=await query(`UPDATE creator_challenges SET status='failed',publication_error=$3,updated_at=now()
    WHERE id=$1::uuid AND status='publishing' RETURNING id`,[id,adminAuthUserId,message]);
  if(result.rows[0])await query(`INSERT INTO creator_challenge_audit(creator_challenge_id,admin_auth_user_id,action,detail)
    VALUES($1::uuid,$2::uuid,'publish_failed',jsonb_build_object('error',$3))`,[id,adminAuthUserId,message]);
  return creatorChallengeById(query,id);
}

export async function listCreatorPlayers(query,search,{limit=20,offset=0}={}) {
  const q=String(search||'').trim();
  if(!q||q.length>100)fail('Enter a creator search of 1-100 characters.');
  const safeLimit=Math.max(1,Math.min(25,Number(limit)||20));
  const safeOffset=Math.max(0,Math.min(500,Number(offset)||0));
  const result=await query(`SELECT p.id player_id,p.display_name,p.profile_public,p.username_owned,
      a.auth_user_id,u.email
    FROM players p
    LEFT JOIN account_links a ON a.player_id=p.id
    LEFT JOIN neon_auth."user" u ON u.id=a.auth_user_id
    WHERE p.public_identity_hidden_at IS NULL
      AND (p.display_name ILIKE '%'||$1||'%' OR coalesce(u.email,'') ILIKE '%'||$1||'%')
    ORDER BY (lower(p.display_name)=lower($1)) DESC,p.updated_at DESC,p.id
    LIMIT $2::int OFFSET $3::int`,[q,safeLimit,safeOffset]);
  return result.rows.map(row=>({
    player_id:row.player_id,
    display_name:row.display_name,
    profile_public:bool(row.profile_public),
    username_owned:bool(row.username_owned),
    linked_account:Boolean(row.auth_user_id),
  }));
}

export async function listCompletedDailies(query,playerId,{limit=20,before=null}={}) {
  if(!UUID.test(String(playerId||'')))fail('Invalid creator.');
  const safeLimit=Math.max(1,Math.min(50,Number(limit)||20));
  const cursor=before&&/^\d{4}-\d{2}-\d{2}$/.test(String(before))?String(before):null;
  const result=await query(`SELECT s.id session_id,s.day::text day,s.environment,s.score,s.updated_at
    FROM draft_run_sessions s
    JOIN players p ON p.id=s.player_id
    WHERE s.player_id=$1::uuid
      AND s.day IS NOT NULL
      AND s.score IS NOT NULL
      AND jsonb_array_length(s.puzzle_ids)=8
      AND jsonb_array_length(s.answers)=8
      AND NOT s.measurement_qa
      AND p.public_identity_hidden_at IS NULL
      AND ($3::date IS NULL OR s.day<$3::date)
    ORDER BY s.day DESC,s.environment,s.created_at
    LIMIT $2::int`,[playerId,safeLimit,cursor]);
  return result.rows.map(row=>({...row,score:Number(row.score)}));
}

export async function listCreatorChallenges(query,{limit=100}={}) {
  const safeLimit=Math.max(1,Math.min(200,Number(limit)||100));
  const result=await query(`SELECT c.id FROM creator_challenges c ORDER BY c.created_at DESC LIMIT $1::int`,[safeLimit]);
  const rows=[];
  for(const item of result.rows)rows.push(await creatorChallengeById(query,item.id));
  return rows;
}

export async function retireCreatorChallenge(query,id,adminAuthUserId,{privacy=false}={}) {
  const result=await query(`UPDATE creator_challenges SET
      status='retired',retired_at=COALESCE(retired_at,now()),retired_by_admin_auth_user_id=COALESCE(retired_by_admin_auth_user_id,$2::uuid),
      updated_at=now(),publication_error=NULL
    WHERE id=$1::uuid AND status<>'retired' RETURNING id`,[id,adminAuthUserId||null]);
  const exists=result.rows[0]|| (await query('SELECT id FROM creator_challenges WHERE id=$1::uuid',[id])).rows[0];
  if(!exists)fail('Creator challenge not found.',404);
  await query(`INSERT INTO creator_challenge_audit(creator_challenge_id,admin_auth_user_id,action,detail)
    VALUES($1::uuid,$2::uuid,$3,$4::jsonb)`,[id,adminAuthUserId||null,privacy?'privacy_retired':'retired',JSON.stringify({privacy})]);
  return creatorChallengeById(query,id);
}

export async function handleCreatorChallengeAdmin(request,query,readJson,adminAuthUserId) {
  const url=new URL(request.url),path=url.pathname;
  if(path==='/v1/admin/creator-challenges/players'&&request.method==='GET')
    return {players:await listCreatorPlayers(query,url.searchParams.get('search'),{limit:url.searchParams.get('limit'),offset:url.searchParams.get('offset')})};
  const dailies=path.match(/^\/v1\/admin\/creator-challenges\/players\/([a-f0-9-]{36})\/dailies$/i);
  if(dailies&&request.method==='GET')
    return {dailies:await listCompletedDailies(query,dailies[1],{limit:url.searchParams.get('limit'),before:url.searchParams.get('before')})};
  if(path==='/v1/admin/creator-challenges/resolve'&&request.method==='POST') {
    const resolved=await resolveCreatorSourceInput(query,await readJson(request));
    return {source:resolved.summary};
  }
  if(path==='/v1/admin/creator-challenges'&&request.method==='POST')
    return {challenge:await createCreatorChallenge(query,await readJson(request),adminAuthUserId)};
  if(path==='/v1/admin/creator-challenges'&&request.method==='GET')
    return {challenges:await listCreatorChallenges(query,{limit:url.searchParams.get('limit')})};
  const detail=path.match(/^\/v1\/admin\/creator-challenges\/([a-f0-9-]{36})$/i);
  if(detail&&request.method==='GET') {
    const challenge=await creatorChallengeById(query,detail[1]);
    if(!challenge)fail('Creator challenge not found.',404);
    return {challenge};
  }
  const publish=path.match(/^\/v1\/admin\/creator-challenges\/([a-f0-9-]{36})\/publish$/i);
  if(publish&&request.method==='POST')
    return await requestCreatorChallengePublication(query,publish[1],adminAuthUserId);
  const published=path.match(/^\/v1\/admin\/creator-challenges\/([a-f0-9-]{36})\/published$/i);
  if(published&&request.method==='POST')
    return {challenge:await completeCreatorChallengePublication(query,published[1],adminAuthUserId)};
  const publishFailed=path.match(/^\/v1\/admin\/creator-challenges\/([a-f0-9-]{36})\/publish-failed$/i);
  if(publishFailed&&request.method==='POST') {
    const body=await readJson(request);
    return {challenge:await failCreatorChallengePublication(query,publishFailed[1],adminAuthUserId,body?.error)};
  }
  const retire=path.match(/^\/v1\/admin\/creator-challenges\/([a-f0-9-]{36})\/retire$/i);
  if(retire&&request.method==='POST')
    return {challenge:await retireCreatorChallenge(query,retire[1],adminAuthUserId)};
  fail('Not found.',404);
}
