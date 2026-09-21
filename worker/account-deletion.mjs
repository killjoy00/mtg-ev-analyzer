import {createHmac} from 'node:crypto';

export const DELETION_STATES=new Set([
  'pending','app_cleanup_complete','provider_delete_pending','provider_deleted','complete','operator_review',
]);

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const deletionEnabled=(env=process.env)=>env.PACK1_ACCOUNT_DELETION_ENABLED==='1';
export const verificationSweepEnabled=(env=process.env)=>env.PACK1_VERIFICATION_SWEEP_ENABLED==='1';

function uuid(value) {
  const id=String(value||'');
  if(!UUID.test(id))throw Object.assign(Error('Account deletion identity is invalid.'),{status:500,code:'DELETE_IDENTITY'});
  return id;
}

export function deletionRecoveryKey(email,env=process.env) {
  const secret=String(env.PACK1_RATE_LIMIT_SECRET||'');
  if(secret.length<32)return null;
  const normalized=String(email||'').trim().toLowerCase();
  return normalized?createHmac('sha256',secret).update(normalized).digest('hex'):null;
}

export async function deletedPlayerTombstone(query,playerId) {
  if(!UUID.test(String(playerId||'')))return false;
  const result=await query(`SELECT 1 FROM account_deletion_operations
    WHERE player_id=$1::uuid AND state IN ('pending','app_cleanup_complete','provider_delete_pending','provider_deleted','complete','operator_review')
    LIMIT 1`,[playerId]);
  return Boolean(result.rows[0]);
}

export async function beginDeletion(query,{authUserId,playerId=null}) {
  const auth=uuid(authUserId);
  const player=playerId==null?null:uuid(playerId);
  const result=await query(`
    WITH lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))
    ), linked AS MATERIALIZED (
      SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid
    ), inserted AS (
      INSERT INTO account_deletion_operations(auth_user_id,player_id,state)
      SELECT $1::uuid,COALESCE($2::uuid,(SELECT player_id FROM linked)),'pending'
      FROM lock
      ON CONFLICT(auth_user_id) DO UPDATE SET
        updated_at=account_deletion_operations.updated_at
      RETURNING *
    ), revoked AS (
      UPDATE account_sessions s
      SET revoked_at=COALESCE(s.revoked_at,now())
      FROM inserted i
      WHERE s.auth_user_id=i.auth_user_id AND s.revoked_at IS NULL
      RETURNING s.session_hash
    )
    SELECT operation_id,auth_user_id,player_id,state,attempts,last_error_code,created_at,updated_at
    FROM inserted`,[auth,player]);
  return result.rows[0]||null;
}

export async function loadDeletionOperation(query,operationId) {
  const result=await query(`SELECT operation_id,auth_user_id,player_id,state,attempts,last_error_code,
      created_at,updated_at,app_cleanup_completed_at,provider_deleted_at,completed_at
    FROM account_deletion_operations WHERE operation_id=$1::uuid LIMIT 1`,[uuid(operationId)]);
  return result.rows[0]||null;
}

export async function loadDeletionForAuth(query,authUserId) {
  const result=await query(`SELECT operation_id,auth_user_id,player_id,state,attempts,last_error_code,
      created_at,updated_at,app_cleanup_completed_at,provider_deleted_at,completed_at
    FROM account_deletion_operations WHERE auth_user_id=$1::uuid LIMIT 1`,[uuid(authUserId)]);
  return result.rows[0]||null;
}

export async function cleanupPackOne(query,operation,{recoveryKey=null}) {
  if(!operation)throw Error('Deletion operation required.');
  const operationId=uuid(operation.operation_id);
  const result=await query(`
    WITH op AS MATERIALIZED (
      SELECT * FROM account_deletion_operations
      WHERE operation_id=$1::uuid
      FOR UPDATE
    ), eligible AS MATERIALIZED (
      SELECT * FROM op WHERE state IN ('pending','app_cleanup_complete','provider_delete_pending')
    ), owned_challenges AS MATERIALIZED (
      SELECT c.id FROM share_challenges c JOIN eligible e ON c.player_id=e.player_id
    ), redact_other_results AS (
      UPDATE game_results g SET challenge_id=NULL,opponent_name=NULL
      WHERE EXISTS(SELECT 1 FROM eligible)
        AND g.player_id IS DISTINCT FROM (SELECT player_id FROM eligible)
        AND g.challenge_id IN (SELECT id FROM owned_challenges)
      RETURNING g.id
    ), null_admin_invites AS (
      UPDATE pack1_admin_invites i SET redeemed_by=NULL
      WHERE i.redeemed_by=(SELECT auth_user_id FROM eligible)
      RETURNING i.token_hash
    ), null_corpus AS (
      UPDATE corpus_status_events c SET auth_user_id=NULL
      WHERE c.auth_user_id=(SELECT auth_user_id FROM eligible)
      RETURNING c.id
    ), delete_shares AS (
      DELETE FROM draft_run_shares d
      USING draft_run_sessions s,eligible e
      WHERE d.session_id=s.id AND (s.player_id=e.player_id OR s.daily_account_id=e.auth_user_id)
      RETURNING d.id
    ), delete_runs AS (
      DELETE FROM draft_run_sessions s USING eligible e
      WHERE s.player_id=e.player_id OR s.daily_account_id=e.auth_user_id
      RETURNING s.id
    ), delete_achievements AS (
      DELETE FROM player_achievements p USING eligible e WHERE p.player_id=e.player_id RETURNING p.player_id
    ), delete_analytics AS (
      DELETE FROM analytics_events a USING eligible e WHERE a.player_id=e.player_id RETURNING a.id
    ), delete_scores AS (
      DELETE FROM scores s USING eligible e WHERE s.player_id=e.player_id RETURNING s.id
    ), delete_results AS (
      DELETE FROM game_results g USING eligible e WHERE g.player_id=e.player_id RETURNING g.id
    ), delete_limits AS (
      DELETE FROM player_request_limits l USING eligible e WHERE l.player_id=e.player_id RETURNING l.scope
    ), delete_challenges AS (
      DELETE FROM share_challenges c USING eligible e WHERE c.player_id=e.player_id RETURNING c.id
    ), delete_merges AS (
      DELETE FROM player_identity_merges m USING eligible e
      WHERE m.source_player_id=e.player_id OR m.target_player_id=e.player_id
      RETURNING m.id
    ), delete_provider_states AS (
      DELETE FROM provider_oauth_states p USING eligible e WHERE p.auth_user_id=e.auth_user_id RETURNING p.state_hash
    ), delete_provider_accounts AS (
      DELETE FROM provider_accounts p USING eligible e WHERE p.auth_user_id=e.auth_user_id RETURNING p.provider
    ), delete_entitlements AS (
      DELETE FROM entitlement_grants g USING eligible e WHERE g.auth_user_id=e.auth_user_id RETURNING g.capability
    ), delete_admin AS (
      DELETE FROM pack1_admins a USING eligible e WHERE a.auth_user_id=e.auth_user_id RETURNING a.auth_user_id
    ), delete_credential_limits AS (
      DELETE FROM account_credential_rate_limits l USING eligible e WHERE l.auth_user_id=e.auth_user_id RETURNING l.purpose
    ), delete_recovery_limit AS (
      DELETE FROM account_recovery_rate_limits r
      WHERE $2::text IS NOT NULL AND r.limit_key=$2
      RETURNING r.limit_key
    ), delete_links AS (
      DELETE FROM account_links a USING eligible e WHERE a.auth_user_id=e.auth_user_id RETURNING a.player_id
    ), delete_sessions AS (
      DELETE FROM account_sessions a USING eligible e WHERE a.auth_user_id=e.auth_user_id RETURNING a.session_hash
    ), delete_player AS (
      DELETE FROM players p USING eligible e WHERE p.id=e.player_id RETURNING p.id
    ), advanced AS (
      UPDATE account_deletion_operations d
      SET state='provider_delete_pending',
          app_cleanup_completed_at=COALESCE(app_cleanup_completed_at,now()),
          updated_at=now(),
          last_error_code=NULL
      WHERE d.operation_id=$1::uuid
        AND d.state IN ('pending','app_cleanup_complete','provider_delete_pending')
      RETURNING d.*
    )
    SELECT operation_id,auth_user_id,player_id,state,attempts,last_error_code,
           created_at,updated_at,app_cleanup_completed_at,provider_deleted_at,completed_at
    FROM advanced`,[operationId,recoveryKey]);
  return result.rows[0]||await loadDeletionOperation(query,operationId);
}

async function providerCall(authBase,path,{body,cookie}={}) {
  const response=await fetch(authBase+path,{
    method:'POST',
    headers:{
      origin:'https://packone.pro',
      accept:'application/json',
      'content-type':'application/json',
      ...(cookie?{cookie}:{}),
    },
    body:JSON.stringify(body||{}),
    redirect:'manual',
    signal:AbortSignal.timeout(15000),
  });
  const data=await response.json().catch(()=>({}));
  const set=String(response.headers.get('set-cookie')||'');
  const session=set.split(/,(?=\s*[^;,]+=)/)[0]?.split(';')[0]?.trim()||cookie||'';
  return {response,data,cookie:session};
}

export async function removeProviderUser({authBase,authUserId,env=process.env}) {
  const email=String(env.PACK1_DELETION_ADMIN_EMAIL||'').trim();
  const password=String(env.PACK1_DELETION_ADMIN_PASSWORD||'');
  if(!email||password.length<16)return {kind:'operator_review',code:'PROVIDER_ADMIN_CONFIG'};
  let session='';
  try {
    let signed=await providerCall(authBase,'/sign-in/email',{body:{email,password,rememberMe:false}});
    if(!signed.response.ok||!signed.cookie)return {kind:'operator_review',code:'PROVIDER_ADMIN_AUTH'};
    session=signed.cookie;
    const serviceId=String(signed.data?.user?.id||'');
    if(!UUID.test(serviceId)||serviceId===String(authUserId))
      return {kind:'operator_review',code:'PROVIDER_ADMIN_IDENTITY'};
    let removed=await providerCall(authBase,'/admin/remove-user',{cookie:session,body:{userId:authUserId}});
    if(removed.response.status===401) {
      signed=await providerCall(authBase,'/sign-in/email',{body:{email,password,rememberMe:false}});
      if(!signed.response.ok||!signed.cookie)return {kind:'operator_review',code:'PROVIDER_ADMIN_AUTH'};
      session=signed.cookie;
      removed=await providerCall(authBase,'/admin/remove-user',{cookie:session,body:{userId:authUserId}});
    }
    if(removed.response.ok)return {kind:'success'};
    const providerCode=String(removed.data?.code||'');
    if(removed.response.status===404&&providerCode==='USER_NOT_FOUND')return {kind:'not_found'};
    if(removed.response.status===403)return {kind:'operator_review',code:'PROVIDER_FORBIDDEN'};
    if(removed.response.status===429)return {kind:'transient',code:'PROVIDER_RATE_LIMIT'};
    if(removed.response.status>=500)return {kind:'transient',code:'PROVIDER_5XX'};
    return {kind:'operator_review',code:'PROVIDER_RESPONSE'};
  } catch(error) {
    if(error?.name==='TimeoutError'||error?.name==='AbortError')return {kind:'transient',code:'PROVIDER_TIMEOUT'};
    return {kind:'transient',code:'PROVIDER_NETWORK'};
  } finally {
    if(session) {
      try {await providerCall(authBase,'/sign-out',{cookie:session,body:{}});} catch {}
    }
  }
}

export async function finishProviderPhase(query,operation,result) {
  const id=uuid(operation.operation_id);
  if(result.kind==='operator_review') {
    await query(`UPDATE account_deletion_operations
      SET state='operator_review',attempts=attempts+1,last_error_code=$2,updated_at=now()
      WHERE operation_id=$1::uuid`,[id,result.code||'PROVIDER_FAILURE']);
    return loadDeletionOperation(query,id);
  }
  if(result.kind==='transient') {
    await query(`UPDATE account_deletion_operations
      SET attempts=attempts+1,last_error_code=$2,updated_at=now()
      WHERE operation_id=$1::uuid AND state='provider_delete_pending'`,[id,result.code||'PROVIDER_TRANSIENT']);
    return loadDeletionOperation(query,id);
  }
  if(result.kind==='not_found'&&operation.state!=='provider_delete_pending') {
    await query(`UPDATE account_deletion_operations
      SET state='operator_review',attempts=attempts+1,last_error_code='UNEXPECTED_USER_NOT_FOUND',updated_at=now()
      WHERE operation_id=$1::uuid`,[id]);
    return loadDeletionOperation(query,id);
  }
  const updated=await query(`UPDATE account_deletion_operations
    SET state='complete',attempts=attempts+1,last_error_code=NULL,
        provider_deleted_at=COALESCE(provider_deleted_at,now()),
        completed_at=COALESCE(completed_at,now()),updated_at=now()
    WHERE operation_id=$1::uuid AND state IN ('provider_delete_pending','provider_deleted')
    RETURNING *`,[id]);
  return updated.rows[0]||loadDeletionOperation(query,id);
}

export async function sweepExpiredVerification(query,{limit=200}={}) {
  const bounded=Math.max(1,Math.min(500,Number(limit)||200));
  const result=await query(`WITH expired AS (
      SELECT id FROM neon_auth.verification
      WHERE "expiresAt"<now()
      ORDER BY "expiresAt",id
      LIMIT $1::int
    )
    DELETE FROM neon_auth.verification v
    USING expired e
    WHERE v.id=e.id AND v."expiresAt"<now()
    RETURNING v.id`,[bounded]);
  return Number(result.rowCount||0);
}

export async function maintenanceBatch(query,{limit=20}={}) {
  const bounded=Math.max(1,Math.min(50,Number(limit)||20));
  const result=await query(`SELECT operation_id,auth_user_id,player_id,state,attempts,last_error_code,
      created_at,updated_at,app_cleanup_completed_at,provider_deleted_at,completed_at
    FROM account_deletion_operations
    WHERE state<>'complete'
    ORDER BY updated_at,operation_id
    LIMIT $1::int`,[bounded]);
  return result.rows;
}

export function stuckDeletion(row,now=Date.now()) {
  if(row?.state==='operator_review')return true;
  const at=new Date(row?.created_at||row?.updated_at||0).getTime();
  return Number.isFinite(at)&&now-at>15*60*1000;
}
