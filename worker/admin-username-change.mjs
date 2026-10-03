import {deletionEmailForAuth} from './account-deletion-verification.mjs';
import {adminNotificationRequested,adminRenameEmail,sendAdminActionEmail} from './admin-user-notifications.mjs';
import {assertPublicDisplayNameAllowed} from './public-identity-safety.mjs';
import {isPlaceholderUsername,normalizeDisplayName,rethrowUsernameConflict} from './username.mjs';

// Served by pack1growth, which holds the account email key, so an admin rename
// can notify the account owner in the same request.
const UUID=/^[a-f0-9-]{36}$/i;
const fail=(message,status=400,code=null)=>{throw Object.assign(Error(message),{status,...(code?{code}:{})});};
const bool=value=>value===true||value==='t'||value==='true'||value===1||value==='1';

export async function handleAdminUsernameChange(
  request,
  query,
  url=new URL(request.url),
  {readJson=null,adminAuthUserId=null,notify=sendAdminActionEmail}={},
) {
  const rename=url.pathname.match(/^\/v1\/admin\/users\/([a-f0-9-]+)\/username$/i);
  if(!rename)return null;
  if(request.method!=='PATCH')fail('Method not allowed.',405);
  if(!UUID.test(rename[1])||!readJson||!adminAuthUserId)fail('Invalid username change request.',400);
  const body=await readJson(request);
  const raw=String(body.displayName??'');
  const reason=String(body.reason||'').trim();
  if(raw.length>200)fail('Display name input is too long.',400);
  if(reason.length>200)fail('Reason must be 200 characters or fewer.',400);
  const displayName=normalizeDisplayName(raw);
  const owned=!isPlaceholderUsername(displayName);
  if(owned)assertPublicDisplayNameAllowed(displayName);
  let changed;
  try {
    changed=await query(
      `SELECT result_status,player_id,previous_display_name,new_display_name,username_owned
       FROM pack1_admin_rename_public_username($1::uuid,$2::uuid,$3,$4::boolean,$5)`,
      [rename[1],adminAuthUserId,displayName,owned,reason||null],
    );
  } catch(error) {
    rethrowUsernameConflict(error);
  }
  const result=changed.rows[0];
  if(!result)fail('Username change could not be completed.',500);
  if(result.result_status==='forbidden')fail('This account does not have admin access.',403);
  if(result.result_status==='deleting')fail('This account is being deleted.',409,'ACCOUNT_DELETING');
  if(result.result_status==='unknown')fail('User not found.',404);
  if(result.result_status==='unlinked')fail('User has no linked public identity.',409);
  if(result.result_status==='moderated')
    fail('This display name is unavailable. Restore the moderated identity before changing it.',403,'PUBLIC_IDENTITY_MODERATED');
  if(result.result_status==='public_profile_requires_username')
    fail('Make the public profile private before releasing its username.',409,'PUBLIC_PROFILE_REQUIRES_USERNAME');
  if(result.result_status==='invalid')fail('Username change is invalid.',400);
  const renamed=result.result_status==='renamed';
  let notification={status:'skipped',reason:'unchanged'};
  if(renamed) {
    notification=await notify({
      kind:'admin_rename',
      requested:adminNotificationRequested(body),
      resolveEmail:()=>deletionEmailForAuth(query,rename[1]),
      message:adminRenameEmail({
        previousName:result.previous_display_name,
        newName:result.new_display_name,
        usernameOwned:bool(result.username_owned),
        reason,
      }),
    });
  }
  return {
    ok:true,
    changed:renamed,
    player_id:result.player_id,
    previous_display_name:result.previous_display_name,
    display_name:result.new_display_name,
    username_owned:bool(result.username_owned),
    notification,
  };
}
