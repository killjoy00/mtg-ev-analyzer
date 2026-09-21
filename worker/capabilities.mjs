export const PAID_CAPABILITIES = new Set(['unlimited_cube_practice','custom_corpus']);
export async function accountCapabilities(account,query) {
  if(!account)return [];
  const result=await query(`SELECT DISTINCT capability FROM entitlement_grants WHERE auth_user_id=$1::uuid
    AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`,[account.auth_user_id]);
  return ['account','unlimited_regular_practice',...result.rows.map(r=>r.capability).filter(c=>PAID_CAPABILITIES.has(c)).sort()];
}
// A Supporter holds no paid capability, so capabilities alone cannot tell a
// paying member apart from a free account. Surfaces that offer an upgrade need
// that difference to avoid telling a subscriber to "become" what they already
// partly are. Linkage only - never an entitlement, which stays in the grants.
export async function providerMembership(account,query) {
  if(!account)return {connected:false};
  const result=await query(
    "SELECT 1 FROM provider_accounts WHERE auth_user_id=$1::uuid AND provider='patreon' LIMIT 1",
    [account.auth_user_id]);
  return {connected:result.rows.length>0};
}

export function practiceCapability(environment,setIds=[]) {
  return setIds.length?'custom_corpus':environment==='powered-cube'?'unlimited_cube_practice':'unlimited_regular_practice';
}
export function requireCapability(capabilities,capability) {
  if(capabilities.includes(capability))return;
  const message=PAID_CAPABILITIES.has(capability)?'Connect an Elite membership to use this practice option.':capabilities.includes('account')?'This practice option is not available on your account.':'A free account is required for regular practice.';
  throw Object.assign(Error(message),{status:403,capability});
}
// Future providers implement verifyAndResolve(event). The adapter must verify
// the provider's signature and resolve the existing account; never trust a
// client-supplied account, capability list or tier. Revocation is explicit.
export async function applyProviderEvent(adapter,event,query) {
  const grant=await adapter.verifyAndResolve(event);
  if(!grant||!/^[-a-z0-9]{2,40}$/.test(adapter.id)||!PAID_CAPABILITIES.has(grant.capability)||!/^[a-f0-9-]{36}$/.test(grant.accountId)||!grant.reference)throw Error('Invalid verified entitlement grant.');
  await query(`WITH identity_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))
    ), identity_allowed AS MATERIALIZED (
      SELECT 1 FROM identity_lock WHERE NOT EXISTS (
        SELECT 1 FROM account_deletion_operations
        WHERE auth_user_id=$1::uuid
          AND state IN ('pending','app_cleanup_complete','provider_delete_pending','provider_deleted','complete','operator_review')
      )
    )
    INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference,expires_at,revoked_at)
    SELECT $1::uuid,$2,$3,$4,$5::timestamptz,CASE WHEN $6::boolean THEN now() END FROM identity_allowed
    ON CONFLICT(auth_user_id,capability,provider,provider_reference) DO UPDATE SET expires_at=EXCLUDED.expires_at,revoked_at=EXCLUDED.revoked_at`,
    [grant.accountId,grant.capability,adapter.id,grant.reference,grant.expiresAt||null,grant.revoked===true]);
}
