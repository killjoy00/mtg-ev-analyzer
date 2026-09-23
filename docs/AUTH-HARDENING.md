# Pack One production Auth hardening

Status: **production active**. Production Managed Better Auth rejects localhost origins while the development/QA branch keeps localhost enabled for controlled testing.

## Current state

Production Neon Auth:

- project: `patient-shadow-91417882`
- branch: `br-orange-feather-ayps8kep` (`main`)
- Auth base: `https://ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth`
- `allow_localhost: false`

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
- the same disposable account is used for the password-reset request;
- cleanup removes that single disposable Auth identity through the existing reviewed Better Auth admin path.

This keeps the localhost hardening check aligned with the current production policy instead of treating the expected unverified-user rejection as a regression.

## Rollback and failure behavior

If the controller changes production from `allow_localhost:true` to false and a **core Auth verification** then fails, it attempts to restore production `allow_localhost:true` before surfacing the failure. A rollback failure is surfaced as a separate hard error.

If production is already false, reruns verify the state and flows without first re-enabling localhost.

Smoke-account cleanup is separate from the core hardening rollback decision: cleanup failures fail the workflow loudly but do not reopen localhost after the core Auth checks have passed.

## Smoke-user cleanup

The localhost-hardening production check creates only the disposable Auth user needed to prove current email/password policy and recovery behavior. Under required verification the synthetic user is expected to remain unverified during the smoke, so HTTP 403 at password sign-in is the correct policy result.

Cleanup reuses Pack One's existing reviewed Better Auth provider-deletion path from `worker/account-deletion.mjs`:

- signs in with the server-only deletion-admin principal;
- proves that principal is not linked to a Pack One account using a read-only `account_links` query;
- deletes the disposable Better Auth identity through `/admin/remove-user`;
- signs the admin principal back out.

The hardening controller does not directly `DELETE`, `UPDATE`, or `INSERT` rows in the `neon_auth` schema.

Cleanup preserves the provider deletion outcome instead of collapsing failures into one generic error. `success` and `not_found` are accepted. `operator_review` fails immediately without retry. Fast transient outcomes from rate limiting, provider 5xx responses, network failures, or the service-principal link check get at most one retry after 250 ms. `PROVIDER_TIMEOUT` is deliberately not retried so a slow provider cannot consume more of the 12-minute production hardening job budget. Surfaced cleanup errors retain both the typed outcome and provider error code.

After the final production run, a read-only query confirmed **zero** remaining `pack1-auth-hardening-* @example.com` or `delivered@resend.dev` smoke users.

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
