import {accountSession,requireTrustedOrigin} from './account-session.mjs';
import {creatorChallengeById,validateCreatorChallengeSource} from './creator-challenges.mjs';

const WORKFLOW_URL='https://api.github.com/repos/killjoy00/mtg-ev-analyzer/actions/workflows/campaign-link-publish.yml';
const DISPATCH_URL=WORKFLOW_URL+'/dispatches';
const RUNS_URL=WORKFLOW_URL+'/runs?event=workflow_dispatch&per_page=100';
const RUN_BY_ID='https://api.github.com/repos/killjoy00/mtg-ev-analyzer/actions/runs/';
const DISPATCH_RETRY_MS=60_000;
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

export function creatorPublicationWorkflowInputs(row,operation,action) {
  const retired=action==='retire';
  return {
    kind:'creator',
    operation,
    creator_action:action,
    slug:row.slug,
    destination:'/',
    source:retired?'creator':row.acquisition_source,
    campaign:retired?'retired':row.acquisition_campaign,
    medium:retired?'':row.acquisition_medium||'',
    creator_challenge_id:row.id,
    creator_name:retired?'A creator':row.creator_public_name,
    creator_headline:retired?'Creator challenge unavailable':row.headline||`Can you beat ${row.creator_public_name}?`,
    creator_score:retired?'0':String(row.source_score),
    creator_environment:retired?'mixed':row.source_environment,
    creator_source_type:retired?'practice':row.source_type,
    creator_source_day:retired?'':row.source_day||'',
  };
}

function operationDetail(row) {
  const detail=parse(row?.publication_detail||'{}')||{};
  return detail&&typeof detail==='object'&&!Array.isArray(detail)?detail:{};
}

function operationAction(row) {
  const action=operationDetail(row).action;
  return action==='publish'||action==='retire'?action:null;
}

function operationMatches(row,operation,action) {
  return String(row?.publication_operation_ref||'')===String(operation)
    && operationAction(row)===action;
}

async function guardedDetail(query,id,operation,action,patch) {
  const result=await query(`UPDATE creator_challenges
    SET publication_detail=publication_detail||$4::jsonb,updated_at=now()
    WHERE id=$1::uuid AND publication_operation_ref=$2::uuid
      AND publication_detail->>'action'=$3
    RETURNING id`,[id,operation,action,JSON.stringify(patch)]);
  return Boolean(result.rows[0]);
}

async function guardedError(query,id,operation,action,error) {
  await query(`UPDATE creator_challenges SET publication_error=$4,updated_at=now()
    WHERE id=$1::uuid AND publication_operation_ref=$2::uuid
      AND publication_detail->>'action'=$3`,[
    id,operation,action,String(error||'Creator publication failed.').slice(0,500),
  ]);
}

export function creatorPublicationDispatchRetryDue(detail,{now=Date.now()}={}) {
  const dispatch=detail?.dispatch||{};
  const state=String(dispatch.state||'pending');
  if(state==='pending'||state==='rejected')return true;
  const attempted=Date.parse(String(dispatch.last_attempt_at||detail?.requested_at||''));
  return !Number.isFinite(attempted)||now-attempted>=DISPATCH_RETRY_MS;
}

export async function dispatchCreatorPublicationAttempt(query,row,operation,action,{env,fetcher}) {
  const detail=operationDetail(row);
  const attempts=Math.max(0,Number(detail?.dispatch?.attempts||0))+1;
  const lastAttemptAt=new Date().toISOString();
  let state='ambiguous',status=null,errorText=null;
  try {
    const response=await fetcher(DISPATCH_URL,{
      method:'POST',
      headers:githubHeaders(env),
      body:JSON.stringify({ref:'main',inputs:creatorPublicationWorkflowInputs(row,operation,action)}),
      redirect:'error',
      signal:AbortSignal.timeout(15000),
    });
    status=response.status;
    if([200,204].includes(response.status))state='accepted';
    else {
      state='rejected';
      errorText=`GitHub rejected creator publication dispatch with HTTP ${response.status}.`;
    }
  } catch(error) {
    state=error?.code==='CREATOR_PUBLISH_UNAVAILABLE'?'rejected':'ambiguous';
    errorText=String(error?.message||'Creator publication dispatch response was not received.');
  }
  await guardedDetail(query,row.id,operation,action,{
    dispatch:{state,attempts,last_attempt_at:lastAttemptAt,...(status==null?{}:{http_status:status}),...(errorText?{error:errorText}:{})},
  });
  if(errorText)await guardedError(query,row.id,operation,action,errorText);
  return {state,status,error:errorText};
}

async function fetchWorkflowRunById(id,{env,fetcher}) {
  if(!/^[1-9][0-9]{0,20}$/.test(String(id||'')))return null;
  let response;
  try {
    response=await fetcher(RUN_BY_ID+encodeURIComponent(String(id)),{
      headers:githubHeaders(env),redirect:'error',signal:AbortSignal.timeout(15000),
    });
  } catch {
    fail('Could not reconcile creator publication with GitHub.',503,'CREATOR_PUBLISH_RECONCILE');
  }
  if(response.status===404)return null;
  if(!response.ok)fail('Could not reconcile creator publication with GitHub.',503,'CREATOR_PUBLISH_RECONCILE');
  return response.json().catch(()=>null);
}

export async function discoverCreatorPublicationWorkflowRun(operation,{env,fetcher}) {
  const marker=` / ${operation}`;
  for(let page=1;page<=50;page++) {
    let response;
    try {
      response=await fetcher(`${RUNS_URL}&page=${page}`,{
        headers:githubHeaders(env),redirect:'error',signal:AbortSignal.timeout(15000),
      });
    } catch {
      fail('Could not reconcile creator publication with GitHub.',503,'CREATOR_PUBLISH_RECONCILE');
    }
    if(!response.ok)fail('Could not reconcile creator publication with GitHub.',503,'CREATOR_PUBLISH_RECONCILE');
    const data=await response.json().catch(()=>({}));
    const runs=Array.isArray(data.workflow_runs)?data.workflow_runs:[];
    const match=runs.find(run=>String(run.display_title||'').endsWith(marker));
    if(match)return match;
    if(runs.length<100)break;
  }
  return null;
}

async function workflowRun(row,operation,{env,fetcher}) {
  const stored=operationDetail(row)?.workflow?.id;
  const exact=stored?await fetchWorkflowRunById(stored,{env,fetcher}):null;
  return exact||discoverCreatorPublicationWorkflowRun(operation,{env,fetcher});
}

export async function verifyCreatorPublicationLive(row,action,{fetcher}) {
  const url=`https://packone.pro/creator/${row.slug}/`;
  let response,text;
  try {
    response=await fetcher(url,{
      headers:{accept:'text/html','cache-control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(15000),
    });
    text=await response.text();
  } catch {
    return {ok:false,html_verified:false,image_verified:false};
  }
  const htmlVerified=response.ok
    &&text.includes(`data-creator-challenge-id="${row.id}"`)
    &&text.includes(`data-creator-challenge-status="${action==='retire'?'retired':'published'}"`);
  if(!htmlVerified)return {ok:false,html_verified:false,image_verified:false};
  const responses={};
  try {
    for(const asset of ['creator-card.png','creator-card-square.png']) {
      responses[asset]=await fetcher(url+asset,{
        headers:{'cache-control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(15000),
      });
    }
  } catch {
    return {ok:false,html_verified:true,image_verified:false};
  }
  const verifies=asset=>{
    const image=responses[asset];
    return action==='publish'
      ? image.ok&&String(image.headers.get('content-type')||'').toLowerCase().includes('image/')
      : image.status===404||image.status===410;
  };
  const imageVerified=verifies('creator-card.png')&&verifies('creator-card-square.png');
  return {
    ok:htmlVerified&&imageVerified,
    html_verified:htmlVerified,
    image_verified:imageVerified,
    image_status:responses['creator-card.png'].status,
    square_image_status:responses['creator-card-square.png'].status,
  };
}

async function updatePublishFailure(query,row,operation,error) {
  const message=String(error?.message||error).slice(0,500);
  const updated=await query(`UPDATE creator_challenges SET status='failed',publication_error=$3,updated_at=now()
    WHERE id=$1::uuid AND publication_operation_ref=$2::uuid
      AND publication_detail->>'action'='publish' AND status='publishing'
    RETURNING id`,[row.id,operation,message]);
  if(updated.rows[0])await query(`INSERT INTO creator_challenge_audit(creator_challenge_id,admin_auth_user_id,action,detail)
    SELECT $1::uuid,NULL,'publish_failed',jsonb_build_object('operation',$2::text,'error',$3::text)
    WHERE NOT EXISTS(
      SELECT 1 FROM creator_challenge_audit
      WHERE creator_challenge_id=$1::uuid AND action='publish_failed' AND detail->>'operation'=$2::text
    )`,[row.id,operation,message]);
}

function statePayload(row,extra={}) {
  const detail=operationDetail(row);
  return {
    state:row.status,
    challenge:row,
    reconciled:false,
    live_verified:detail.live_verified===true,
    // Capability is absent from older deployed Functions. Static Admin must fail closed.
    purge_supported:true,
    dispatch:detail.dispatch||null,
    ...extra,
  };
}

async function supersededPublishStillPending(detail,{env,fetcher}) {
  const prior=detail?.superseded_publish;
  const operation=String(prior?.operation||'');
  if(!UUID.test(operation))return false;
  const stored=prior?.workflow?.id;
  const exact=stored?await fetchWorkflowRunById(stored,{env,fetcher}):null;
  const run=exact||await discoverCreatorPublicationWorkflowRun(operation,{env,fetcher});
  if(run)return run.status!=='completed';
  const state=String(prior?.dispatch?.state||'pending');
  if(state==='accepted')return true;
  if(state==='rejected')return false;
  const attempted=Date.parse(String(prior?.dispatch?.last_attempt_at||prior?.requested_at||''));
  return !Number.isFinite(attempted)||Date.now()-attempted<DISPATCH_RETRY_MS;
}

async function reconcile(query,row,{today,env,fetcher}) {
  row=await creatorChallengeById(query,row.id);
  const detail=operationDetail(row),operation=String(row.publication_operation_ref||''),action=operationAction(row);
  if(!UUID.test(operation)||!action)return statePayload(row);
  if(action==='retire'&&await supersededPublishStillPending(detail,{env,fetcher}))
    return statePayload(row,{workflow_status:'waiting_for_superseded_publish'});
  let run=await workflowRun(row,operation,{env,fetcher});
  if(!run&&operationMatches(row,operation,action)&&creatorPublicationDispatchRetryDue(detail)) {
    await dispatchCreatorPublicationAttempt(query,row,operation,action,{env,fetcher});
    row=await creatorChallengeById(query,row.id);
    if(!operationMatches(row,operation,action))return statePayload(row);
    run=await workflowRun(row,operation,{env,fetcher});
  }
  if(!run)return statePayload(await creatorChallengeById(query,row.id),{workflow_status:'pending'});
  const workflow={id:run.id||null,status:run.status||null,conclusion:run.conclusion||null,html_url:run.html_url||null};
  const kept=await guardedDetail(query,row.id,operation,action,{workflow});
  row=await creatorChallengeById(query,row.id);
  if(!kept||!operationMatches(row,operation,action))return statePayload(row);
  if(run.status!=='completed')return statePayload(row,{reconciled:true,workflow});
  if(run.conclusion!=='success') {
    const message=`${action==='retire'?'Retirement':'Creator'} publication finished with ${run.conclusion||'an unknown failure'}.`;
    if(action==='publish')await updatePublishFailure(query,row,operation,message);
    else await guardedError(query,row.id,operation,action,message);
    return statePayload(await creatorChallengeById(query,row.id),{reconciled:true,workflow});
  }
  const live=await verifyCreatorPublicationLive(row,action,{fetcher});
  await guardedDetail(query,row.id,operation,action,{live_verified:live.ok,live_detail:live});
  row=await creatorChallengeById(query,row.id);
  if(!operationMatches(row,operation,action))return statePayload(row);
  if(!live.ok)return statePayload(row,{reconciled:true,workflow,live_verified:false,live_detail:live});
  if(action==='publish') {
    try {
      await validateCreatorChallengeSource(query,row,{today,requireClosed:true});
    } catch(error) {
      await updatePublishFailure(query,row,operation,error);
      return statePayload(await creatorChallengeById(query,row.id),{reconciled:true,workflow});
    }
    await query(`UPDATE creator_challenges SET status='published',published_at=COALESCE(published_at,now()),
        published_by_admin_auth_user_id=COALESCE(published_by_admin_auth_user_id,created_by_admin_auth_user_id),
        publication_error=NULL,publication_detail=publication_detail||$3::jsonb,updated_at=now()
      WHERE id=$1::uuid AND publication_operation_ref=$2::uuid
        AND publication_detail->>'action'='publish' AND status='publishing'
      RETURNING id`,[row.id,operation,JSON.stringify({live_verified:true,live_detail:live})]);
    const current=await creatorChallengeById(query,row.id);
    if(current.status==='published'&&String(current.publication_operation_ref)===operation)
      await query(`INSERT INTO creator_challenge_audit(creator_challenge_id,admin_auth_user_id,action,detail)
        SELECT $1::uuid,published_by_admin_auth_user_id,'published',jsonb_build_object('operation',$2::text)
        FROM creator_challenges WHERE id=$1::uuid
        AND NOT EXISTS(
          SELECT 1 FROM creator_challenge_audit
          WHERE creator_challenge_id=$1::uuid AND action='published' AND detail->>'operation'=$2::text
        )`,[row.id,operation]);
    return statePayload(await creatorChallengeById(query,row.id),{reconciled:true,workflow});
  }
  await query(`UPDATE creator_challenges SET publication_error=NULL,
      publication_detail=publication_detail||$3::jsonb,updated_at=now()
    WHERE id=$1::uuid AND publication_operation_ref=$2::uuid
      AND publication_detail->>'action'='retire' AND status='retired'`,[
    row.id,operation,JSON.stringify({live_verified:true,live_detail:live}),
  ]);
  return statePayload(await creatorChallengeById(query,row.id),{reconciled:true,workflow});
}

function staticCleanupMayExist(row) {
  const detail=operationDetail(row),action=operationAction(row);
  if(row.published_at||row.status==='published'||row.status==='publishing')return true;
  if(action==='publish')return UUID.test(String(row.publication_operation_ref||''))
    ||Boolean(detail.workflow)
    ||['pending','accepted','ambiguous'].includes(String(detail?.dispatch?.state||''));
  if(action==='retire'&&detail.live_verified!==true)
    return detail.static_cleanup==='required'
      ||Boolean(detail.workflow)
      ||['pending','accepted','ambiguous','rejected'].includes(String(detail?.dispatch?.state||''));
  return false;
}

async function completeRetirementWithoutStaticCleanup(query,row,{adminAuthUserId=null,reason='retired'}={}) {
  for(let attempt=0;attempt<4;attempt++) {
    if(staticCleanupMayExist(row))return {complete:false,row};
    const expectedOperation=UUID.test(String(row.publication_operation_ref||''))
      ?String(row.publication_operation_ref)
      :null;
    const expectedDetail=operationDetail(row);
    const detail={
      action:'retire',
      reason,
      live_verified:true,
      static_cleanup:'not_required',
    };
    const changed=await query(`UPDATE creator_challenges SET status='retired',
        retired_at=COALESCE(retired_at,now()),
        retired_by_admin_auth_user_id=COALESCE(retired_by_admin_auth_user_id,$2::uuid),
        publication_operation_ref=NULL,publication_detail=$3::jsonb,
        publication_error=NULL,updated_at=now()
      WHERE id=$1::uuid AND status=$4
        AND publication_operation_ref IS NOT DISTINCT FROM $5::uuid
        AND publication_detail=$6::jsonb
        AND published_at IS NOT DISTINCT FROM $7::timestamptz
      RETURNING id`,[
      row.id,adminAuthUserId,JSON.stringify(detail),row.status,
      expectedOperation,JSON.stringify(expectedDetail),row.published_at||null,
    ]);
    if(changed.rows[0])return {complete:true,row:await creatorChallengeById(query,row.id)};
    row=await creatorChallengeById(query,row.id);
  }
  return {complete:false,row};
}

export async function beginCreatorPublicationOperation(query,row,action,{adminAuthUserId=null,reason=null,privacy=false}={}) {
  for(let attempt=0;attempt<4;attempt++) {
    const detail=operationDetail(row),existingAction=operationAction(row),existingOperation=String(row.publication_operation_ref||'');
    const workflowFailed=detail?.workflow?.status==='completed'&&detail?.workflow?.conclusion&&detail.workflow.conclusion!=='success';
    if(existingAction===action&&UUID.test(existingOperation)&&!workflowFailed
      &&((action==='publish'&&row.status==='publishing')||(action==='retire'&&row.status==='retired')))
      return {row,operation:existingOperation,reused:true};
    if(action==='publish'&&row.status==='published')return {row,operation:null,reused:true,complete:true};
    if(action==='publish'&&row.status==='retired')fail('Retired creator challenges cannot be republished.',409,'CREATOR_RETIRED');
    if(action==='retire'&&row.status==='retired'&&existingAction==='retire'&&detail.live_verified===true)
      return {row,operation:null,reused:true,complete:true};
    const operation=crypto.randomUUID();
    const expectedOperation=UUID.test(existingOperation)?existingOperation:null;
    const supersededPublish=action==='retire'
      &&existingAction==='publish'
      &&UUID.test(existingOperation)
      ?{
        operation:existingOperation,
        requested_at:detail.requested_at||null,
        dispatch:detail.dispatch||null,
        workflow:detail.workflow||null,
      }
      :null;
    const nextDetail={
      action,
      ...(reason?{reason}:{}),
      ...(action==='retire'&&staticCleanupMayExist(row)?{static_cleanup:'required'}:{}),
      ...(supersededPublish?{superseded_publish:supersededPublish}:{}),
      requested_at:new Date().toISOString(),
      dispatch:{state:'pending',attempts:0},
      live_verified:false,
    };
    let changed;
    if(action==='publish') {
      changed=await query(`UPDATE creator_challenges SET status='publishing',
          publication_operation_ref=$2::uuid,publication_detail=$3::jsonb,
          publication_error=NULL,updated_at=now()
        WHERE id=$1::uuid AND status=$4
          AND publication_operation_ref IS NOT DISTINCT FROM $5::uuid
        RETURNING id`,[row.id,operation,JSON.stringify(nextDetail),row.status,expectedOperation]);
    } else {
      changed=await query(`UPDATE creator_challenges SET status='retired',
          retired_at=COALESCE(retired_at,now()),
          retired_by_admin_auth_user_id=COALESCE(retired_by_admin_auth_user_id,$2::uuid),
          privacy_removed_at=CASE WHEN $3::boolean THEN COALESCE(privacy_removed_at,now()) ELSE privacy_removed_at END,
          publication_operation_ref=$4::uuid,publication_detail=$5::jsonb,
          publication_error=NULL,updated_at=now()
        WHERE id=$1::uuid AND status=$6
          AND publication_operation_ref IS NOT DISTINCT FROM $7::uuid
        RETURNING id`,[
        row.id,adminAuthUserId,privacy,operation,JSON.stringify(nextDetail),row.status,expectedOperation,
      ]);
    }
    if(changed.rows[0]) {
      await query(`INSERT INTO creator_challenge_audit(creator_challenge_id,admin_auth_user_id,action,detail)
        VALUES($1::uuid,$2::uuid,$3,jsonb_build_object('operation',$4::text,'reason',$5::text))`,[
        row.id,adminAuthUserId,action==='publish'?'publish_requested':privacy?'privacy_retired':'retired',
        operation,reason||action,
      ]);
      return {row:await creatorChallengeById(query,row.id),operation,reused:false};
    }
    row=await creatorChallengeById(query,row.id);
  }
  fail('Creator publication changed concurrently. Reload and retry.',409,'CREATOR_PUBLISH_CONFLICT');
}

export async function requestCreatorPrivacyRetirement(query,playerId,{reason='account_deletion',today=null,env=process.env,fetcher=fetch}={}) {
  const result=await query(`SELECT id FROM creator_challenges
    WHERE source_owner_player_id=$1::uuid
      AND NOT (
        status='retired'
        AND COALESCE(publication_detail->>'live_verified','false')='true'
      )
    ORDER BY created_at,id`,[playerId]);
  let ready=true;
  for(const item of result.rows) {
    let row=await creatorChallengeById(query,item.id);
    await query(`UPDATE game_results SET opponent_name='A creator'
      WHERE creator_challenge_id=$1::uuid`,[row.id]);
    await query(`UPDATE creator_challenges SET status='retired',
        creator_public_name='A creator',creator_handle=NULL,headline='Creator challenge unavailable',
        creator_post_run_note=NULL,source_owner_auth_user_id=NULL,
        privacy_removed_at=COALESCE(privacy_removed_at,now()),
        retired_at=COALESCE(retired_at,now()),updated_at=now()
      WHERE id=$1::uuid`,[row.id]);
    row=await creatorChallengeById(query,row.id);
    const direct=await completeRetirementWithoutStaticCleanup(query,row,{reason});
    if(direct.complete)continue;
    row=direct.row;
    const begun=await beginCreatorPublicationOperation(query,row,'retire',{reason,privacy:true});
    row=begun.row;
    try {
      const state=await reconcile(query,row,{today,env,fetcher});
      if(state.live_verified===true)continue;
    } catch(error) {
      await guardedError(query,row.id,begun.operation,'retire',String(error?.message||error));
    }
    ready=false;
  }
  return ready;
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
    if(row.publication_operation_ref)return Response.json(
      await reconcile(query,row,{today,env,fetcher}),
      {headers:{'cache-control':'no-store'}},
    );
    return Response.json(statePayload(row),{headers:{'cache-control':'no-store'}});
  }
  if(request.method!=='POST')fail('Method not allowed.',405);

  const body=await readJson(request);
  const action=body?.action==='retire'?'retire':body?.action==='publish'?'publish':null;
  if(!action)fail('Choose publish or retire.');

  if(action==='publish') {
    if(row.status==='published')return Response.json(
      {...statePayload(row),already_published:true},
      {headers:{'cache-control':'no-store'}},
    );
    if(row.status==='retired')fail('Retired creator challenges cannot be republished.',409,'CREATOR_RETIRED');
    await validateCreatorChallengeSource(query,row,{today,requireClosed:true});
  }

  if(action==='retire'&&row.status!=='retired'&&!staticCleanupMayExist(row)) {
    const direct=await completeRetirementWithoutStaticCleanup(query,row,{
      adminAuthUserId:auth.user_id,
      reason:'admin_retire',
    });
    row=direct.row;
    if(direct.complete) {
      await query(`INSERT INTO creator_challenge_audit(creator_challenge_id,admin_auth_user_id,action,detail)
        VALUES($1::uuid,$2::uuid,'retired',jsonb_build_object('reason','admin_retire','static_cleanup','not_required'))`,[
        row.id,auth.user_id,
      ]);
      return Response.json({...statePayload(row),ok:true},{headers:{'cache-control':'no-store'}});
    }
  }

  const begun=await beginCreatorPublicationOperation(query,row,action,{
    adminAuthUserId:auth.user_id,
    reason:action==='retire'?'admin_retire':'admin_publish',
    privacy:false,
  });
  row=begun.row;
  if(begun.complete)return Response.json({...statePayload(row),ok:true},{headers:{'cache-control':'no-store'}});

  const state=await reconcile(query,row,{today,env,fetcher});
  row=state.challenge;
  const dispatch=operationDetail(row).dispatch||null;
  if(dispatch?.state==='rejected')return Response.json(
    {...statePayload(row),ok:false,error:dispatch.error||row.publication_error||'Creator publication dispatch was rejected.'},
    {status:503,headers:{'cache-control':'no-store'}},
  );
  return Response.json({
    ...statePayload(row),
    ok:true,
    operation:begun.operation,
    reused_operation:begun.reused,
  },{status:202,headers:{'cache-control':'no-store'}});
}

/**
 * Physical removal is intentionally limited to retired, live-verified release canaries.
 * Customer creator challenges always use protected retirement instead. FKs preserve
 * player sessions/results (SET NULL) and only canary-specific audit rows cascade.
 */
export async function purgeVerifiedCreatorCanary(query,id,slug) {
  if(!UUID.test(String(id||''))||!/^canary-(practice|daily)-[a-f0-9]{8}$/.test(String(slug||'')))
    fail('Only verified release canaries can be removed permanently.',409,'CREATOR_PURGE_FORBIDDEN');
  const removed=await query(`DELETE FROM creator_challenges c
    WHERE c.id=$1::uuid AND c.slug=$2
      AND c.status='retired'
      AND c.publication_detail->>'live_verified'='true'
      AND c.creator_public_name='A creator'
      AND c.creator_handle IS NULL
      AND c.privacy_removed_at IS NOT NULL
      AND c.acquisition_campaign='release-canary'
      AND c.slug ~ '^canary-(practice|daily)-[a-f0-9]{8}$'
      AND EXISTS(
        SELECT 1 FROM draft_run_sessions source
        WHERE source.id=c.source_session_id AND source.measurement_qa
      )
      AND NOT EXISTS(
        SELECT 1 FROM draft_run_sessions challenger
        WHERE challenger.creator_challenge_id=c.id AND NOT challenger.measurement_qa
      )
      AND NOT EXISTS(
        SELECT 1 FROM game_results result
        LEFT JOIN players player ON player.id=result.player_id
        WHERE result.creator_challenge_id=c.id
          AND (player.id IS NULL OR player.display_name IS DISTINCT FROM 'QA Creator Canary'
            OR EXISTS(SELECT 1 FROM account_links linked WHERE linked.player_id=result.player_id))
      )
      AND NOT EXISTS(
        SELECT 1 FROM analytics_events event
        LEFT JOIN players player ON player.id=event.player_id
        WHERE event.event_props->>'creator_challenge_id'=c.id::text
          AND (player.id IS NULL OR player.display_name IS DISTINCT FROM 'QA Creator Canary'
            OR EXISTS(SELECT 1 FROM account_links linked WHERE linked.player_id=event.player_id))
      )
    RETURNING c.id,c.slug`,[id,slug]);
  if(!removed.rows[0])fail(
    'This challenge is not a fully verified QA-only canary or has real-player activity. Nothing was deleted.',
    409,'CREATOR_PURGE_FORBIDDEN',
  );
  return {id:String(removed.rows[0].id),slug:removed.rows[0].slug};
}

export async function handleCreatorChallengePurge(request,{query,readJson,allowedOrigins}={}) {
  if(typeof query!=='function'||typeof readJson!=='function'||!(allowedOrigins instanceof Set))
    throw Error('Creator purge dependencies are unavailable.');
  const id=new URL(request.url).pathname.match(/^\/v1\/admin\/creator-challenges\/([a-f0-9-]{36})\/purge$/i)?.[1];
  if(!id)fail('Not found.',404);
  if(request.method!=='POST')fail('Method not allowed.',405);
  await requireCreatorAdmin(request,{query,allowedOrigins,csrf:true});
  const row=await creatorChallengeById(query,id);
  if(!row)fail('Creator challenge not found.',404);
  const input=await readJson(request);
  if(input?.confirm!==row.slug)fail('Confirm the exact QA test slug.',400,'CREATOR_PURGE_CONFIRM');
  const removed=await purgeVerifiedCreatorCanary(query,row.id,row.slug);
  return Response.json({ok:true,removed},{headers:{'cache-control':'no-store'}});
}
