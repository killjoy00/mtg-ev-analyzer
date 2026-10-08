import {beginAdminDeletion,loadDeletionForAuth} from './account-deletion.mjs';
import {adminDeletionEmail,adminNotificationRequested,sendAdminActionEmail} from './admin-user-notifications.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=(message,status=400,code=null)=>{throw Object.assign(Error(message),{status,...(code?{code}:{})});};
const bool=value=>value===true||value==='t'||value==='true'||value===1||value==='1';
const num=value=>Number.isFinite(Number(value))?Number(value):0;

function safeErrorCode(value) {
  const code=String(value||'').trim();
  return /^[A-Z0-9_]{1,80}$/.test(code)?code:null;
}

function operatorMessage(state) {
  if(state==='complete')return 'Deletion completed.';
  if(state==='operator_review')return 'Deletion requires operator review through the established account-deletion maintenance procedure.';
  if(state==='provider_delete_pending')return 'Pack One data cleanup is committed; provider deletion is pending or retrying.';
  if(state==='provider_deleted')return 'Provider deletion completed; finalization is pending.';
  if(state==='app_cleanup_complete')return 'Pack One data cleanup completed; provider deletion is pending.';
  return 'Deletion has started and is continuing.';
}

export function adminDeletionStatus(row) {
  if(!row)return null;
  return {
    operation_id:String(row.operation_id),
    state:String(row.state),
    initiation_source:String(row.initiation_source||'self_service'),
    initiated_by_admin_auth_user_id:row.initiated_by_admin_auth_user_id?String(row.initiated_by_admin_auth_user_id):null,
    target_was_admin:bool(row.target_was_admin),
    attempts:num(row.attempts),
    error_code:safeErrorCode(row.last_error_code),
    created_at:row.created_at||null,
    updated_at:row.updated_at||null,
    app_cleanup_completed_at:row.app_cleanup_completed_at||null,
    provider_deleted_at:row.provider_deleted_at||null,
    completed_at:row.completed_at||null,
    message:operatorMessage(String(row.state)),
  };
}

function operationFromStart(row) {
  if(!row)return null;
  const {start_status,...operation}=row;
  return operation.operation_id?operation:null;
}

export async function handleAdminAccountDeletion(
  request,
  query,
  url=new URL(request.url),
  {readJson=null,adminAuthUserId=null,deletionEnabled=()=>false,resumeDeletionOperation=null,notify=sendAdminActionEmail}={},
) {
  const match=url.pathname.match(/^\/v1\/admin\/users\/([a-f0-9-]+)\/(delete|deletion)$/i);
  if(!match)return null;
  const targetAuthUserId=match[1];
  if(!UUID.test(targetAuthUserId)||!UUID.test(String(adminAuthUserId||'')))fail('Invalid account deletion request.',400);

  if(match[2]==='deletion'&&request.method==='GET') {
    const operation=await loadDeletionForAuth(query,targetAuthUserId);
    if(!operation)fail('No deletion operation exists for this account.',404,'DELETION_NOT_FOUND');
    return {status:200,body:{ok:true,deletion:adminDeletionStatus(operation)}};
  }
  if(match[2]!=='delete'||request.method!=='POST')fail('Method not allowed.',405);
  if(typeof readJson!=='function'||typeof resumeDeletionOperation!=='function')fail('Deletion service unavailable.',503);
  if(!deletionEnabled())fail('Account deletion is temporarily unavailable.',503,'DELETION_DISABLED');
  if(targetAuthUserId===String(adminAuthUserId))fail('Use the normal account settings flow to delete your own account.',409,'ADMIN_SELF_DELETE');

  const body=await readJson(request);
  if(body.confirm!=='DELETE')fail('Type DELETE to confirm permanent account deletion.',400,'DELETE_CONFIRMATION');
  const reason=String(body.reason||'').trim();
  if(reason.length>200)fail('Deletion reason must be 200 characters or fewer.',400);
  const acknowledgeAdmin=body.acknowledgeAdmin===true;

  // Helpful early denial; the database initializer repeats these checks
  // under the target identity lock before any irreversible tombstone write.
  const targetMember=await query('SELECT role FROM pack1_admins WHERE auth_user_id=$1::uuid',[targetAuthUserId]);
  const targetRole=targetMember.rows[0]?.role;
  if(targetRole==='owner')fail('The Owner account cannot be deleted. Transfer ownership through a controlled operator process first.',409,'OWNER_PROTECTED');
  if(targetRole==='admin'){
    const actor=await query('SELECT role FROM pack1_admins WHERE auth_user_id=$1::uuid',[adminAuthUserId]);
    if(actor.rows[0]?.role!=='owner')
      fail('Only the Owner can permanently delete another administrator account.',403,'ADMIN_OWNER_REQUIRED');
  }

  // Read before deletion starts: the auth record, and with it the address, is
  // removed by the provider phase.
  const target=await query('SELECT email,"emailVerified" email_verified FROM neon_auth."user" WHERE id=$1::uuid LIMIT 1',[targetAuthUserId]);
  const knownEmail=target.rows[0]?.email||null;
  const noticeEmail=bool(target.rows[0]?.email_verified)?knownEmail:null;
  const started=await beginAdminDeletion(query,{
    authUserId:targetAuthUserId,
    adminAuthUserId,
    reason:reason||null,
    acknowledgeAdmin,
  });
  if(!started)fail('Account deletion could not be started.',500,'DELETE_START');
  if(started.start_status==='self_delete')fail('Use the normal account settings flow to delete your own account.',409,'ADMIN_SELF_DELETE');
  if(started.start_status==='forbidden')fail('This account does not have admin access.',403);
  if(started.start_status==='owner_required')fail('Only the Owner can permanently delete another administrator account.',403,'ADMIN_OWNER_REQUIRED');
  if(started.start_status==='owner_protected')fail('The Owner account cannot be deleted. Transfer ownership through a controlled operator process first.',409,'OWNER_PROTECTED');
  if(started.start_status==='unknown_target')fail('User not found.',404);
  if(started.start_status==='admin_ack_required')
    fail('Confirm that you intend to permanently delete another administrator account.',409,'ADMIN_TARGET_CONFIRMATION');
  if(started.start_status==='invalid')fail('Account deletion request is invalid.',400);

  let operation=operationFromStart(started);
  if(!operation)fail('Account deletion could not be started.',500,'DELETE_START');
  // Only the request that created the operation notifies, so a retried or
  // concurrent submit cannot email the user twice. The deletion is committed
  // at this point, so the notice is sent before the slower provider phase.
  const notification=started.start_status==='created'
    ? await notify({
      kind:'admin_deletion',
      requested:adminNotificationRequested(body),
      email:noticeEmail,
      idempotencyKey:'pack1-admin-deletion/'+operation.operation_id,
      message:adminDeletionEmail({reason}),
    })
    : {status:'skipped',reason:'already_started'};
  try {
    operation=await resumeDeletionOperation(operation,{knownEmail});
  } catch(error) {
    try {
      operation=await loadDeletionForAuth(query,targetAuthUserId)||operation;
    } catch {}
    const committed=adminDeletionStatus(operation);
    console.error(JSON.stringify({
      event:'admin_account_deletion_resume_error',
      operation_id:operation.operation_id,
      state:operation.state,
      error_code:safeErrorCode(error?.code)||safeErrorCode(operation.last_error_code)||'ADMIN_DELETE_RESUME',
      error_name:String(error?.name||'Error').slice(0,80),
    }));
    throw Object.assign(error,{
      deletionCommitted:true,
      operationId:committed?.operation_id||null,
      deletion:committed,
      notification,
    });
  }

  const view=adminDeletionStatus(operation);
  const complete=view?.state==='complete';
  return {
    status:complete?200:202,
    body:{
      ok:true,
      deletion:complete?'complete':'accepted',
      operationId:view?.operation_id||null,
      operation:view,
      notification,
    },
  };
}
