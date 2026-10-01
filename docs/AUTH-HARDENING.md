# Pack One production Auth hardening

Status: **production active**. Production Managed Better Auth rejects localhost origins while the development/QA branch keeps localhost enabled for controlled testing.

## Current state

Production Neon Auth:

- project: `patient-shadow-91417882`
- serving branch: `br-orange-feather-ayps8kep` (currently named `pack1-dr-restore-drill-2026-09-30 (1)`; it is not the Neon default branch)
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

## Open owner follow-ups from the September 30 incident

These are owner-run actions. Do not perform them from an automated recovery or release workflow. Keep this order: acceptance checks and read-only SQL first; then disable the retired endpoint; then remove the old Google redirect URI. After the endpoint is disabled, SQL against `br-dark-sound-ayxhwq1u` is expected to stop working.

### 1. Tester re-registration and password-reset acceptance

Record the UTC timestamp immediately before starting these checks; use that value as `QA_START_UTC` in the read-only SQL below.

Signup acceptance:

1. Ask the affected tester to register again on `https://packone.pro`.
2. Confirm the **Check your email** screen appears.
3. Confirm the verification email arrives through `pack1-authhook`.
4. Open the verification link.
5. Sign in successfully.

The tester's successful re-registration doubles as the signup acceptance check.

Password-reset acceptance:

1. Use a dedicated pre-existing credential test account, not the owner's main account.
2. Request a password reset.
3. Confirm the reset email arrives.
4. Open the reset link and set a new password.
5. Sign in successfully with the new password.

The password-reset evidence below deliberately does **not** read the password hash. Better Auth stores a credential password on `neon_auth.account` with `providerId='credential'`; the live Pack One schema has both `password` and `updatedAt` on that table. A completed password reset updates the credential account password and therefore its account row timestamp. Use `account.updatedAt` as the read-only marker.

### 2. Read-only SQL before disabling the retired endpoint

Run these checks **before** disabling `ep-hidden-bonus-ayfmcpys`. Replace the timestamp literal with the recorded `QA_START_UTC`.

On the serving branch `br-orange-feather-ayps8kep`, expect at least one newly verified credential user with a new Neon Auth session:

```sql
WITH params(qa_start) AS (
  VALUES (TIMESTAMPTZ '2026-10-01T00:00:00Z')
)
SELECT count(*) AS new_verified_credential_users_with_session
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
    FROM neon_auth.session s
    WHERE s."userId" = u.id
      AND s."createdAt" >= p.qa_start
  );
```

For the password-reset acceptance, the dedicated account should have a credential-account row that predates `QA_START_UTC` and was updated afterward. Expect at least one:

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

On the stale branch `br-dark-sound-ayxhwq1u`, expect zero new Neon Auth users and zero new Neon Auth sessions during the acceptance window:

```sql
WITH params(qa_start) AS (
  VALUES (TIMESTAMPTZ '2026-10-01T00:00:00Z')
)
SELECT
  (SELECT count(*) FROM neon_auth."user" u, params p WHERE u."createdAt" >= p.qa_start) AS new_users,
  (SELECT count(*) FROM neon_auth.session s, params p WHERE s."createdAt" >= p.qa_start) AS new_sessions;
```

Do not use `public.account_sessions` for this incident check. Pack One does not write that table, so it cannot prove which Neon Auth branch handled the acceptance flows.

Once both owner-run flows are complete, confirm the `pack1growth` logs contain no new PostgreSQL `23503` errors.

### 3. Disable the retired endpoint, then verify it is actually disabled

The restored branch `br-dark-sound-ayxhwq1u` is a stale public copy of production Auth data. At incident closeout it retained 9 unexpired Neon sessions across 3 users. Pack One application writes did not go to that branch during the split.

Disable the old compute endpoint `ep-hidden-bonus-ayfmcpys`; do not delete the branch or endpoint. This is reversible.

Exact Neon API call:

```sh
curl --fail-with-body --request PATCH \
  --url https://console.neon.tech/api/v2/projects/patient-shadow-91417882/endpoints/ep-hidden-bonus-ayfmcpys \
  --header "Authorization: Bearer $NEON_API_KEY" \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --data '{"endpoint":{"disabled":true}}'
```

To reverse that containment step, send the same request with `"disabled":false`.

Do **not** use Better Auth `/ok` as the retirement check. `/ok` may answer without opening a database connection and can therefore stay HTTP 200 even when the backing endpoint is disabled.

Post-disable check A — read-only Neon control-plane GET. Expected result is **unverified until the owner runs it**:

```sh
curl --fail-with-body \
  --url https://console.neon.tech/api/v2/projects/patient-shadow-91417882/endpoints/ep-hidden-bonus-ayfmcpys \
  --header "Authorization: Bearer $NEON_API_KEY" \
  --header 'accept: application/json'
```

Confirm the returned endpoint object reports `disabled: true`.

Post-disable check B — database-dependent Auth probe. Expected result is **unverified until the owner runs it**. Use a nonexistent throwaway address and print only the HTTP status:

```sh
probe_email="retired-auth-probe-$(date +%s)-$RANDOM@example.invalid"
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  --request POST \
  --url https://ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth/sign-in/email \
  --header 'content-type: application/json' \
  --data "{\"email\":\"$probe_email\",\"password\":\"not-a-real-password\"}"
```

While the endpoint is enabled, a nonexistent credential should normally reach the database and return an authentication rejection such as HTTP 401. Once the endpoint is disabled, expect a server/connection failure rather than a normal credential rejection. The exact post-disable status is intentionally marked unverified until the owner performs the check.

This sign-in probe may write a rate-limit row on the retired branch while that branch is still reachable. That limited write is acceptable for this retirement check.

Also verify:

1. From a reviewed checkout with `NEON_API_KEY` available, `node scripts/production-auth-binding-guard.mjs` passes.
2. A normal production sign-in on `https://packone.pro` still works.

Do not try the stale-branch SQL after the endpoint is disabled; loss of database access there is expected.

### 4. Remove the old Google redirect URI

Only after the acceptance checks, read-only SQL, endpoint disable, and post-disable checks are complete, remove the old Google OAuth redirect URI from **Google Cloud Console -> APIs & Services -> Credentials -> the existing Pack One Web OAuth client -> Authorized redirect URIs**:

- remove `https://ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth/callback/google`;
- keep `https://ep-young-hall-ayl0754j.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth/callback/google`.

Deleting `br-dark-sound-ayxhwq1u`, renaming branches, or changing Neon's default/primary branch is a separate later decision and is not part of this containment step.

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
