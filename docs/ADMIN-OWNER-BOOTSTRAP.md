# Initial administrator Owner bootstrap

**Production status (October 8, 2026): completed.** The first Owner was promoted from an existing, verified Admin account in a separately approved and committed database transaction. Subsequent read-only production verification confirmed **exactly one Owner** with the unique-Owner index and deletion guards active. The production Admin/Owner release later completed through [secure-auth run 37836974129](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/37836974129); see [current state](CURRENT-STATE.md).

**Do not run this bootstrap again as routine setup.** It is retained solely as the historical/manual-operator procedure. Do not commit a real Auth UUID, email, invite token or other identifying credential in Git. Neither registration nor invitation acceptance can assign the Owner role. Future Owner transfer/recovery is **not** implemented as a normal UI operation and requires a separate exact-identity review, an explicitly approved plan and validation of existing ownership/deletion safeguards before any transaction. Do not try to create a second Owner.

## Original operator procedure (reference only; requires fresh approval for reuse)

After migration `0057_admin_owner_invitations.sql`, independently resolve the exact existing user's Auth UUID and current verified email from `neon_auth."user"` using a **read-only** lookup. Confirm there is no deletion history and review the exact values out of band. A separately authorized transaction uses the existing advisory lock and changes exactly one eligible Admin only if no Owner exists:

```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('pack1-owner-bootstrap',0));
UPDATE pack1_admins a SET role='owner'
  FROM neon_auth."user" u
  WHERE a.auth_user_id=u.id
    AND a.auth_user_id='<EXACT-AUTH-UUID>'::uuid
    AND lower(btrim(u.email))='<EXACT-VERIFIED-EMAIL>'
    AND u."emailVerified"=true
    AND a.role='admin'
    AND NOT EXISTS (SELECT 1 FROM pack1_admins WHERE role='owner')
  RETURNING a.auth_user_id,a.role;
-- Confirm EXACTLY one matching row, then COMMIT; otherwise ROLLBACK.
```

The one-Owner partial unique index and database triggers prevent competing Owners, promotion of unverified accounts, and promotion of accounts with deletion tombstones. The Owner's own account remains protected from deletion. Do not substitute web sign-in, an invitation, or an Admin API call for explicit operator authorization. Refer to [Admin/Owner operations](ADMIN-OWNER-OPERATIONS.md) for day-to-day invitations, revocation, and deletion boundaries.
