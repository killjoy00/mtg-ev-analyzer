import {accountSession} from './account-session.mjs';

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

// Public ranking recognizes the established signed player, independently of
// an active account session. Never use this identity for account capabilities.
export async function linkedPlayerIdentity(query, owner) {
  const result=await query('SELECT a.auth_user_id,a.player_id,p.display_name FROM account_links a JOIN players p ON p.id=a.player_id WHERE a.player_id=$1::uuid',[owner]);
  return result.rows[0]||null;
}
