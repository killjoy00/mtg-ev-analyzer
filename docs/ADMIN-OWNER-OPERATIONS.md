# Admin and Owner operations

Updated 2026-10-08 for the deployed Admin API v5 release and security hardening in [PR #1111](https://github.com/killjoy00/mtg-ev-analyzer/pull/1111). See [CURRENT-STATE](CURRENT-STATE.md) for exact release and acceptance evidence and [Owner bootstrap](ADMIN-OWNER-BOOTSTRAP.md) for the separately approved one-time activation.

## Roles, sign-in, and access

- Sign in to [Pack One administration](https://packone.pro/admin/) with an ordinary Pack One account. Successful sign-in **does not** grant Admin privileges; the backend checks the current Auth UUID's membership in `pack1_admins`. There is no setup-code or separate Admin self-registration flow.
- **Owner** is a unique, operator-bootstrapped membership. The Owner has normal Admin functions and sole authority to create/revoke Admin invitations and revoke Admin memberships. The Team console is [`/admin/?area=team`](https://packone.pro/admin/?area=team).
- **Admin** can use permitted regular Admin capabilities, but cannot manage Admin membership or delete **another** current Admin account, even by setting `acknowledgeAdmin=true`. Do not mistake ordinary Admin membership for Owner authorization.

## Invite an administrator (Owner only)

1. Open the **Team** area, review the member/invitation list, and enter the intended recipient's verified Pack One account email. Confirm the address out of band before creating anything.
2. Select **Create invitation**. The one-time bearer link appears **once**; copy it and share privately with the intended recipient. Pack One does **not** send an invitation email automatically. The token is stored server-side only as a hash, the link expires after **72 hours**, and revoked, expired or already-used links are not reusable. Avoid pasting links into issues, source code, shared logs or public messages.
3. The recipient opens the link and signs in to their **own verified account**. The page shows the current signed-in email and **Accept admin invitation**, **Cancel**, and **Switch account**. **Opening/reloading the link or signing in does not accept it.** The recipient must intentionally select **Accept admin invitation**.
4. **Cancel** abandons the pending invitation in that browser. **Switch account** signs out and preserves the pending invitation for an intentional attempt with the correct account. The backend verifies the signed-in Auth UUID's verified email matches the invited address before granting the **Admin** role; it never grants Owner.
5. Refresh the Team area to confirm the resulting membership and access-audit event. To cancel an outstanding pending invitation, use **Revoke**. Once accepted, remove access through **Revoke access** on the Admin member instead of trying to revoke the used invitation.

## Revocation versus permanent account deletion

- **Revoke access** removes the person's Admin membership and future privileged access; it is **not** the same as deleting the person's underlying Pack One account. Use this for ordinary access removal.
- Admin Users includes a separate, **destructive** account deletion lifecycle. An ordinary Admin may initiate deletion of eligible **non-Admin** accounts under the existing authenticated, CSRF/Origin-protected confirmation contract; normal Admins cannot initiate **or resume** deletion of another currently registered Admin.
- Deleting another Admin account requires a current **Owner** actor, explicit literal `DELETE` confirmation **and** the additional Admin-target acknowledgment. Neither `acknowledgeAdmin=true` nor manipulating the client can substitute for the Owner check. Migration `0058_owner_guard_admin_deletion.sql` checks the target/actor under the atomic initializer's per-user lock and guards direct deletion-tombstone writes.
- The **Owner account is protected** from the Admin deletion path. Self-service account deletion follows its own authenticated/verified deletion process; the Admin Users page does not allow self-deletion. An ownership transfer is a separate, explicitly approved operator task, not an Admin/Owner UI shortcut.

## Verification and limits

The following query reads only aggregate production state and safeguard presence; run it against the verified **serving production Neon branch**, not a default-branch name inferred from the provider:

```sql
SELECT
  (SELECT count(*)::int FROM pack1_admins WHERE role='owner') AS owners,
  (SELECT count(*)::int FROM pack1_admins WHERE role='admin') AS regular_admins,
  (SELECT count(*)::int FROM pack1_admin_invitations) AS invitations,
  EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid=to_regprocedure('pack1_begin_admin_account_deletion(uuid,uuid,text,boolean)')
      AND prosrc LIKE '%owner_required%'
  ) AS owner_only_initializer,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='pack1_owner_guard_on_deletions' AND NOT tgisinternal
  ) AS deletion_write_trigger;
```

At October 8 post-release inspection: **1 Owner, 0 other Admins, 0 invitations**, with Owner-only initializer, direct-tombstone guard, one-Owner index and deletion trigger present. [Guarded release 37836974129](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/37836974129) and [independent acceptance 37838495782](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/37838495782) passed, as did post-merge Pages/production smoke. The independent protected acceptance fetched the published Admin scripts and verified consent/role-aware UI, live Admin v5 alignment and gateway/Auth contracts.

**Acceptance boundary:** 39 real PostgreSQL lifecycle assertions ran on isolated test databases, and Playwright verified no invite-redemption POST on open/reload. The release did **not** redeem a real production invitation or execute a destructive Admin-to-Admin production deletion test. Do not represent those as completed. For a real invitation rehearsal, use a separately authorized disposable **non-Owner** account and plan revocation/cleanup before issuing any link.
