import {accountCapabilities} from './capabilities.mjs';

// Reuse the same bearer verification and deletion-tombstone check as gameplay.
// Resolve lazily because growth's route dispatcher imports the Patreon module.
const verifyPlayer=request=>import('./growth-function.js').then(({player})=>player(request));
const fail=(message,status=401)=>{throw Object.assign(Error(message),{status});};

export async function nativePatreonIdentity(request,{query,authSession,playerSession=verifyPlayer}) {
  if(!request.headers.get('x-pack1-mobile-account')||request.headers.has('cookie')||request.headers.has('x-pack1-auth-session'))
    fail('A native Pack One account session is required.');
  const owner=await playerSession(request);
  const auth=await authSession(request,{required:true,allowLegacy:false,csrf:false});
  if(auth?.source!=='mobile')fail('A native Pack One account session is required.');
  const linked=await query('SELECT auth_user_id,player_id FROM account_links WHERE auth_user_id=$1::uuid',[auth.user_id]);
  if(!linked.rows[0]||linked.rows[0].player_id!==owner)
    fail('Sign in again to continue with your account.');
  return {authUserId:auth.user_id,playerId:owner};
}

export async function nativePatreonStatus(query,identity,providerStatus) {
  // Provider grants describe provenance only. The same provider-independent
  // capability function used by gameplay decides overall account access.
  const capabilities=Array.isArray(providerStatus?.account_capabilities)
    ? providerStatus.account_capabilities
    : await accountCapabilities({auth_user_id:identity.authUserId},query);
  const {support_url:_supportUrl,...provider}=providerStatus;
  return {
    ...provider,
    account_capabilities:capabilities,
    account_user_id:identity.authUserId,
    player_id:identity.playerId,
    checked_at:new Date().toISOString(),
  };
}

export async function requestNativePatreonRefresh(query,authUserId) {
  const result=await query(`UPDATE provider_accounts
    SET sync_requested_at=now(),sync_revision=sync_revision+1
    WHERE auth_user_id=$1::uuid AND provider='patreon'
    RETURNING auth_user_id`,[authUserId]);
  if(!result.rows[0])fail('Connect an existing Patreon membership before requesting a refresh.',409);
  // This requests the existing authoritative reconciler. It is not proof that
  // Patreon has already answered, and never issues or extends a grant itself.
  return {ok:true,requested:true};
}
