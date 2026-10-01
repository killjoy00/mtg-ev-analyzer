# Pack One production Auth hardening

Status: **production active**. Production Managed Better Auth rejects localhost origins while the development/QA branch keeps localhost enabled for controlled testing.

## Current state

Production Neon Auth:

- project: `patient-shadow-91417882`
- serving branch: `br-orange-feather-ayps8kep` (named `production`; the Neon default and primary branch since 2026-10-01)
- Auth base: `https://ep-young-hall-ayl0754j.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth`
- `allow_localhost: false`

### September 30 restore-finalization incident

A restore drill finalized `br-dark-sound-ayxhwq1u` as Neon `main` / primary / default and moved the original `ep-hidden-bonus-ayfmcpys` endpoint onto that restored branch. The application Functions, schedulers, gateway branch configuration, and every app write remained on `br-orange-feather-ayps8kep`. Neon Auth also remained registered on `br-orange-feather-ayps8kep`, where Neon now reports the `ep-young-hall-ayl0754j` Auth base above.

The production application must therefore use the Auth base reported for the serving branch, not infer production identity from the endpoint that historically belonged to it or from whichever branch Neon currently names `main`. The secure-auth release now checks this binding read-only before deployment.

During the corrective cutover, `pack1-authhook` temporarily accepted signed verification events and verification links from both the current and immediately previous Auth bases so email verification was not dropped between the Worker and backend deployments. After the guarded release passed, a real production Google sign-in was confirmed on the serving orange branch while the restored dark branch remained idle. The previous-host allowance was then retired; production webhook signature and verification-link validation now trust only the current serving-branch `AUTH_BASE`.

Before that corrective release, the existing Google OAuth web client must authorize `https://ep-young-hall-ayl0754j.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth/callback/google`. Better Auth constructs the Google callback under the configured Auth base. Pack One's Apple web flow is independent of the Neon Auth host and continues to use `https://api.packone.pro/growth/v1/account/apple/callback`.

Development/QA Neon Auth:

- branch: `br-twilight-hill-ayffyd2b` (`dev-draft-run-product-review`)
- `allow_localhost: true`

Production trusted origins were **not changed** by this hardening:

- `https://packone.pro`
- `https://api.packone.pro`
- `https://magic.planitnow.us`

The `magic.planitnow.us` trusted origin remains intentionally untouched; removing or changing trusted origins is a separate decision from #245.

## Reviewed control path

The production setting is controlled only through the reviewed repository path:

- request: `.github/auth-localhost-hardening-request.json`
- workflow: `.github/workflows/auth-localhost-hardening.yml`
- controller: `scripts/auth-localhost-hardening.mjs`
- contract tests: `tests/auth-localhost-hardening.test.mjs`

The fixed request operation is `disable-production-localhost`. The controller does not expose an arbitrary Auth-config mutation interface.

Pull requests run the QA proof only. A push to `main` runs the production hardening/verification job.

## QA-first proof

Before production was changed, the workflow proved the localhost capability on QA and restored QA afterward:

1. Google OAuth start from `http://localhost:4173` succeeded while QA `allow_localhost` was true.
2. QA `allow_localhost` was disabled.
3. The same localhost OAuth start was rejected.
4. QA `allow_localhost` was restored to true in a `finally` path.
5. Localhost OAuth start succeeded again after restore.
6. Trusted domains, email/password configuration, and OAuth-provider configuration were compared before/after and required to remain unchanged.

Measured QA behavior was `200 -> 403 -> 200`.

## Production verification

The final production hardening run was [35691301903](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/35691301903) and completed successfully.

Measured final production results:

- `allow_localhost`: false before verification and false after verification;
- localhost Google OAuth start: HTTP 403;
- Google OAuth start from `https://packone.pro`: HTTP 200;
- Google OAuth start from `https://api.packone.pro`: HTTP 200;
- Google OAuth start from `https://magic.planitnow.us`: HTTP 200;
- disposable email/password signup: HTTP 200;
- sign-in with that account: HTTP 200;
- password-reset request: HTTP 200.

The final production smoke, full test suite, and e2e suite also passed on the merged revision.

Those signup/sign-in results are historical evidence from the localhost-hardening release before #246 enabled required email verification. The current production password policy is documented in [AUTH-EMAIL-VERIFICATION.md](AUTH-EMAIL-VERIFICATION.md).

### Maintenance behavior after required verification

The localhost-hardening workflow remains runnable under the final #246 production policy.

Its disposable password smoke is now policy-aware:

- it uses Resend's `delivered@resend.dev` test recipient because production signup now emits a verification email;
- signup must still succeed and return a user id;
- when production `require_email_verification=true`, sign-in for that still-unverified synthetic user must return HTTP 403;
- when verification is not required, the legacy authenticated sign-in assertion remains available;
- the same disposable account is used for the password-reset **request only**; this smoke does not consume the reset token, so the account correctly remains unverified;
- cleanup removes that single disposable Auth identity through the existing reviewed Better Auth admin path.

This keeps the localhost hardening check aligned with the current production policy instead of treating the expected unverified-user rejection as a regression.

## Interaction with reset-implies-verification

The September 27 password-reset verification release did not change `allow_localhost`, trusted origins, OAuth provider configuration, the recovery webhook subscription, or this hardening controller. It changes only the account state after a valid reset credential is successfully redeemed through Pack One's reset-completion endpoint. See [AUTH-EMAIL-VERIFICATION.md](AUTH-EMAIL-VERIFICATION.md), [AUTH-RECOVERY-DELIVERY.md](AUTH-RECOVERY-DELIVERY.md), and [REQUEST-INTEGRITY.md](REQUEST-INTEGRITY.md).

## Rollback and failure behavior

If the controller changes production from `allow_localhost:true` to false and a **core Auth verification** then fails, it attempts to restore production `allow_localhost:true` before surfacing the failure. A rollback failure is surfaced as a separate hard error.

If production is already false, reruns verify the state and flows without first re-enabling localhost.

Smoke-account cleanup is separate from the core hardening rollback decision: cleanup failures fail the workflow loudly but do not reopen localhost after the core Auth checks have passed.

## Smoke-user cleanup

The localhost-hardening production check creates only the disposable Auth user needed to prove current email/password policy and recovery-request behavior. Under required verification the synthetic user is expected to remain unverified during this smoke because the workflow requests a reset but does not consume the reset link. HTTP 403 at password sign-in is therefore the correct policy result. Since September 27, a **successfully consumed** reset link has different semantics: it marks that exact Auth user verified after Better Auth changes the password.

Cleanup reuses Pack One's existing reviewed Better Auth provider-deletion path from `worker/account-deletion.mjs`:

- signs in with the server-only deletion-admin principal;
- proves that principal is not linked to a Pack One account using a read-only `account_links` query;
- deletes the disposable Better Auth identity through `/admin/remove-user`;
- signs the admin principal back out.

The hardening controller does not directly `DELETE`, `UPDATE`, or `INSERT` rows in the `neon_auth` schema.

Cleanup preserves the provider deletion outcome instead of collapsing failures into one generic error. `success` and `not_found` are accepted. `operator_review` fails immediately without retry. Fast transient outcomes from rate limiting, provider 5xx responses, network failures, or the service-principal link check get at most one retry after 250 ms. `PROVIDER_TIMEOUT` is deliberately not retried so a slow provider cannot consume more of the 12-minute production hardening job budget. Surfaced cleanup errors retain both the typed outcome and provider error code.

After the final production run, a read-only query confirmed **zero** remaining `pack1-auth-hardening-* @example.com` or `delivered@resend.dev` smoke users.

## September 30 incident follow-ups

### Completed on 2026-10-01 (UTC)

- **04:26:57** — the retired endpoint `ep-hidden-bonus-ayfmcpys` was disabled; Neon reported `disabled: true` and the compute idle. Immediately before the disable, a nonexistent-account sign-in against it returned HTTP 401 (database reachable). A later probe returned HTTP 404 from the old host and 401 from the `ep-young-hall-ayl0754j` Auth base.
- **~04:32–04:34** — `br-orange-feather-ayps8kep` was made the Neon default branch and renamed `production`. The restored branch `br-dark-sound-ayxhwq1u` (renamed `retired-restore-2026-09-30`) was then deleted, with its stale copy of production Auth data.
- The drill snapshot `pack1-dr-drill-2026-09-30` and the idle QA branches `br-calm-pond-ayh8f671` and `br-lively-silence-ayiptwkk` were deleted. A later branch and snapshot listing confirmed only `production`, `br-twilight-hill-ayffyd2b` and the `pre-0033-unique-usernames` snapshot remain.
- 13 unmanaged `dr*` Functions were deleted from production (#805). `dringest` was kept because it was invoked three times on 2026-09-26 from an unidentified caller; `scripts/neon-inventory-audit.mjs` fails on it after 2026-10-15 unless it is added to `.github/neon-functions.txt` or deleted.
- `.github/workflows/backend-gate.yml` now creates CI branches from `br-orange-feather-ayps8kep` explicitly. While the restored branch was Neon's default, CI branches had been created from it.

Lesson kept from the retirement: do not use Better Auth `/ok` as a check of a database-backed Auth host. `/ok` can answer without opening a database connection.

### Remaining acceptance (needs a real inbox)

These confirm the post-cutover email/password path end to end. They need a person with an inbox; anyone with read-only Neon access can run the SQL afterwards. Record the UTC time immediately before starting and use it as `QA_START_UTC`.

Signup acceptance (the affected tester re-registering doubles as this check):

1. Register on `https://packone.pro`.
2. Confirm the **Check your email** screen appears.
3. Confirm the verification email arrives through `pack1-authhook`.
4. Open the verification link.
5. Sign in successfully.

Password-reset acceptance, on a dedicated pre-existing credential test account (not the owner's main account):

1. Request a password reset.
2. Confirm the reset email arrives.
3. Open the reset link and set a new password.
4. Sign in successfully with the new password.

Read-only SQL on `br-orange-feather-ayps8kep`. Replace the timestamp literal with `QA_START_UTC`. Signup — expect at least one:

```sql
WITH params(qa_start) AS (
  VALUES (TIMESTAMPTZ '2026-10-01T00:00:00Z')
)
SELECT count(*) AS new_verified_credential_users_with_pack1_session
FROM neon_auth."user" u
CROSS JOIN params p
WHERE u."createdAt" >= p.qa_start
  AND u."emailVerified" IS TRUE
  AND EXISTS (
    SELECT 1
    FROM neon_auth.account a
    WHERE a."userId" = u.id
      AND a."providerId" = 'credential'
  )
  AND EXISTS (
    SELECT 1
    FROM public.account_sessions s
    WHERE s.auth_user_id = u.id
      AND s.created_at >= p.qa_start
  );
```

This checks `public.account_sessions`, not `neon_auth.session`: after Pack One issues its own session it deletes the Neon session it signed in with (`consumeNeonSession` in `worker/account-session.mjs`), so a Neon session row does not prove a Pack One sign-in. A new `account_sessions` row for the new user is exactly the step that failed with `23503` during the incident.

Password reset — expect at least one. This counts any credential account updated in the window, not only the dedicated one; at current volume that is sufficient, and an operator may add `AND a."userId" = '<dedicated account user id>'` from their own records (never commit that id). It deliberately does not read the password hash; a completed reset updates the credential account row and therefore `updatedAt`.

```sql
WITH params(qa_start) AS (
  VALUES (TIMESTAMPTZ '2026-10-01T00:00:00Z')
)
SELECT count(*) AS preexisting_credential_accounts_updated_after_qa_start
FROM neon_auth.account a
CROSS JOIN params p
WHERE a."providerId" = 'credential'
  AND a."createdAt" < p.qa_start
  AND a."updatedAt" >= p.qa_start;
```

Afterwards, confirm the `pack1growth` logs contain no new PostgreSQL `23503` errors.

### Optional

The old Google OAuth redirect URI `https://ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth/callback/google` now points at a disabled host on a deleted branch. Leaving it is harmless; it can be removed from **Google Cloud Console -> APIs & Services -> Credentials -> the Pack One Web OAuth client -> Authorized redirect URIs** at any time. Keep the `ep-young-hall-ayl0754j` redirect.

## Security boundaries preserved

This work did **not** change:

- production trusted origins;
- Google OAuth client configuration;
- email/password policy;
- recovery webhook subscription;
- recovery sender or SMTP provider;
- Pack One session semantics;
- production Auth database ownership.

The only intended persistent Auth-config change was production `allow_localhost: true -> false`.
