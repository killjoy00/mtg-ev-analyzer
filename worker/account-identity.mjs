// Player bearer tokens identify a device/session. Account capabilities require
// a currently valid managed Auth session and the authoritative account link.
export async function accountIdentity(request, query, owner) {
  const token=request.headers.get('x-pack1-auth-session');
  if(!token)return null;
  if(token.length>512)throw Object.assign(Error('Invalid account session.'),{status:401});
  const result=await query(`SELECT s."userId" auth_user_id,a.player_id FROM neon_auth.session s
    JOIN account_links a ON a.auth_user_id=s."userId"
    WHERE s.token=$1 AND s."expiresAt">now()`,[token]);
  const account=result.rows[0];
  if(!account||account.player_id!==owner)throw Object.assign(Error('Sign in again to continue with your account.'),{status:401});
  return account;
}
