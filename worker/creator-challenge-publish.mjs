import {accountSession,requireTrustedOrigin} from './account-session.mjs';
import {creatorChallengeById,validateCreatorChallengeSource} from './creator-challenges.mjs';

const WORKFLOW_URL='https://api.github.com/repos/killjoy00/mtg-ev-analyzer/actions/workflows/campaign-link-publish.yml';
const DISPATCH_URL=WORKFLOW_URL+'/dispatches';
const RUNS_URL=WORKFLOW_URL+'/runs?event=workflow_dispatch&per_page=100';
const TOKEN_PATTERN=/^github_pat_[A-Za-z0-9_]{20,}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

const fail=(message,status=400,code=null)=>{throw Object.assign(Error(message),{status,...(code?{code}:{})});};
const parse=value=>typeof value==='string'?JSON.parse(value):value;

function publishToken(env) {
  const value=String(env.PACK1_LAUNCH_WATCHER_GITHUB_TOKEN||'');
  if(!TOKEN_PATTERN.test(value))fail('Creator challenge publishing is temporarily unavailable.',503,'CREATOR_PUBLISH_UNAVAILABLE');
  return value;
}

function githubHeaders(env) {
  return {
    authorization:'Bearer '+publishToken(env),
    accept:'application/vnd.github+json',
    'content-type':'application/json',
    'x-github-api-version':'2022-11-28',
    'user-agent':'pack1-admin-creator-publisher',
  };
}

async function requireCreatorAdmin(request,{query,allowedOrigins,csrf}) {
  requireTrustedOrigin(request,allowedOrigins);
  const auth=await accountSession(request,query,{required:true,allowLegacy:false,csrf});
  const admin=await query('SELECT 1 FROM pack1_admins WHERE auth_user_id=$1::uuid LIMIT 1',[auth.user_id]);
  if(!admin.rows[0])fail('Admin access required.',403,'ADMIN_REQUIRED');
  return auth;
}

function workflowInputs(row,operation,action) {
  return {
    kind:'creator',
    operation,
    creator_action:action,
    slug:row.slug,
    destination:'/',
    source:row.acquisition_source,
    campaign:row.acquisition_campaign,
    medium:row.acquisition_medium||'',
    social_title:'',
    social_description:'',
    creator_challenge_id:row.id,
    creator_name:row.creator_public_name,
    creator_headline:row.headline||`Can you beat ${row.creator_public_name}?`,
    creator_score:String(row.source_score),
    creator_environment:row.source_environment,
    creator_source_type:row.source_type,
    creator_source_day:row.source_day||'',
  };
}

export async function requestCreatorPrivacyRetirement(query,playerId,{env=process.env,fetcher=fetch}={}) {
  const result=await query(`SELECT id FROM creator_challenges
    WHERE source_owner_player_id=$1::uuid AND status<>'retired'
    ORDER BY created_at,id`,[playerId]);
  for(const item of result.rows) {
    let row=await creatorChallengeById(query,item.id);
    const operation=crypto.randomUUID();
    await query(`UPDATE creator_challenges SET status='retired',
        retired_at=COALESCE(retired_at,now()),privacy_removed_at=COALESCE(privacy_removed_at,now()),
        publication_operation_ref=$2::uuid,publication_detail=$3::jsonb,publication_error=NULL,updated_at=now()
      WHERE id=$1::uuid`,[
        row.id,operation,JSON.stringify({action:'retire',reason:'account_deletion',requested_at:new Date().toISOString()}),
      ]);
    await query(`INSERT INTO creator_challenge_audit(creator_challenge_id,action,detail)
      VALUES($1::uuid,'privacy_retired',jsonb_build_object('operation',$2::text,'reason','account_deletion'))`,[row.id,operation]);
    row=await creatorChallengeById(query,row.id);
    try {
      await dispatch(row,operation,'retire',{env,fetcher});
    } catch(error) {
      await query(`UPDATE creator_challenges SET publication_error=$2,updated_at=now() WHERE id=$1::uuid`,[
        row.id,String(error?.message||error).slice(0,500),
      ]);
      throw error;
    }
  }
  return result.rows.length;
}

async function dispatch(row,operation,action,{env,fetcher}) {
  let response;
  try {
    response=await fetcher(DISPATCH_URL,{
      method:'POST',
      headers:githubHeaders(env),
      body:JSON.stringify({ref:'main',inputs:workflowInputs(row,operation,action)}),
      redirect:'error',
      signal:AbortSignal.timeout(15000),
    });
  } catch(error) {
    if(error?.status)throw error;
    fail('Creator publication request could not reach GitHub.',503,'CREATOR_PUBLISH_DISPATCH');
  }
  if(![200,204].includes(response.status))fail('Creator publication request was rejected.',503,'CREATOR_PUBLISH_DISPATCH');
}

async function workflowRun(operation,{env,fetcher}) {
  let response;
  try {
    response=await fetcher(RUNS_URL,{headers:githubHeaders(env),redirect:'error',signal:AbortSignal.timeout(15000)});
  } catch {
    fail('Could not reconcile creator publication with GitHub.',503,'CREATOR_PUBLISH_RECONCILE');
  }
  if(!response.ok)fail('Could not reconcile creator publication with GitHub.',503,'CREATOR_PUBLISH_RECONCILE');
  const data=await response.json().catch(()=>({}));
  const marker=` / ${operation}`;
  return (Array.isArray(data.workflow_runs)?data.workflow_runs:[]).find(run=>String(run.display_title||'').endsWith(marker))||null;
}

async function verifyLive(row,action,{fetcher}) {
  const url=`https://packone.pro/go/${row.slug}/`;
  let response,text;
  try {
    response=await fetcher(url,{headers:{accept:'text/html','cache-control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(15000)});
    text=await response.text();
  } catch {return false;}
  if(!response.ok)return false;
  return text.includes(`data-creator-challenge-id="${row.id}"`)
    && text.includes(`data-creator-challenge-status="${action==='retire'?'retired':'published'}"`);
}

async function updatePublishFailure(query,row,error) {
  await query(`UPDATE creator_challenges SET status='failed',publication_error=$2,updated_at=now()
    WHERE id=$1::uuid AND status='publishing'`,[row.id,String(error?.message||error).slice(0,500)]);
  await query(`INSERT INTO creator_challenge_audit(creator_challenge_id,admin_auth_user_id,action,detail)
    VALUES($1::uuid,NULL,'publish_failed',jsonb_build_object('error',$2))`,[row.id,String(error?.message||error).slice(0,500)]);
}

async function reconcile(query,row,{env,fetcher}) {
  const detail=parse(row.publication_detail||'{}')||{};
  const operation=String(row.publication_operation_ref||'');
  const action=detail.action==='retire'?'retire':'publish';
  if(!UUID.test(operation))return {state:row.status,challenge:row,reconciled:false};
  const run=await workflowRun(operation,{env,fetcher});
  if(!run)return {state:row.status,challenge:row,reconciled:false,workflow_status:'pending'};
  const workflow={id:run.id||null,status:run.status||null,conclusion:run.conclusion||null,html_url:run.html_url||null};
  await query(`UPDATE creator_challenges SET publication_detail=publication_detail||$2::jsonb,updated_at=now()
    WHERE id=$1::uuid`,[row.id,JSON.stringify({workflow})]);
  if(run.status!=='completed')return {state:row.status,challenge:await creatorChallengeById(query,row.id),reconciled:true,workflow};
  if(run.conclusion!=='success') {
    if(action==='publish')await updatePublishFailure(query,row,`GitHub publication finished with ${run.conclusion||'an unknown failure'}.`);
    else await query(`UPDATE creator_challenges SET publication_error=$2,updated_at=now() WHERE id=$1::uuid`,[row.id,`Retirement publication finished with ${run.conclusion||'an unknown failure'}.`]);
    return {state:action==='publish'?'failed':'retired',challenge:await creatorChallengeById(query,row.id),reconciled:true,workflow};
  }
  if(!await verifyLive(row,action,{fetcher}))
    return {state:row.status,challenge:await creatorChallengeById(query,row.id),reconciled:true,workflow,live_verified:false};
  if(action==='publish') {
    const updated=await query(`UPDATE creator_challenges SET status='published',published_at=COALESCE(published_at,now()),
        published_by_admin_auth_user_id=COALESCE(published_by_admin_auth_user_id,created_by_admin_auth_user_id),
        publication_error=NULL,publication_detail=publication_detail||$2::jsonb,updated_at=now()
      WHERE id=$1::uuid AND publication_operation_ref=$3::uuid AND status IN ('publishing','published')
      RETURNING id`,[row.id,JSON.stringify({live_verified:true}),operation]);
    if(updated.rows[0])await query(`INSERT INTO creator_challenge_audit(creator_challenge_id,admin_auth_user_id,action,detail)
      SELECT $1::uuid,published_by_admin_auth_user_id,'published',jsonb_build_object('operation',$2::text)
      FROM creator_challenges WHERE id=$1::uuid
      AND NOT EXISTS(SELECT 1 FROM creator_challenge_audit WHERE creator_challenge_id=$1::uuid AND action='published' AND detail->>'operation'=$2::text)`,
      [row.id,operation]);
  } else {
    await query(`UPDATE creator_challenges SET publication_error=NULL,publication_detail=publication_detail||$2::jsonb,updated_at=now()
      WHERE id=$1::uuid AND publication_operation_ref=$3::uuid`,[row.id,JSON.stringify({live_verified:true}),operation]);
  }
  return {state:action==='publish'?'published':'retired',challenge:await creatorChallengeById(query,row.id),reconciled:true,workflow,live_verified:true};
}

export async function handleCreatorChallengePublication(request,{query,readJson,allowedOrigins,today,env=process.env,fetcher=fetch}={}) {
  if(typeof query!=='function'||typeof readJson!=='function'||!(allowedOrigins instanceof Set))
    throw Error('Creator publisher dependencies are unavailable.');
  const url=new URL(request.url);
  const match=url.pathname.match(/^\/v1\/admin\/creator-challenges\/([a-f0-9-]{36})\/publication$/i);
  if(!match)fail('Not found.',404);
  const mutation=request.method==='POST';
  const auth=await requireCreatorAdmin(request,{query,allowedOrigins,csrf:mutation});
  let row=await creatorChallengeById(query,match[1]);
  if(!row)fail('Creator challenge not found.',404);

  if(request.method==='GET') {
    if(row.publication_operation_ref&&['publishing','retired'].includes(row.status))return Response.json(await reconcile(query,row,{env,fetcher}),{headers:{'cache-control':'no-store'}});
    return Response.json({state:row.status,challenge:row,reconciled:false},{headers:{'cache-control':'no-store'}});
  }
  if(request.method!=='POST')fail('Method not allowed.',405);

  const body=await readJson(request),action=body?.action==='retire'?'retire':body?.action==='publish'?'publish':null;
  if(!action)fail('Choose publish or retire.');
  if(action==='publish') {
    if(row.status==='retired')fail('Retired creator challenges cannot be republished.',409,'CREATOR_RETIRED');
    if(row.status==='published')return Response.json({state:'published',challenge:row,already_published:true},{headers:{'cache-control':'no-store'}});
    await validateCreatorChallengeSource(query,row,{today,requireClosed:true});
  }
  const operation=crypto.randomUUID();
  if(action==='publish') {
    await query(`UPDATE creator_challenges SET status='publishing',publication_operation_ref=$2::uuid,
        publication_detail=$3::jsonb,publication_error=NULL,updated_at=now()
      WHERE id=$1::uuid`,[row.id,operation,JSON.stringify({action,requested_at:new Date().toISOString()})]);
    await query(`INSERT INTO creator_challenge_audit(creator_challenge_id,admin_auth_user_id,action,detail)
      VALUES($1::uuid,$2::uuid,'publish_requested',jsonb_build_object('operation',$3::text))`,[row.id,auth.user_id,operation]);
  } else {
    await query(`UPDATE creator_challenges SET status='retired',retired_at=COALESCE(retired_at,now()),
        retired_by_admin_auth_user_id=COALESCE(retired_by_admin_auth_user_id,$2::uuid),
        publication_operation_ref=$3::uuid,publication_detail=$4::jsonb,publication_error=NULL,updated_at=now()
      WHERE id=$1::uuid`,[row.id,auth.user_id,operation,JSON.stringify({action,requested_at:new Date().toISOString()})]);
    await query(`INSERT INTO creator_challenge_audit(creator_challenge_id,admin_auth_user_id,action,detail)
      VALUES($1::uuid,$2::uuid,'retired',jsonb_build_object('operation',$3::text))`,[row.id,auth.user_id,operation]);
  }
  row=await creatorChallengeById(query,row.id);
  try {await dispatch(row,operation,action,{env,fetcher});}
  catch(error) {
    if(action==='publish')await updatePublishFailure(query,row,error);
    else await query(`UPDATE creator_challenges SET publication_error=$2,updated_at=now() WHERE id=$1::uuid`,[row.id,String(error?.message||error).slice(0,500)]);
    throw error;
  }
  return Response.json({ok:true,state:action==='publish'?'publishing':'retired',operation,challenge:await creatorChallengeById(query,row.id)},{status:202,headers:{'cache-control':'no-store'}});
}
