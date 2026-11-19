# Password-reset email-verification closeout — 2026-09-27

Status: **closed and production active**.

## Problem

Pack One required email verification for password accounts, but a user who proved mailbox possession by following a password-reset link could successfully change the password and still remain `emailVerified=false`. That left the user blocked at sign-in with an email-not-verified result even though the reset credential had already proved control of the mailbox.

## Final product contract

The recovery request and recovery completion are intentionally different:

- requesting a password-reset email does not verify an account;
- invalid, expired, reused, policy-rejected, or provider-failed reset attempts do not verify an account;
- Managed Neon / Better Auth remains the reset-token issuer and password-reset authority;
- only after Better Auth successfully consumes the reset token and changes the password does Pack One mark that exact Auth identity email-verified;
- the target Auth UUID comes from the Managed Neon recovery record for the reset token, never from a browser-supplied email or user ID;
- Pack One uses the existing authenticated Managed Auth admin API to set `emailVerified:true`; normal product code does not directly mutate `neon_auth.user`;
- the non-human admin principal must be distinct from the target and must have no Pack One account link;
- after a successful password change, Pack One updates Apple synthetic-password state where applicable and revokes every Pack One first-party session for the Auth user.

If the password changes but verification finalization fails, Pack One does not pretend the whole operation succeeded. It still revokes Pack One sessions and returns HTTP 503 / `VERIFICATION_FINALIZE`, telling the user to request a normal verification email before signing in.

## Implementation

PR #705, **Verify email after successful password reset**, implemented the behavior and merged as:

`ce61279ffe0ce5d015588d12806fdc79c8306911`

Key implementation points:

- `worker/growth-function.js` resolves the Auth user from the reset token, requires Better Auth reset success, invokes verification finalization, updates Apple synthetic-password state, and revokes sessions.
- `worker/account-deletion.mjs` now exposes the reusable authenticated provider operation that signs in through the restricted admin principal and calls `/admin/update-user` with `emailVerified:true`.
- `worker/apple-auth.mjs` no longer tells users to perform a second email-verification step after resetting.
- `tests/password-recovery.test.mjs` proves exact-target verification ordering and the post-password verification-finalization failure path.

The documentation closeout also removes the same obsolete second-verification instruction from the browser and native Apple-linking error copy.

## Regression evidence

PR #705 required checks all passed:

- backend schema gate: **36354748211**
- browser E2E: **36354748218**
- full test: **36354748219**

Focused regression coverage proves:

- the provider reset succeeds before `/admin/update-user`;
- the exact Auth UUID resolved from the recovery token receives `emailVerified:true`;
- session revocation happens after the password-change path and still occurs when verification finalization fails;
- invalid, expired, reused, policy-rejected, and provider-failed resets do not run the verification update.

The browser suite also passed both the email-verification and password-recovery Chromium/WebKit mobile contracts.

## Production release

The protected release request was carried by PR #710, **Release password-reset verification fix**. Its required test and E2E checks passed before merge.

PR #710 merged as:

`a564a207e9f336639636624c366bff55c6a9759f`

That merge triggered guarded secure-auth workflow **36357289329**, which completed successfully. The workflow:

1. validated release-critical recovery/admin secrets;
2. built the exact release revision;
3. applied and verified the development secure-account schema;
4. deployed the exact revision to development and passed development secure-auth smoke;
5. verified production prerequisites;
6. applied and verified the production secure-account schema;
7. deployed the development-tested revision to production;
8. deployed the dedicated production recovery webhook Worker;
9. deployed the first-party production gateway;
10. passed the live secure-gateway / Google OAuth verification;
11. passed the retained gateway timing/telemetry gate.

The reset-implies-verification behavior is therefore **live in production**, not merely merged.

## Security boundaries preserved

This change does not:

- make a reset request itself proof of mailbox possession;
- allow a browser to select the Auth user to verify;
- directly update Managed Auth user rows from normal product SQL;
- weaken required email verification;
- change trusted origins or localhost policy;
- change the recovery webhook event contract;
- alter Google OAuth identity semantics;
- skip Pack One session revocation after a password change.

The recovery-email and verification-email delivery contracts remain separate. They converge only in account state after successful reset-token consumption.

## Operational behavior

A support/operator diagnosis should distinguish these cases:

- **Reset requested, not completed:** account verification state is unchanged.
- **Reset completed successfully:** the same account should be verified and all Pack One sessions revoked.
- **Password changed, response is `VERIFICATION_FINALIZE`:** password change succeeded, sessions were revoked, but verification finalization did not complete. Send/request a normal verification email; do not tell the user to repeat the password reset merely to verify.
- **Invalid/expired/reused reset:** no verification finalization and no Pack One session revocation occurs.

## Documentation synchronized

The closeout updates:

- `docs/AUTH-EMAIL-VERIFICATION.md`
- `docs/AUTH-RECOVERY-DELIVERY.md`
- `docs/AUTH-HARDENING.md`
- `docs/REQUEST-INTEGRITY.md`
- `docs/CURRENT-STATE.md`
- `docs/mobile-parity-inventory.md`
- `docs/mobile-store-submission.md`
- `README.md`
- browser/native Apple-linking recovery copy

## Remaining limitation

No real production user's password was destructively changed solely as a closeout canary. The production claim is grounded in exact-revision deployment, provider-bound unit coverage, browser contracts, development secure-auth smoke, production secure-auth smoke, and live gateway/release verification. A future deliberately authorized real-account reset can provide additional inbox-to-provider evidence, but it is not required to keep this fix active.
