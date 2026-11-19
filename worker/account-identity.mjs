import {accountSession} from './account-session.mjs';
import {isPlaceholderUsername} from './username.mjs';
import {publicIdentityEligibility} from './public-identity-safety.mjs';

// Player bearer tokens identify a device/session. Account capabilities require
// a currently valid first-party account session and the authoritative link.
// Legacy Neon Auth headers remain accepted only during the browser migration.
export async function accountIdentity(request, query, owner) {
  const auth=await accountSession(request,query,{required:false,allowLegacy:true});
  if(!auth)return null;
  const result=await query('SELECT auth_user_id,player_id FROM account_links WHERE auth_user_id=$1::uuid',[auth.user_id]);
  const account=result.rows[0];
  if(!account||account.player_id!==owner)throw Object.assign(Error('Sign in again to continue with your account.'),{status:401});
  return {...account,session_source:auth.source};
}

// Keep public-identity eligibility explicit. This lets the product distinguish
// an anonymous guest from an account that is linked but still needs a unique
// username before it can participate in ranked/public identity surfaces.
export async function rankingIdentityStatus(query, owner) {
  const result=await query(
    'SELECT a.auth_user_id,a.player_id,p.display_name,p.username_owned,p.public_identity_terms_version,p.public_identity_terms_accepted_at,p.public_identity_hidden_at FROM players p LEFT JOIN account_links a ON a.player_id=p.id WHERE p.id=$1::uuid LIMIT 1',
    [owner],
  );
  const row=result.rows[0];
  if(!row?.auth_user_id)return {eligible:false,reason:'guest',display_name:null};
  const eligibility=publicIdentityEligibility({...row,is_placeholder:isPlaceholderUsername(row.display_name)});
  return {
    eligible:eligibility.eligible,
    reason:eligibility.reason,
    auth_user_id:row.auth_user_id,
    player_id:row.player_id,
    display_name:row.display_name,
  };
}

export async function linkedPlayerIdentity(query, owner) {
  const status=await rankingIdentityStatus(query,owner);
  return status.eligible?status:null;
}
